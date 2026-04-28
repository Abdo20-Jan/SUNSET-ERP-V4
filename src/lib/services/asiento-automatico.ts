import "server-only";

import { z } from "zod";

import { db } from "@/lib/db";
import { eqMoney, gtZero, money, sumMoney, toDecimal } from "@/lib/decimal";
import { ensureCuentasMap, getOrCreateCuenta } from "@/lib/services/cuenta-auto";
import { revertirIngresoEmbarque } from "@/lib/services/stock";
import {
  COMPRA_CODIGOS,
  EMBARQUE_CODIGOS,
  GASTO_POR_TIPO_PROVEEDOR,
  TRANSFERENCIA_CODIGOS,
  TASA_PROVISION_GANANCIAS,
  VENTA_CODIGOS,
} from "@/lib/services/cuenta-registry";
import {
  AsientoEstado,
  AsientoOrigen,
  CuentaTipo,
  EmbarqueEstado,
  Moneda,
  MovimientoTesoreriaTipo,
  PeriodoEstado,
  Prisma,
  type Asiento,
} from "@/generated/prisma/client";

type TxClient = Prisma.TransactionClient;

export type AsientoErrorCode =
  | "DESBALANCEADO"
  | "LINEA_INVALIDA"
  | "CUENTA_INVALIDA"
  | "CUENTA_INACTIVA"
  | "CUENTA_SINTETICA"
  | "PERIODO_INEXISTENTE"
  | "PERIODO_CERRADO"
  | "ASIENTO_INEXISTENTE"
  | "ESTADO_INVALIDO"
  | "NUMERACION_FALHOU"
  | "DOMINIO_INVALIDO";

export class AsientoError extends Error {
  readonly code: AsientoErrorCode;

  constructor(code: AsientoErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AsientoError";
    this.code = code;
  }
}

const lineaSchema = z.object({
  cuentaId: z.number().int().positive(),
  debe: z.union([z.string(), z.number()]).default(0),
  haber: z.union([z.string(), z.number()]).default(0),
  descripcion: z.string().optional(),
});

const crearAsientoSchema = z.object({
  fecha: z.date(),
  descripcion: z.string().min(1),
  origen: z.nativeEnum(AsientoOrigen),
  moneda: z.nativeEnum(Moneda).default(Moneda.ARS),
  tipoCambio: z.union([z.string(), z.number()]).default(1),
  lineas: z.array(lineaSchema).min(2),
});

export type LineaInput = z.input<typeof lineaSchema>;
export type CrearAsientoInput = z.input<typeof crearAsientoSchema>;

const MAX_NUMERACION_RETRIES = 5;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withNumeracionRetry<T>(run: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_NUMERACION_RETRIES; attempt++) {
    try {
      return await run();
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        lastErr = err;
        await sleep(5 + Math.floor(Math.random() * 20));
        continue;
      }
      throw err;
    }
  }
  throw new AsientoError(
    "NUMERACION_FALHOU",
    `No se pudo asignar un número secuencial de asiento tras ${MAX_NUMERACION_RETRIES} intentos.`,
    { cause: lastErr },
  );
}

async function obtenerProximoNumero(
  tx: TxClient,
  periodoId: number,
): Promise<number> {
  const agg = await tx.asiento.aggregate({
    where: { periodoId },
    _max: { numero: true },
  });
  return (agg._max.numero ?? 0) + 1;
}

async function resolverPeriodo(
  tx: TxClient,
  fecha: Date,
): Promise<{ id: number; estado: PeriodoEstado }> {
  const periodo = await tx.periodoContable.findFirst({
    where: {
      fechaInicio: { lte: fecha },
      fechaFin: { gte: fecha },
    },
    select: { id: true, estado: true },
  });

  if (!periodo) {
    throw new AsientoError(
      "PERIODO_INEXISTENTE",
      `No existe un período contable que contenga la fecha ${fecha.toISOString()}.`,
    );
  }

  if (periodo.estado !== PeriodoEstado.ABIERTO) {
    throw new AsientoError(
      "PERIODO_CERRADO",
      `El período contable ${periodo.id} está ${periodo.estado}.`,
    );
  }

  return periodo;
}

async function validarCuentas(
  tx: TxClient,
  cuentaIds: number[],
): Promise<void> {
  const ids = Array.from(new Set(cuentaIds));
  const cuentas = await tx.cuentaContable.findMany({
    where: { id: { in: ids } },
    select: { id: true, tipo: true, activa: true, codigo: true },
  });

  if (cuentas.length !== ids.length) {
    const encontrados = new Set(cuentas.map((c) => c.id));
    const faltantes = ids.filter((id) => !encontrados.has(id));
    throw new AsientoError(
      "CUENTA_INVALIDA",
      `Cuentas contables no encontradas: ${faltantes.join(", ")}.`,
    );
  }

  for (const cuenta of cuentas) {
    if (!cuenta.activa) {
      throw new AsientoError(
        "CUENTA_INACTIVA",
        `La cuenta ${cuenta.codigo} (id ${cuenta.id}) está inactiva.`,
      );
    }
    if (cuenta.tipo !== CuentaTipo.ANALITICA) {
      throw new AsientoError(
        "CUENTA_SINTETICA",
        `La cuenta ${cuenta.codigo} (id ${cuenta.id}) es SINTETICA; sólo cuentas ANALITICA aceptan líneas.`,
      );
    }
  }
}

function validarLineasYBalance(lineas: LineaInput[]): {
  totalDebe: Prisma.Decimal;
  totalHaber: Prisma.Decimal;
} {
  for (const [idx, linea] of lineas.entries()) {
    const debePos = gtZero(linea.debe ?? 0);
    const haberPos = gtZero(linea.haber ?? 0);
    if (debePos === haberPos) {
      throw new AsientoError(
        "LINEA_INVALIDA",
        `Línea ${idx + 1}: debe exactamente un lado (debe XOR haber) ser mayor a cero.`,
      );
    }
    if (toDecimal(linea.debe ?? 0).lt(0) || toDecimal(linea.haber ?? 0).lt(0)) {
      throw new AsientoError(
        "LINEA_INVALIDA",
        `Línea ${idx + 1}: los valores no pueden ser negativos.`,
      );
    }
  }

  const totalDebeDec = sumMoney(lineas.map((l) => l.debe ?? 0));
  const totalHaberDec = sumMoney(lineas.map((l) => l.haber ?? 0));

  if (!eqMoney(totalDebeDec, totalHaberDec)) {
    throw new AsientoError(
      "DESBALANCEADO",
      `La suma del Debe (${totalDebeDec.toFixed(2)}) no coincide con la suma del Haber (${totalHaberDec.toFixed(2)}).`,
    );
  }

  return {
    totalDebe: money(totalDebeDec),
    totalHaber: money(totalHaberDec),
  };
}

async function crearAsientoEnTx(
  tx: TxClient,
  input: CrearAsientoInput,
): Promise<Asiento> {
  const parsed = crearAsientoSchema.parse(input);

  const { totalDebe, totalHaber } = validarLineasYBalance(parsed.lineas);

  const tcDec = toDecimal(parsed.tipoCambio);
  if (tcDec.lte(0)) {
    throw new AsientoError(
      "LINEA_INVALIDA",
      "tipoCambio debe ser mayor a cero.",
    );
  }
  if (parsed.moneda === Moneda.ARS && !tcDec.eq(1)) {
    throw new AsientoError(
      "LINEA_INVALIDA",
      "tipoCambio debe ser 1 cuando moneda=ARS.",
    );
  }

  const periodo = await resolverPeriodo(tx, parsed.fecha);
  await validarCuentas(
    tx,
    parsed.lineas.map((l) => l.cuentaId),
  );

  const numero = await obtenerProximoNumero(tx, periodo.id);

  return tx.asiento.create({
    data: {
      numero,
      fecha: parsed.fecha,
      descripcion: parsed.descripcion,
      estado: AsientoEstado.BORRADOR,
      origen: parsed.origen,
      moneda: parsed.moneda,
      tipoCambio: new Prisma.Decimal(tcDec.toFixed(6)),
      totalDebe,
      totalHaber,
      periodo: { connect: { id: periodo.id } },
      lineas: {
        create: parsed.lineas.map((l) => ({
          cuentaId: l.cuentaId,
          debe: money(l.debe ?? 0),
          haber: money(l.haber ?? 0),
          descripcion: l.descripcion,
        })),
      },
    },
  });
}

export async function crearAsientoManual(
  input: CrearAsientoInput,
  tx?: TxClient,
): Promise<Asiento> {
  if (tx) {
    return crearAsientoEnTx(tx, input);
  }
  return withNumeracionRetry(() =>
    db.$transaction((innerTx) => crearAsientoEnTx(innerTx, input)),
  );
}

async function contabilizarEnTx(
  tx: TxClient,
  asientoId: string,
): Promise<Asiento> {
  const asiento = await tx.asiento.findUnique({
    where: { id: asientoId },
    include: { periodo: { select: { estado: true } } },
  });

  if (!asiento) {
    throw new AsientoError(
      "ASIENTO_INEXISTENTE",
      `El asiento ${asientoId} no existe.`,
    );
  }

  if (asiento.estado !== AsientoEstado.BORRADOR) {
    throw new AsientoError(
      "ESTADO_INVALIDO",
      `Sólo asientos en BORRADOR pueden contabilizarse (estado actual: ${asiento.estado}).`,
    );
  }

  if (asiento.periodo.estado !== PeriodoEstado.ABIERTO) {
    throw new AsientoError(
      "PERIODO_CERRADO",
      `El período del asiento está ${asiento.periodo.estado}.`,
    );
  }

  if (!eqMoney(asiento.totalDebe, asiento.totalHaber)) {
    throw new AsientoError(
      "DESBALANCEADO",
      `El asiento ${asiento.numero} está desbalanceado en base de datos.`,
    );
  }

  return tx.asiento.update({
    where: { id: asientoId },
    data: { estado: AsientoEstado.CONTABILIZADO },
  });
}

export async function contabilizarAsiento(
  asientoId: string,
  tx?: TxClient,
): Promise<Asiento> {
  if (tx) return contabilizarEnTx(tx, asientoId);
  return db.$transaction((innerTx) => contabilizarEnTx(innerTx, asientoId));
}

async function anularEnTx(tx: TxClient, asientoId: string): Promise<Asiento> {
  const asiento = await tx.asiento.findUnique({
    where: { id: asientoId },
    include: { periodo: { select: { estado: true } } },
  });

  if (!asiento) {
    throw new AsientoError(
      "ASIENTO_INEXISTENTE",
      `El asiento ${asientoId} no existe.`,
    );
  }

  if (asiento.estado !== AsientoEstado.CONTABILIZADO) {
    throw new AsientoError(
      "ESTADO_INVALIDO",
      `Sólo asientos CONTABILIZADO pueden anularse (estado actual: ${asiento.estado}).`,
    );
  }

  if (asiento.periodo.estado !== PeriodoEstado.ABIERTO) {
    throw new AsientoError(
      "PERIODO_CERRADO",
      `No se puede anular un asiento en período ${asiento.periodo.estado}.`,
    );
  }

  // Detach any operational record linked to this asiento so it becomes
  // editable / re-postable. The accounting trail still shows the asiento
  // as ANULADO; this just unlocks the source document (embarque,
  // movimiento, préstamo, venta).
  //
  // Embarques además requieren revertir el ingreso de stock (borrar
  // MovimientoStock + recalcular costoPromedio/stockActual) — si no, el
  // costo medio de los productos quedaría inflado fantásmicamente.
  const embarquesAnulados = await tx.embarque.findMany({
    where: { asientoId },
    select: { id: true },
  });
  for (const e of embarquesAnulados) {
    await revertirIngresoEmbarque(tx, e.id);
  }
  await tx.embarque.updateMany({
    where: { asientoId },
    data: {
      asientoId: null,
      estado: EmbarqueEstado.EN_DEPOSITO,
    },
  });
  await tx.movimientoTesoreria.updateMany({
    where: { asientoId },
    data: { asientoId: null },
  });
  await tx.prestamoExterno.updateMany({
    where: { asientoId },
    data: { asientoId: null },
  });
  await tx.venta.updateMany({
    where: { asientoId },
    data: { asientoId: null, estado: "CANCELADA" },
  });
  await tx.compra.updateMany({
    where: { asientoId },
    data: { asientoId: null, estado: "CANCELADA" },
  });

  return tx.asiento.update({
    where: { id: asientoId },
    data: { estado: AsientoEstado.ANULADO },
  });
}

export async function anularAsiento(
  asientoId: string,
  tx?: TxClient,
): Promise<Asiento> {
  if (tx) return anularEnTx(tx, asientoId);
  return db.$transaction((innerTx) => anularEnTx(innerTx, asientoId));
}

// ============================================================
// Generadores operación-específicos
// ============================================================

export async function crearAsientoPrestamo(
  prestamoId: string,
  fecha: Date,
  tx?: TxClient,
): Promise<Asiento> {
  const run = async (inner: TxClient) => {
    const prestamo = await inner.prestamoExterno.findUnique({
      where: { id: prestamoId },
      include: { cuentaBancaria: { select: { cuentaContableId: true } } },
    });

    if (!prestamo) {
      throw new AsientoError(
        "DOMINIO_INVALIDO",
        `PrestamoExterno ${prestamoId} no existe.`,
      );
    }

    if (prestamo.asientoId) {
      throw new AsientoError(
        "ESTADO_INVALIDO",
        `El préstamo ${prestamoId} ya tiene un asiento asociado (${prestamo.asientoId}).`,
      );
    }

    const valor = money(
      toDecimal(prestamo.principal).mul(toDecimal(prestamo.tipoCambio)),
    );

    const asiento = await crearAsientoEnTx(inner, {
      fecha,
      descripcion: `Préstamo ${prestamo.prestamista} — principal ${prestamo.moneda} ${toDecimal(prestamo.principal).toFixed(2)}`,
      origen: AsientoOrigen.TESORERIA,
      lineas: [
        {
          cuentaId: prestamo.cuentaBancaria.cuentaContableId,
          debe: valor.toString(),
          haber: 0,
          descripcion: "Ingreso por préstamo",
        },
        {
          cuentaId: prestamo.cuentaContableId,
          debe: 0,
          haber: valor.toString(),
          descripcion: "Reconocimiento de deuda",
        },
      ],
    });

    await inner.prestamoExterno.update({
      where: { id: prestamoId },
      data: { asientoId: asiento.id },
    });

    return asiento;
  };

  if (tx) return run(tx);
  return withNumeracionRetry(() => db.$transaction(run));
}

export async function crearAsientoMovimientoTesoreria(
  movimientoId: string,
  tx?: TxClient,
): Promise<Asiento> {
  const run = async (inner: TxClient) => {
    const mov = await inner.movimientoTesoreria.findUnique({
      where: { id: movimientoId },
      include: { cuentaBancaria: { select: { cuentaContableId: true } } },
    });

    if (!mov) {
      throw new AsientoError(
        "DOMINIO_INVALIDO",
        `MovimientoTesoreria ${movimientoId} no existe.`,
      );
    }

    if (mov.asientoId) {
      throw new AsientoError(
        "ESTADO_INVALIDO",
        `El movimiento ${movimientoId} ya tiene un asiento asociado (${mov.asientoId}).`,
      );
    }

    const bancoCuentaId = mov.cuentaBancaria.cuentaContableId;
    const contrapartidaId = mov.cuentaContableId;
    const valor = money(mov.monto).toString();

    let lineas: LineaInput[];
    switch (mov.tipo) {
      case MovimientoTesoreriaTipo.COBRO:
        lineas = [
          { cuentaId: bancoCuentaId, debe: valor, haber: 0 },
          { cuentaId: contrapartidaId, debe: 0, haber: valor },
        ];
        break;
      case MovimientoTesoreriaTipo.PAGO:
        lineas = [
          { cuentaId: contrapartidaId, debe: valor, haber: 0 },
          { cuentaId: bancoCuentaId, debe: 0, haber: valor },
        ];
        break;
      case MovimientoTesoreriaTipo.TRANSFERENCIA:
        // contrapartida = cuenta contable del banco DESTINO
        lineas = [
          { cuentaId: contrapartidaId, debe: valor, haber: 0 },
          { cuentaId: bancoCuentaId, debe: 0, haber: valor },
        ];
        break;
    }

    const asiento = await crearAsientoEnTx(inner, {
      fecha: mov.fecha,
      descripcion: `${mov.tipo} ${mov.moneda} ${toDecimal(mov.monto).toFixed(2)}`,
      origen: AsientoOrigen.TESORERIA,
      moneda: mov.moneda,
      tipoCambio: mov.tipoCambio.toString(),
      lineas,
    });

    await inner.movimientoTesoreria.update({
      where: { id: movimientoId },
      data: { asientoId: asiento.id },
    });

    return asiento;
  };

  if (tx) return run(tx);
  return withNumeracionRetry(() => db.$transaction(run));
}

export type CrearTransferenciaInput = {
  fecha: Date;
  cuentaBancariaOrigenId: string;
  cuentaBancariaDestinoId: string;
  montoOrigen: string;
  montoDestino: string;
  tipoCambioOrigen: string;
  tipoCambioDestino: string;
  descripcion?: string | null;
};

export async function crearAsientoTransferencia(
  input: CrearTransferenciaInput,
  tx?: TxClient,
): Promise<{ asiento: Asiento; movimientoId: string }> {
  const run = async (
    inner: TxClient,
  ): Promise<{ asiento: Asiento; movimientoId: string }> => {
    if (input.cuentaBancariaOrigenId === input.cuentaBancariaDestinoId) {
      throw new AsientoError(
        "DOMINIO_INVALIDO",
        "La cuenta origen y destino deben ser distintas.",
      );
    }

    const [origen, destino] = await Promise.all([
      inner.cuentaBancaria.findUnique({
        where: { id: input.cuentaBancariaOrigenId },
        select: {
          id: true,
          banco: true,
          moneda: true,
          cuentaContableId: true,
          cuentaContable: { select: { codigo: true, nombre: true } },
        },
      }),
      inner.cuentaBancaria.findUnique({
        where: { id: input.cuentaBancariaDestinoId },
        select: {
          id: true,
          banco: true,
          moneda: true,
          cuentaContableId: true,
          cuentaContable: { select: { codigo: true, nombre: true } },
        },
      }),
    ]);

    if (!origen) {
      throw new AsientoError(
        "DOMINIO_INVALIDO",
        `CuentaBancaria origen ${input.cuentaBancariaOrigenId} no existe.`,
      );
    }
    if (!destino) {
      throw new AsientoError(
        "DOMINIO_INVALIDO",
        `CuentaBancaria destino ${input.cuentaBancariaDestinoId} no existe.`,
      );
    }

    const montoOrigenDec = toDecimal(input.montoOrigen);
    const montoDestinoDec = toDecimal(input.montoDestino);
    const tcOrigenDec = toDecimal(input.tipoCambioOrigen);
    const tcDestinoDec = toDecimal(input.tipoCambioDestino);

    if (montoOrigenDec.lte(0)) {
      throw new AsientoError(
        "LINEA_INVALIDA",
        "El monto origen debe ser mayor a cero.",
      );
    }
    if (montoDestinoDec.lte(0)) {
      throw new AsientoError(
        "LINEA_INVALIDA",
        "El monto destino debe ser mayor a cero.",
      );
    }
    if (tcOrigenDec.lte(0) || tcDestinoDec.lte(0)) {
      throw new AsientoError(
        "LINEA_INVALIDA",
        "Los tipos de cambio deben ser mayores a cero.",
      );
    }
    if (origen.moneda === Moneda.ARS && !tcOrigenDec.eq(1)) {
      throw new AsientoError(
        "LINEA_INVALIDA",
        "tipoCambio origen debe ser 1 cuando la moneda origen es ARS.",
      );
    }
    if (destino.moneda === Moneda.ARS && !tcDestinoDec.eq(1)) {
      throw new AsientoError(
        "LINEA_INVALIDA",
        "tipoCambio destino debe ser 1 cuando la moneda destino es ARS.",
      );
    }

    const origenArs = money(montoOrigenDec.mul(tcOrigenDec));
    const destinoArs = money(montoDestinoDec.mul(tcDestinoDec));
    const diff = toDecimal(destinoArs).minus(toDecimal(origenArs));

    const lineas: LineaInput[] = [
      {
        cuentaId: destino.cuentaContableId,
        debe: destinoArs.toString(),
        haber: 0,
        descripcion: `Transferencia recibida desde ${origen.banco}`,
      },
      {
        cuentaId: origen.cuentaContableId,
        debe: 0,
        haber: origenArs.toString(),
        descripcion: `Transferencia enviada a ${destino.banco}`,
      },
    ];

    if (!eqMoney(origenArs, destinoArs)) {
      const cuentasDif = await ensureCuentasMap(inner, TRANSFERENCIA_CODIGOS);
      const cuentaDifId = diff.gt(0)
        ? cuentasDif.get(TRANSFERENCIA_CODIGOS.DIF_CAMBIO_POSITIVA.codigo)!
        : cuentasDif.get(TRANSFERENCIA_CODIGOS.DIF_CAMBIO_NEGATIVA.codigo)!;

      const absDiff = money(diff.abs()).toString();
      lineas.push({
        cuentaId: cuentaDifId,
        debe: diff.gt(0) ? 0 : absDiff,
        haber: diff.gt(0) ? absDiff : 0,
        descripcion: diff.gt(0)
          ? "Diferencia de cambio positiva"
          : "Diferencia de cambio negativa",
      });
    }

    const descripcionAsiento = input.descripcion?.trim()
      ? input.descripcion.trim()
      : `Transferencia ${origen.banco} → ${destino.banco}`;

    const asiento = await crearAsientoEnTx(inner, {
      fecha: input.fecha,
      descripcion: descripcionAsiento,
      origen: AsientoOrigen.TESORERIA,
      moneda: Moneda.ARS,
      tipoCambio: 1,
      lineas,
    });

    const mov = await inner.movimientoTesoreria.create({
      data: {
        tipo: MovimientoTesoreriaTipo.TRANSFERENCIA,
        cuentaBancariaId: origen.id,
        cuentaContableId: destino.cuentaContableId,
        fecha: input.fecha,
        monto: money(montoOrigenDec),
        moneda: origen.moneda,
        tipoCambio: new Prisma.Decimal(tcOrigenDec.toFixed(6)),
        descripcion: input.descripcion ?? null,
        asientoId: asiento.id,
      },
      select: { id: true },
    });

    return { asiento, movimientoId: mov.id };
  };

  if (tx) return run(tx);
  return withNumeracionRetry(() => db.$transaction(run));
}

export async function crearAsientoEmbarque(
  embarqueId: string,
  tx?: TxClient,
): Promise<Asiento> {
  const run = async (inner: TxClient) => {
    const embarque = await inner.embarque.findUnique({
      where: { id: embarqueId },
      include: {
        proveedor: { select: { id: true, nombre: true, cuentaContableId: true } },
        costos: {
          include: {
            proveedor: {
              select: { id: true, nombre: true, cuentaContableId: true },
            },
            lineas: { orderBy: { id: "asc" } },
          },
          orderBy: { id: "asc" },
        },
      },
    });

    if (!embarque) {
      throw new AsientoError(
        "DOMINIO_INVALIDO",
        `Embarque ${embarqueId} no existe.`,
      );
    }

    if (embarque.asientoId) {
      throw new AsientoError(
        "DOMINIO_INVALIDO",
        `Embarque ${embarque.codigo} ya tiene un asiento contable (${embarque.asientoId}).`,
      );
    }

    const porCodigo = await ensureCuentasMap(inner, EMBARQUE_CODIGOS);

    const tcEmb = toDecimal(embarque.tipoCambio);
    const fobArs = toDecimal(embarque.fobTotal).times(tcEmb).toDecimalPlaces(2);
    // Flete/seguro contratados por el proveedor en origen (CIF/CFR): se
    // suman al monto adeudado al proveedor del exterior (van en la misma
    // factura) y al costo de la mercadería en tránsito.
    const fleteOrigenArs = embarque.valorFleteOrigen
      ? toDecimal(embarque.valorFleteOrigen).times(tcEmb).toDecimalPlaces(2)
      : toDecimal(0);
    const seguroOrigenArs = embarque.valorSeguroOrigen
      ? toDecimal(embarque.valorSeguroOrigen).times(tcEmb).toDecimalPlaces(2)
      : toDecimal(0);
    const totalProveedorExteriorArs = fobArs
      .plus(fleteOrigenArs)
      .plus(seguroOrigenArs);

    // Tributos vienen en moneda del embarque (despacho en USD); se convierten
    // a ARS aplicando el TC del embarque. Cada uno se redondea a 2dp ANTES
    // de sumarlos para el HABER consolidado, garantizando DEBE = HABER.
    const die = toDecimal(embarque.die).times(tcEmb).toDecimalPlaces(2);
    const te = toDecimal(embarque.tasaEstadistica)
      .times(tcEmb)
      .toDecimalPlaces(2);
    const arancelSim = toDecimal(embarque.arancelSim)
      .times(tcEmb)
      .toDecimalPlaces(2);
    const ivaAduana = toDecimal(embarque.iva).times(tcEmb).toDecimalPlaces(2);
    const ivaAdicional = toDecimal(embarque.ivaAdicional)
      .times(tcEmb)
      .toDecimalPlaces(2);
    const iibbAduana = toDecimal(embarque.iibb)
      .times(tcEmb)
      .toDecimalPlaces(2);
    const ganancias = toDecimal(embarque.ganancias)
      .times(tcEmb)
      .toDecimalPlaces(2);

    type Linea = {
      cuentaId: number;
      debe: import("decimal.js").Decimal;
      haber: import("decimal.js").Decimal;
      descripcion: string;
    };
    const lineas: Linea[] = [];

    const pushDebe = (
      cuentaId: number,
      valor: import("decimal.js").Decimal,
      descripcion: string,
    ) => {
      if (!valor.gt(0)) return;
      lineas.push({
        cuentaId,
        debe: valor,
        haber: toDecimal(0),
        descripcion,
      });
    };
    const pushHaber = (
      cuentaId: number,
      valor: import("decimal.js").Decimal,
      descripcion: string,
    ) => {
      if (!valor.gt(0)) return;
      lineas.push({
        cuentaId,
        debe: toDecimal(0),
        haber: valor,
        descripcion,
      });
    };

    // 1) FOB (+ flete/seguro origen si CIF/CFR) → Mercadería en tránsito
    //    vs. proveedor del exterior. Si ya hay asiento de Zona Primaria,
    //    el FOB ya fue contabilizado allí — saltar acá.
    const proveedorExteriorCuentaId =
      embarque.proveedor.cuentaContableId ??
      porCodigo.get(EMBARQUE_CODIGOS.PROVEEDOR_EXTERIOR_FALLBACK.codigo)!;
    const tieneZonaPrimaria = !!embarque.asientoZonaPrimariaId;
    const detalleOrigen =
      fleteOrigenArs.gt(0) || seguroOrigenArs.gt(0)
        ? ` (FOB + flete${seguroOrigenArs.gt(0) ? " + seguro" : ""} origen)`
        : "";
    if (!tieneZonaPrimaria) {
      pushDebe(
        porCodigo.get(EMBARQUE_CODIGOS.MERCADERIAS_EN_TRANSITO.codigo)!,
        totalProveedorExteriorArs,
        `Embarque ${embarque.codigo} (${embarque.proveedor.nombre})${detalleOrigen}`,
      );
      pushHaber(
        proveedorExteriorCuentaId,
        totalProveedorExteriorArs,
        `Proveedor exterior (${embarque.proveedor.nombre})${detalleOrigen}`,
      );
    }

    // 2) Tributos aduaneros (DEBE gasto/crédito, HABER AFIP/Aduana por pagar)
    pushDebe(porCodigo.get(EMBARQUE_CODIGOS.DIE_EGRESO.codigo)!, die, "DIE");
    pushHaber(
      porCodigo.get(EMBARQUE_CODIGOS.DIE_PASIVO.codigo)!,
      die,
      "DIE por pagar (Aduana)",
    );

    pushDebe(
      porCodigo.get(EMBARQUE_CODIGOS.TASA_ESTADISTICA_EGRESO.codigo)!,
      te,
      "Tasa estadística",
    );
    pushHaber(
      porCodigo.get(EMBARQUE_CODIGOS.TASA_ESTADISTICA_PASIVO.codigo)!,
      te,
      "Tasa estadística por pagar",
    );

    pushDebe(
      porCodigo.get(EMBARQUE_CODIGOS.ARANCEL_SIM_EGRESO.codigo)!,
      arancelSim,
      "Arancel SIM",
    );
    pushHaber(
      porCodigo.get(EMBARQUE_CODIGOS.ARANCEL_SIM_PASIVO.codigo)!,
      arancelSim,
      "Arancel SIM por pagar",
    );

    pushDebe(
      porCodigo.get(EMBARQUE_CODIGOS.IVA_CREDITO_IMPORTACION.codigo)!,
      ivaAduana,
      "IVA crédito fiscal importación",
    );
    pushDebe(
      porCodigo.get(EMBARQUE_CODIGOS.IVA_ADICIONAL_CREDITO.codigo)!,
      ivaAdicional,
      "IVA adicional importación",
    );
    pushHaber(
      porCodigo.get(EMBARQUE_CODIGOS.IVA_POR_PAGAR.codigo)!,
      ivaAduana.plus(ivaAdicional),
      "IVA importación por pagar (IVA + adicional)",
    );

    pushDebe(
      porCodigo.get(EMBARQUE_CODIGOS.IIBB_CREDITO_IMPORTACION.codigo)!,
      iibbAduana,
      "Percepción IIBB importación",
    );
    pushHaber(
      porCodigo.get(EMBARQUE_CODIGOS.IIBB_POR_PAGAR.codigo)!,
      iibbAduana,
      "IIBB importación por pagar",
    );

    pushDebe(
      porCodigo.get(EMBARQUE_CODIGOS.GANANCIAS_CREDITO.codigo)!,
      ganancias,
      "Percepción Ganancias importación",
    );
    pushHaber(
      porCodigo.get(EMBARQUE_CODIGOS.GANANCIAS_POR_PAGAR.codigo)!,
      ganancias,
      "Ganancias importación por pagar",
    );

    // 3) Gastos de nacionalización: por cada factura (proveedor local)
    //    iteramos sus líneas (gastos individuales) generando una línea
    //    DEBE por concepto a su cuenta de gasto. Luego, IVA/IIBB/otros
    //    a nivel factura van a las cuentas de crédito fiscal. Todo
    //    contra la cuenta del proveedor en HABER (consolidado).
    //
    //    Si ya hay asiento de Zona Primaria, sólo procesamos facturas
    //    con momento === DESPACHO (las de ZONA_PRIMARIA ya están en
    //    el asiento de ZP).
    const facturasParaCierre = tieneZonaPrimaria
      ? embarque.costos.filter((f) => f.momento !== "ZONA_PRIMARIA")
      : embarque.costos;
    for (const factura of facturasParaCierre) {
      if (factura.lineas.length === 0) continue;

      if (!factura.proveedor.cuentaContableId) {
        throw new AsientoError(
          "CUENTA_INVALIDA",
          `El proveedor ${factura.proveedor.nombre} no tiene cuenta contable asociada (revisar Maestros / Proveedores).`,
        );
      }

      const tc = toDecimal(factura.tipoCambio);
      const facturaLabel = `${factura.proveedor.nombre}${factura.facturaNumero ? ` Fact.${factura.facturaNumero}` : ""}`;

      // Subtotales por línea (cada gasto a su cuenta analítica)
      let subtotalFacturaArs = toDecimal(0);
      for (const linea of factura.lineas) {
        const subtotalArs = toDecimal(linea.subtotal)
          .times(tc)
          .toDecimalPlaces(2);
        if (!subtotalArs.gt(0)) continue;

        const lineaLabel =
          linea.descripcion?.trim() ||
          linea.tipo.replace(/_/g, " ").toLowerCase();
        pushDebe(
          linea.cuentaContableGastoId,
          subtotalArs,
          `${facturaLabel} — ${lineaLabel}`,
        );
        subtotalFacturaArs = subtotalFacturaArs.plus(subtotalArs);
      }

      // IVA/IIBB/otros a nivel factura (no por línea)
      const ivaArs = toDecimal(factura.iva).times(tc).toDecimalPlaces(2);
      const iibbArs = toDecimal(factura.iibb).times(tc).toDecimalPlaces(2);
      const otrosArs = toDecimal(factura.otros).times(tc).toDecimalPlaces(2);

      pushDebe(
        porCodigo.get(EMBARQUE_CODIGOS.IVA_CREDITO_COMPRAS.codigo)!,
        ivaArs,
        `${facturaLabel} — IVA crédito`,
      );
      pushDebe(
        porCodigo.get(EMBARQUE_CODIGOS.IIBB_CREDITO_COMPRAS.codigo)!,
        iibbArs,
        `${facturaLabel} — IIBB crédito`,
      );
      // "Otros" se imputa al primer gasto de la factura (cuenta analítica
      // del primer line) por falta de una cuenta dedicada. Si quiere
      // separar, abra una línea propia para otros.
      if (otrosArs.gt(0) && factura.lineas.length > 0) {
        pushDebe(
          factura.lineas[0].cuentaContableGastoId,
          otrosArs,
          `${facturaLabel} — otros`,
        );
      }

      const totalFacturaArs = subtotalFacturaArs
        .plus(ivaArs)
        .plus(iibbArs)
        .plus(otrosArs);

      if (totalFacturaArs.gt(0)) {
        pushHaber(
          factura.proveedor.cuentaContableId,
          totalFacturaArs,
          `${facturaLabel} — total a pagar`,
        );
      }
    }

    if (lineas.length === 0) {
      throw new AsientoError(
        "DOMINIO_INVALIDO",
        `Embarque ${embarque.codigo} no tiene montos a contabilizar.`,
      );
    }

    const lineasInput: LineaInput[] = lineas.map((l) => ({
      cuentaId: l.cuentaId,
      debe: money(l.debe).toString(),
      haber: money(l.haber).toString(),
      descripcion: l.descripcion,
    }));

    const asiento = await crearAsientoEnTx(inner, {
      fecha: new Date(),
      descripcion: `Nacionalización embarque ${embarque.codigo}`,
      origen: AsientoOrigen.COMEX,
      lineas: lineasInput,
    });

    await inner.embarque.update({
      where: { id: embarqueId },
      data: { asientoId: asiento.id },
    });

    return asiento;
  };

  if (tx) return run(tx);
  return withNumeracionRetry(() => db.$transaction(run));
}

// ============================================================
// Embarque — Confirmación de Zona Primaria
// ============================================================
//
// Genera asiento parcial cuando la mercadería llegó al puerto / zona
// primaria aduanera. Contabiliza FOB (+ flete/seguro origen si CIF/CFR)
// contra el proveedor exterior + facturas con momento === ZONA_PRIMARIA
// (puerto, frete terrestre, op. logístico, gastos línea marítima).
//
// La mercadería NO se nacionaliza acá — queda en 1.1.5.02 MERCADERÍAS EN
// TRÁNSITO sin disponibilidad de stock. El despacho posterior (cierre)
// transfiere a 1.1.5.01 MERCADERÍAS y aplica el ingreso al depósito.

export async function crearAsientoZonaPrimaria(
  embarqueId: string,
  tx?: TxClient,
): Promise<Asiento> {
  const run = async (inner: TxClient) => {
    const embarque = await inner.embarque.findUnique({
      where: { id: embarqueId },
      include: {
        proveedor: { select: { id: true, nombre: true, cuentaContableId: true } },
        costos: {
          include: {
            proveedor: {
              select: { id: true, nombre: true, cuentaContableId: true },
            },
            lineas: { orderBy: { id: "asc" } },
          },
          orderBy: { id: "asc" },
        },
      },
    });

    if (!embarque) {
      throw new AsientoError(
        "DOMINIO_INVALIDO",
        `Embarque ${embarqueId} no existe.`,
      );
    }

    if (embarque.asientoZonaPrimariaId) {
      throw new AsientoError(
        "DOMINIO_INVALIDO",
        `Embarque ${embarque.codigo} ya tiene un asiento de Zona Primaria (${embarque.asientoZonaPrimariaId}).`,
      );
    }

    if (embarque.asientoId) {
      throw new AsientoError(
        "DOMINIO_INVALIDO",
        `Embarque ${embarque.codigo} ya está cerrado/despachado — no se puede registrar Zona Primaria después.`,
      );
    }

    const porCodigo = await ensureCuentasMap(inner, EMBARQUE_CODIGOS);

    const tcEmb = toDecimal(embarque.tipoCambio);
    const fobArs = toDecimal(embarque.fobTotal).times(tcEmb).toDecimalPlaces(2);
    const fleteOrigenArs = embarque.valorFleteOrigen
      ? toDecimal(embarque.valorFleteOrigen).times(tcEmb).toDecimalPlaces(2)
      : toDecimal(0);
    const seguroOrigenArs = embarque.valorSeguroOrigen
      ? toDecimal(embarque.valorSeguroOrigen).times(tcEmb).toDecimalPlaces(2)
      : toDecimal(0);
    const totalProveedorExteriorArs = fobArs
      .plus(fleteOrigenArs)
      .plus(seguroOrigenArs);

    type Linea = {
      cuentaId: number;
      debe: import("decimal.js").Decimal;
      haber: import("decimal.js").Decimal;
      descripcion: string;
    };
    const lineas: Linea[] = [];
    const pushDebe = (
      cuentaId: number,
      valor: import("decimal.js").Decimal,
      descripcion: string,
    ) => {
      if (!valor.gt(0)) return;
      lineas.push({ cuentaId, debe: valor, haber: toDecimal(0), descripcion });
    };
    const pushHaber = (
      cuentaId: number,
      valor: import("decimal.js").Decimal,
      descripcion: string,
    ) => {
      if (!valor.gt(0)) return;
      lineas.push({ cuentaId, debe: toDecimal(0), haber: valor, descripcion });
    };

    // 1) FOB (+ flete/seguro origen) → Mercadería en tránsito vs proveedor exterior
    const proveedorExteriorCuentaId =
      embarque.proveedor.cuentaContableId ??
      porCodigo.get(EMBARQUE_CODIGOS.PROVEEDOR_EXTERIOR_FALLBACK.codigo)!;
    const detalleOrigen =
      fleteOrigenArs.gt(0) || seguroOrigenArs.gt(0)
        ? ` (FOB + flete${seguroOrigenArs.gt(0) ? " + seguro" : ""} origen)`
        : "";
    pushDebe(
      porCodigo.get(EMBARQUE_CODIGOS.MERCADERIAS_EN_TRANSITO.codigo)!,
      totalProveedorExteriorArs,
      `Embarque ${embarque.codigo} (${embarque.proveedor.nombre})${detalleOrigen}`,
    );
    pushHaber(
      proveedorExteriorCuentaId,
      totalProveedorExteriorArs,
      `Proveedor exterior (${embarque.proveedor.nombre})${detalleOrigen}`,
    );

    // 2) Facturas con momento === ZONA_PRIMARIA (puerto, frete terrestre,
    //    op. logístico, gastos línea marítima local).
    const facturasZP = embarque.costos.filter((f) => f.momento === "ZONA_PRIMARIA");
    for (const factura of facturasZP) {
      if (factura.lineas.length === 0) continue;
      if (!factura.proveedor.cuentaContableId) {
        throw new AsientoError(
          "CUENTA_INVALIDA",
          `El proveedor ${factura.proveedor.nombre} no tiene cuenta contable asociada.`,
        );
      }

      const tc = toDecimal(factura.tipoCambio);
      const facturaLabel = `${factura.proveedor.nombre}${factura.facturaNumero ? ` Fact.${factura.facturaNumero}` : ""}`;

      let subtotalFacturaArs = toDecimal(0);
      for (const linea of factura.lineas) {
        const subtotalArs = toDecimal(linea.subtotal).times(tc).toDecimalPlaces(2);
        if (!subtotalArs.gt(0)) continue;
        const lineaLabel =
          linea.descripcion?.trim() || linea.tipo.replace(/_/g, " ").toLowerCase();
        pushDebe(linea.cuentaContableGastoId, subtotalArs, `${facturaLabel} — ${lineaLabel} (ZP)`);
        subtotalFacturaArs = subtotalFacturaArs.plus(subtotalArs);
      }

      const ivaArs = toDecimal(factura.iva).times(tc).toDecimalPlaces(2);
      const iibbArs = toDecimal(factura.iibb).times(tc).toDecimalPlaces(2);
      const otrosArs = toDecimal(factura.otros).times(tc).toDecimalPlaces(2);

      pushDebe(
        porCodigo.get(EMBARQUE_CODIGOS.IVA_CREDITO_COMPRAS.codigo)!,
        ivaArs,
        `${facturaLabel} — IVA crédito (ZP)`,
      );
      pushDebe(
        porCodigo.get(EMBARQUE_CODIGOS.IIBB_CREDITO_COMPRAS.codigo)!,
        iibbArs,
        `${facturaLabel} — IIBB crédito (ZP)`,
      );
      if (otrosArs.gt(0) && factura.lineas.length > 0) {
        pushDebe(
          factura.lineas[0].cuentaContableGastoId,
          otrosArs,
          `${facturaLabel} — otros (ZP)`,
        );
      }

      const totalFacturaArs = subtotalFacturaArs.plus(ivaArs).plus(iibbArs).plus(otrosArs);
      if (totalFacturaArs.gt(0)) {
        pushHaber(
          factura.proveedor.cuentaContableId,
          totalFacturaArs,
          `${facturaLabel} — total a pagar (ZP)`,
        );
      }
    }

    if (lineas.length === 0) {
      throw new AsientoError(
        "DOMINIO_INVALIDO",
        `Embarque ${embarque.codigo}: no hay FOB ni facturas de Zona Primaria para contabilizar.`,
      );
    }

    const lineasInput: LineaInput[] = lineas.map((l) => ({
      cuentaId: l.cuentaId,
      debe: money(l.debe).toString(),
      haber: money(l.haber).toString(),
      descripcion: l.descripcion,
    }));

    const asiento = await crearAsientoEnTx(inner, {
      fecha: new Date(),
      descripcion: `Zona primaria embarque ${embarque.codigo}`,
      origen: AsientoOrigen.COMEX,
      lineas: lineasInput,
    });

    await inner.embarque.update({
      where: { id: embarqueId },
      data: {
        asientoZonaPrimariaId: asiento.id,
        estado: "EN_ZONA_PRIMARIA",
      },
    });

    return asiento;
  };

  if (tx) return run(tx);
  return withNumeracionRetry(() => db.$transaction(run));
}

// ============================================================
// Ventas — asiento automático
// ============================================================
//
// DEBE  cliente.cuentaContableId (or 1.1.3.01 fallback)   total × TC (en ARS)
// HABER 4.1.1.01 Ventas Neumáticos                       subtotal × TC
// HABER 2.1.6.01 IVA Ventas por Pagar                    iva × TC
// HABER 2.1.3.02 IIBB por Pagar                          iibb × TC (si > 0)
// HABER 2.1.3.04 Otros Impuestos                         otros × TC (si > 0)
//
// El cliente es la contraparte deudora; la venta genera la cuenta a cobrar.
// Cada componente se redondea a 2dp ANTES de sumar para que DEBE = HABER exacto.

export async function crearAsientoVenta(
  ventaId: string,
  tx?: TxClient,
): Promise<Asiento> {
  const run = async (inner: TxClient) => {
    const venta = await inner.venta.findUnique({
      where: { id: ventaId },
      select: {
        id: true,
        numero: true,
        fecha: true,
        tipoCambio: true,
        subtotal: true,
        iva: true,
        iibb: true,
        otros: true,
        flete: true,
        asientoId: true,
        cliente: { select: { id: true, nombre: true, cuentaContableId: true } },
        items: {
          select: {
            cantidad: true,
            producto: { select: { costoPromedio: true } },
          },
        },
        chequesRecibidos: {
          select: { importe: true },
        },
      },
    });
    if (!venta) {
      throw new AsientoError(
        "DOMINIO_INVALIDO",
        `Venta ${ventaId} no existe.`,
      );
    }
    if (venta.asientoId) {
      throw new AsientoError(
        "DOMINIO_INVALIDO",
        `Venta ${venta.numero} ya tiene asiento contable.`,
      );
    }

    const porCodigo = await ensureCuentasMap(inner, VENTA_CODIGOS);

    const tc = toDecimal(venta.tipoCambio);
    const subtotal = toDecimal(venta.subtotal).times(tc).toDecimalPlaces(2);
    const iva = toDecimal(venta.iva).times(tc).toDecimalPlaces(2);
    const iibb = toDecimal(venta.iibb).times(tc).toDecimalPlaces(2);
    const otros = toDecimal(venta.otros).times(tc).toDecimalPlaces(2);
    const flete = toDecimal(venta.flete).times(tc).toDecimalPlaces(2);
    const total = subtotal.plus(iva).plus(iibb).plus(otros);

    // Costo de mercadería vendida (CMV) — usa costoPromedio del producto
    // al momento de emitir la venta. En ARS porque costoPromedio se
    // mantiene en pesos (capitalización post-rateio embarque).
    const totalCosto = venta.items
      .reduce(
        (acc, it) =>
          acc.plus(toDecimal(it.producto.costoPromedio).times(it.cantidad)),
        toDecimal(0),
      )
      .toDecimalPlaces(2);

    // Provisión Impuesto Ganancias sobre la utilidad bruta
    // (subtotal_venta - costo - flete). El flete reduce la utilidad
    // gravable porque es un gasto comercial deducible. Solo si > 0.
    const utilidadBruta = subtotal.minus(totalCosto).minus(flete);
    const provisionGanancias = utilidadBruta.gt(0)
      ? utilidadBruta
          .times(TASA_PROVISION_GANANCIAS)
          .toDecimalPlaces(2)
      : toDecimal(0);

    const clienteCuentaId =
      venta.cliente.cuentaContableId ??
      porCodigo.get(VENTA_CODIGOS.CLIENTE_FALLBACK.codigo)!;

    // Cheques recibidos como cobro: van a 1.1.4.20 VALORES A COBRAR.
    // El residual (total - cheques) queda como saldo del cliente.
    const totalCheques = venta.chequesRecibidos
      .reduce((acc, c) => acc.plus(toDecimal(c.importe)), toDecimal(0))
      .toDecimalPlaces(2);
    const cuentaChequesId = porCodigo.get(VENTA_CODIGOS.VALORES_A_COBRAR.codigo)!;
    const totalEnCheques = totalCheques.gt(total) ? total : totalCheques;
    const totalEnCliente = total.minus(totalEnCheques);

    const lineas: LineaInput[] = [];
    if (totalEnCheques.gt(0)) {
      lineas.push({
        cuentaId: cuentaChequesId,
        debe: money(totalEnCheques).toString(),
        haber: 0,
        descripcion: `Venta ${venta.numero} — cheques de terceros recibidos`,
      });
    }
    if (totalEnCliente.gt(0)) {
      lineas.push({
        cuentaId: clienteCuentaId,
        debe: money(totalEnCliente).toString(),
        haber: 0,
        descripcion: `Venta ${venta.numero} — ${venta.cliente.nombre}`,
      });
    }
    lineas.push({
      cuentaId: porCodigo.get(VENTA_CODIGOS.VENTAS.codigo)!,
      debe: 0,
      haber: money(subtotal).toString(),
      descripcion: `Venta ${venta.numero} — ingreso neto`,
    });
    if (iva.gt(0)) {
      lineas.push({
        cuentaId: porCodigo.get(VENTA_CODIGOS.IVA_DEBITO.codigo)!,
        debe: 0,
        haber: money(iva).toString(),
        descripcion: `Venta ${venta.numero} — IVA débito`,
      });
    }
    if (iibb.gt(0)) {
      lineas.push({
        cuentaId: porCodigo.get(VENTA_CODIGOS.IIBB_POR_PAGAR.codigo)!,
        debe: 0,
        haber: money(iibb).toString(),
        descripcion: `Venta ${venta.numero} — IIBB`,
      });
    }
    if (otros.gt(0)) {
      lineas.push({
        cuentaId: porCodigo.get(VENTA_CODIGOS.OTROS_IMPUESTOS.codigo)!,
        debe: 0,
        haber: money(otros).toString(),
        descripcion: `Venta ${venta.numero} — otros`,
      });
    }

    // CMV: DEBE costo / HABER mercaderías. Solo si hay costo registrado.
    if (totalCosto.gt(0)) {
      lineas.push({
        cuentaId: porCodigo.get(VENTA_CODIGOS.CMV.codigo)!,
        debe: money(totalCosto).toString(),
        haber: 0,
        descripcion: `Venta ${venta.numero} — CMV (costo a promedio)`,
      });
      lineas.push({
        cuentaId: porCodigo.get(VENTA_CODIGOS.MERCADERIAS.codigo)!,
        debe: 0,
        haber: money(totalCosto).toString(),
        descripcion: `Venta ${venta.numero} — egreso de stock`,
      });
    }

    // Flete sobre ventas — gasto pagado por nosotros (no facturado al
    // cliente). Genera DEBE gasto / HABER cta a pagar; el pago efectivo
    // se registra después por tesorería.
    if (flete.gt(0)) {
      lineas.push({
        cuentaId: porCodigo.get(VENTA_CODIGOS.FLETE_GASTO.codigo)!,
        debe: money(flete).toString(),
        haber: 0,
        descripcion: `Venta ${venta.numero} — flete sobre venta`,
      });
      lineas.push({
        cuentaId: porCodigo.get(VENTA_CODIGOS.FLETE_POR_PAGAR.codigo)!,
        debe: 0,
        haber: money(flete).toString(),
        descripcion: `Venta ${venta.numero} — flete por pagar`,
      });
    }

    // Provisión Impuesto Ganancias sobre utilidad bruta.
    if (provisionGanancias.gt(0)) {
      lineas.push({
        cuentaId: porCodigo.get(VENTA_CODIGOS.PROVISION_GANANCIAS_GASTO.codigo)!,
        debe: money(provisionGanancias).toString(),
        haber: 0,
        descripcion: `Venta ${venta.numero} — provisión Ganancias ${(TASA_PROVISION_GANANCIAS * 100).toFixed(0)}%`,
      });
      lineas.push({
        cuentaId: porCodigo.get(VENTA_CODIGOS.PROVISION_GANANCIAS_PASIVO.codigo)!,
        debe: 0,
        haber: money(provisionGanancias).toString(),
        descripcion: `Venta ${venta.numero} — Ganancias por pagar (devengado)`,
      });
    }

    const asiento = await crearAsientoEnTx(inner, {
      fecha: venta.fecha,
      descripcion: `Venta ${venta.numero} — ${venta.cliente.nombre}`,
      origen: AsientoOrigen.MANUAL,
      moneda: Moneda.ARS,
      tipoCambio: 1,
      lineas,
    });
    await inner.venta.update({
      where: { id: ventaId },
      data: { asientoId: asiento.id },
    });
    return asiento;
  };
  if (tx) return run(tx);
  return withNumeracionRetry(() => db.$transaction(run));
}

// ============================================================
// Compras locales — asiento automático
// ============================================================
//
// DEBE  1.1.5.01 Mercaderías                  subtotal × TC
// DEBE  1.1.4.08 IVA Crédito Fiscal Compras   iva × TC (si > 0)
// DEBE  1.1.4.11 Crédito IIBB Compras         iibb × TC (si > 0)
// HABER proveedor.cuentaContableId (or 2.1.1.01)   total × TC

export async function crearAsientoCompra(
  compraId: string,
  tx?: TxClient,
): Promise<Asiento> {
  const run = async (inner: TxClient) => {
    const compra = await inner.compra.findUnique({
      where: { id: compraId },
      include: {
        proveedor: {
          select: {
            id: true,
            nombre: true,
            cuentaContableId: true,
            cuentaGastoContableId: true,
            tipoProveedor: true,
          },
        },
      },
    });
    if (!compra) {
      throw new AsientoError(
        "DOMINIO_INVALIDO",
        `Compra ${compraId} no existe.`,
      );
    }
    if (compra.asientoId) {
      throw new AsientoError(
        "DOMINIO_INVALIDO",
        `Compra ${compra.numero} ya tiene asiento contable.`,
      );
    }

    const porCodigo = await ensureCuentasMap(inner, COMPRA_CODIGOS);

    // Contrapartida (DEBE) — preferencia:
    //   1. proveedor.cuentaGastoContableId (override manual)
    //   2. tipoProveedor → GASTO_POR_TIPO_PROVEEDOR (default por categoría)
    const gastoDef = GASTO_POR_TIPO_PROVEEDOR[compra.proveedor.tipoProveedor];
    const gastoCuentaId =
      compra.proveedor.cuentaGastoContableId ??
      (await getOrCreateCuenta(inner, gastoDef));

    const tc = toDecimal(compra.tipoCambio);
    const subtotal = toDecimal(compra.subtotal).times(tc).toDecimalPlaces(2);
    const iva = toDecimal(compra.iva).times(tc).toDecimalPlaces(2);
    const iibb = toDecimal(compra.iibb).times(tc).toDecimalPlaces(2);
    const otros = toDecimal(compra.otros).times(tc).toDecimalPlaces(2);
    const total = subtotal.plus(iva).plus(iibb).plus(otros);

    let proveedorCuentaId = compra.proveedor.cuentaContableId;
    if (!proveedorCuentaId) {
      proveedorCuentaId =
        porCodigo.get(COMPRA_CODIGOS.PROVEEDOR_FALLBACK.codigo) ?? null;
      if (!proveedorCuentaId) {
        throw new AsientoError(
          "CUENTA_INVALIDA",
          `Proveedor ${compra.proveedor.nombre} sin cuenta contable y falta fallback ${COMPRA_CODIGOS.PROVEEDOR_FALLBACK.codigo}.`,
        );
      }
    }

    const lineas: LineaInput[] = [
      {
        cuentaId: gastoCuentaId,
        debe: money(subtotal).toString(),
        haber: 0,
        descripcion: `Compra ${compra.numero} — ${gastoDef.nombre.toLowerCase()}`,
      },
    ];
    if (iva.gt(0)) {
      lineas.push({
        cuentaId: porCodigo.get(COMPRA_CODIGOS.IVA_CREDITO.codigo)!,
        debe: money(iva).toString(),
        haber: 0,
        descripcion: `Compra ${compra.numero} — IVA crédito`,
      });
    }
    if (iibb.gt(0)) {
      lineas.push({
        cuentaId: porCodigo.get(COMPRA_CODIGOS.IIBB_CREDITO.codigo)!,
        debe: money(iibb).toString(),
        haber: 0,
        descripcion: `Compra ${compra.numero} — IIBB crédito`,
      });
    }
    if (otros.gt(0)) {
      lineas.push({
        cuentaId: gastoCuentaId,
        debe: money(otros).toString(),
        haber: 0,
        descripcion: `Compra ${compra.numero} — otros`,
      });
    }
    lineas.push({
      cuentaId: proveedorCuentaId,
      debe: 0,
      haber: money(total).toString(),
      descripcion: `Compra ${compra.numero} — ${compra.proveedor.nombre}${compra.fechaVencimiento ? ` (vence ${compra.fechaVencimiento.toISOString().slice(0, 10)})` : ""}`,
    });

    const asiento = await crearAsientoEnTx(inner, {
      fecha: compra.fecha,
      descripcion: `Compra ${compra.numero} — ${compra.proveedor.nombre}`,
      origen: AsientoOrigen.MANUAL,
      moneda: Moneda.ARS,
      tipoCambio: 1,
      lineas,
    });
    await inner.compra.update({
      where: { id: compraId },
      data: { asientoId: asiento.id },
    });
    return asiento;
  };
  if (tx) return run(tx);
  return withNumeracionRetry(() => db.$transaction(run));
}
