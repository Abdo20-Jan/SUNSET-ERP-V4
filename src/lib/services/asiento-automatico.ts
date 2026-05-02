import "server-only";

import { z } from "zod";

import { db } from "@/lib/db";
import { eqMoney, gtZero, money, sumMoney, toDecimal } from "@/lib/decimal";
import { ensureCuentasMap, getOrCreateCuenta } from "@/lib/services/cuenta-auto";
import { revertirIngresoEmbarque } from "@/lib/services/stock";
import {
  COMPRA_CODIGOS,
  EMBARQUE_CODIGOS,
  EXTRACTO_BANCARIO_CODIGOS,
  GASTO_POR_TIPO_PROVEEDOR,
  PORCENTAJE_LEY_25413_COMPUTABLE,
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
  // Los períodos guardan fechaInicio/fechaFin a las 00:00 UTC del primer/último
  // día del mes. Si `fecha` cae al último día > 00:00 UTC, fechaFin (00:00) <
  // fecha y el lookup falla. Truncamos `fecha` al inicio del día UTC para
  // alinear con la representación de los bordes del período.
  const fechaDia = new Date(
    Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()),
  );

  const periodo = await tx.periodoContable.findFirst({
    where: {
      fechaInicio: { lte: fechaDia },
      fechaFin: { gte: fechaDia },
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
  await tx.gasto.updateMany({
    where: { asientoId },
    data: { asientoId: null, estado: "ANULADO" },
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
      include: {
        cuentaBancaria: { select: { cuentaContableId: true } },
        cuentaContable: { select: { codigo: true } },
      },
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

    // Caso especial — Impuesto Ley 25413 (Imp. al cheque/IDCB):
    // 33% va como crédito fiscal pago a cuenta de Ganancias (1.1.4.12),
    // 67% como gasto (5.8.1.06). Aplica sólo en PAGO y cuando la
    // contrapartida elegida es la cuenta del impuesto.
    const esImpuestoLey25413 =
      mov.tipo === MovimientoTesoreriaTipo.PAGO &&
      mov.cuentaContable?.codigo === "5.8.1.06";

    let lineas: LineaInput[];

    if (esImpuestoLey25413) {
      const creditoCuentaId = await getOrCreateCuenta(
        inner,
        EXTRACTO_BANCARIO_CODIGOS.CREDITO_LEY_25413_GANANCIAS,
      );
      const montoAbs = toDecimal(mov.monto).toNumber();
      const creditoMonto =
        Math.round(montoAbs * PORCENTAJE_LEY_25413_COMPUTABLE * 100) / 100;
      const gastoMonto = Math.round((montoAbs - creditoMonto) * 100) / 100;
      lineas = [
        {
          cuentaId: contrapartidaId,
          debe: gastoMonto.toFixed(2),
          haber: 0,
          descripcion: "Gasto no computable (67%)",
        },
        {
          cuentaId: creditoCuentaId,
          debe: creditoMonto.toFixed(2),
          haber: 0,
          descripcion: "Pago a cuenta Ganancias (33%)",
        },
        { cuentaId: bancoCuentaId, debe: 0, haber: valor },
      ];
    } else {
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
// Despacho parcial — asiento automático
// ============================================================
//
// Modelo: 1 embarque puede tener N despachos. Cada despacho oficializa
// una porción de la mercadería + sus tributos + sus facturas DESPACHO.
//
// Pre-requisito: el embarque DEBE tener Zona Primaria confirmada
// (`asientoZonaPrimariaId` no nulo). Sin ZP, la mercadería no está en
// 1.1.5.02 todavía y no hay nada para transferir.
// Restricción: el embarque NO puede tener `asientoId` (cierre legacy
// monolítico) — ambos flujos son mutuamente excluyentes.
//
// Asiento del despacho:
//
//   DEBE  1.1.5.01 MERCADERÍAS                    cant_dsp × costoUnit_enTransito
//   HABER 1.1.5.02 MERCADERÍAS EN TRÁNSITO         mismo
//
//   DEBE  5.4.1.40 DIE EGRESO                      die × tc_dsp
//   HABER 2.1.5.10 ARCA tributos por pagar         mismo (consolidado)
//   ...idem Tasa Estadística, Arancel SIM
//
//   DEBE  1.1.4.05 IVA Crédito Importación         iva × tc_dsp
//   DEBE  1.1.4.06 IVA Adicional Importación       ivaAdicional × tc_dsp
//   HABER 2.1.6.10 IVA Importación por pagar       (iva + ivaAdicional)
//
//   DEBE  1.1.4.07 IIBB Crédito Importación        iibb × tc_dsp
//   HABER 2.1.5.20 IIBB Importación por pagar      iibb
//
//   DEBE  1.1.4.11 Ganancias Crédito Importación   ganancias × tc_dsp
//   HABER 2.1.5.21 Ganancias Importación por pagar ganancias
//
//   Por cada factura linkada (despachoId === este despacho):
//     DEBE  cuenta_gasto_línea  subtotal × tc_factura
//     DEBE  IVA crédito         factura.iva × tc
//     DEBE  IIBB crédito        factura.iibb × tc
//     HABER proveedor.cuenta    total factura
//
// `costoUnit_enTransito` = (FOB + flete origen + seguro origen + Σ
// facturas ZP) ARS / cantidad_TOTAL_embarque, prorateado FOB-proporcional
// por ItemEmbarque.

export async function crearAsientoDespacho(
  despachoId: string,
  tx?: TxClient,
): Promise<Asiento> {
  const run = async (inner: TxClient) => {
    const despacho = await inner.despacho.findUnique({
      where: { id: despachoId },
      include: {
        embarque: {
          include: {
            proveedor: { select: { nombre: true } },
            items: { orderBy: { id: "asc" } },
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
        },
        items: {
          include: {
            itemEmbarque: {
              select: {
                id: true,
                cantidad: true,
                precioUnitarioFob: true,
                productoId: true,
              },
            },
          },
          orderBy: { id: "asc" },
        },
      },
    });

    if (!despacho) {
      throw new AsientoError(
        "DOMINIO_INVALIDO",
        `Despacho ${despachoId} no existe.`,
      );
    }
    if (despacho.estado !== "BORRADOR") {
      throw new AsientoError(
        "ESTADO_INVALIDO",
        `Despacho ${despacho.codigo} no está en BORRADOR (${despacho.estado}).`,
      );
    }
    if (despacho.asientoId) {
      throw new AsientoError(
        "DOMINIO_INVALIDO",
        `Despacho ${despacho.codigo} ya tiene un asiento.`,
      );
    }
    if (despacho.items.length === 0) {
      throw new AsientoError(
        "DOMINIO_INVALIDO",
        `Despacho ${despacho.codigo}: agregue al menos un ítem.`,
      );
    }

    const embarque = despacho.embarque;
    if (!embarque.asientoZonaPrimariaId) {
      throw new AsientoError(
        "ESTADO_INVALIDO",
        `Embarque ${embarque.codigo}: debe confirmar zona primaria antes de despachar.`,
      );
    }
    if (embarque.asientoId) {
      throw new AsientoError(
        "ESTADO_INVALIDO",
        `Embarque ${embarque.codigo}: ya tiene cierre monolítico — no admite despachos parciales.`,
      );
    }

    // Validar cantidades: cada ItemDespacho.cantidad ≤ remanente del
    // ItemEmbarque (cantidad total - lo ya despachado en otros despachos
    // CONTABILIZADO o BORRADOR del mismo embarque, excluyendo este).
    const otrosDespachos = await inner.despacho.findMany({
      where: {
        embarqueId: embarque.id,
        id: { not: despacho.id },
        estado: { not: "ANULADO" },
      },
      include: { items: true },
    });
    for (const item of despacho.items) {
      if (item.cantidad <= 0) {
        throw new AsientoError(
          "DOMINIO_INVALIDO",
          `Despacho ${despacho.codigo}: cantidad debe ser > 0.`,
        );
      }
      const yaDespachado = otrosDespachos
        .flatMap((d) => d.items)
        .filter((i) => i.itemEmbarqueId === item.itemEmbarqueId)
        .reduce((s, i) => s + i.cantidad, 0);
      const remanente = item.itemEmbarque.cantidad - yaDespachado;
      if (item.cantidad > remanente) {
        throw new AsientoError(
          "DOMINIO_INVALIDO",
          `Despacho ${despacho.codigo}: cantidad ${item.cantidad} excede remanente ${remanente} del ítem.`,
        );
      }
    }

    const porCodigo = await ensureCuentasMap(inner, EMBARQUE_CODIGOS);
    const tcEmb = toDecimal(embarque.tipoCambio);
    const tcDsp = toDecimal(despacho.tipoCambio);

    // Costo en tránsito total del embarque (lo que cargó 1.1.5.02 entre
    // FOB+origen y facturas ZP). Convertido a ARS.
    const fobArs = toDecimal(embarque.fobTotal).times(tcEmb).toDecimalPlaces(2);
    const fleteOrigenArs = embarque.valorFleteOrigen
      ? toDecimal(embarque.valorFleteOrigen).times(tcEmb).toDecimalPlaces(2)
      : toDecimal(0);
    const seguroOrigenArs = embarque.valorSeguroOrigen
      ? toDecimal(embarque.valorSeguroOrigen).times(tcEmb).toDecimalPlaces(2)
      : toDecimal(0);
    const facturasZP = embarque.costos.filter(
      (f) => f.momento === "ZONA_PRIMARIA",
    );
    let zpFacturasArs = toDecimal(0);
    for (const f of facturasZP) {
      const tc = toDecimal(f.tipoCambio);
      const subtot = f.lineas.reduce(
        (s, l) => s.plus(toDecimal(l.subtotal).times(tc).toDecimalPlaces(2)),
        toDecimal(0),
      );
      const iva = toDecimal(f.iva).times(tc).toDecimalPlaces(2);
      const iibb = toDecimal(f.iibb).times(tc).toDecimalPlaces(2);
      const otros = toDecimal(f.otros).times(tc).toDecimalPlaces(2);
      // Sólo subtotal + otros entran al costo del inventario; IVA/IIBB
      // son créditos fiscales (Activo) — no se ratean al costo.
      zpFacturasArs = zpFacturasArs.plus(subtot).plus(otros);
    }
    const costoEnTransitoTotalArs = fobArs
      .plus(fleteOrigenArs)
      .plus(seguroOrigenArs)
      .plus(zpFacturasArs);

    // Per-ItemEmbarque costoUnit_enTransito (ARS), FOB-proporcional.
    const fobTotalUsd = toDecimal(embarque.fobTotal);
    const itemEmbCostoUnit = new Map<number, import("decimal.js").Decimal>();
    for (const ie of embarque.items) {
      if (ie.cantidad <= 0) {
        itemEmbCostoUnit.set(ie.id, toDecimal(0));
        continue;
      }
      const fobItemUsd = toDecimal(ie.precioUnitarioFob).times(ie.cantidad);
      const proporcion = fobTotalUsd.gt(0)
        ? fobItemUsd.dividedBy(fobTotalUsd)
        : toDecimal(ie.cantidad).dividedBy(
            embarque.items.reduce((s, x) => s + x.cantidad, 0) || 1,
          );
      const costoItemArs = costoEnTransitoTotalArs.times(proporcion);
      const costoUnit = costoItemArs
        .dividedBy(ie.cantidad)
        .toDecimalPlaces(2);
      itemEmbCostoUnit.set(ie.id, costoUnit);
    }

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

    // 1) Transferencia 1.1.5.02 → 1.1.5.01 por la porción del despacho.
    let transferidoArs = toDecimal(0);
    const itemDespachoCostoUnit = new Map<number, import("decimal.js").Decimal>();
    for (const id of despacho.items) {
      const costoUnit = itemEmbCostoUnit.get(id.itemEmbarqueId) ?? toDecimal(0);
      itemDespachoCostoUnit.set(id.id, costoUnit);
      const valor = costoUnit.times(id.cantidad).toDecimalPlaces(2);
      transferidoArs = transferidoArs.plus(valor);
    }
    pushDebe(
      porCodigo.get(EMBARQUE_CODIGOS.MERCADERIAS.codigo)!,
      transferidoArs,
      `Despacho ${despacho.codigo} — nacionalización (${despacho.items.length} ítem${despacho.items.length === 1 ? "" : "s"})`,
    );
    pushHaber(
      porCodigo.get(EMBARQUE_CODIGOS.MERCADERIAS_EN_TRANSITO.codigo)!,
      transferidoArs,
      `Despacho ${despacho.codigo} — sale de tránsito`,
    );

    // 2) Tributos aduaneros del despacho (mismo patrón que cierre legacy).
    const die = toDecimal(despacho.die).times(tcDsp).toDecimalPlaces(2);
    const te = toDecimal(despacho.tasaEstadistica)
      .times(tcDsp)
      .toDecimalPlaces(2);
    const arancelSim = toDecimal(despacho.arancelSim)
      .times(tcDsp)
      .toDecimalPlaces(2);
    const ivaAduana = toDecimal(despacho.iva).times(tcDsp).toDecimalPlaces(2);
    const ivaAdicional = toDecimal(despacho.ivaAdicional)
      .times(tcDsp)
      .toDecimalPlaces(2);
    const iibbAduana = toDecimal(despacho.iibb).times(tcDsp).toDecimalPlaces(2);
    const ganancias = toDecimal(despacho.ganancias)
      .times(tcDsp)
      .toDecimalPlaces(2);

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

    // 3) Facturas linkadas a este despacho (DESPACHO).
    const facturasDespacho = embarque.costos.filter(
      (f) => f.despachoId === despacho.id && f.momento !== "ZONA_PRIMARIA",
    );
    for (const factura of facturasDespacho) {
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
        `Despacho ${despacho.codigo}: no hay montos para contabilizar.`,
      );
    }

    const lineasInput: LineaInput[] = lineas.map((l) => ({
      cuentaId: l.cuentaId,
      debe: money(l.debe).toString(),
      haber: money(l.haber).toString(),
      descripcion: l.descripcion,
    }));

    const asiento = await crearAsientoEnTx(inner, {
      fecha: despacho.fecha,
      descripcion: `Despacho ${despacho.codigo} — embarque ${embarque.codigo}`,
      origen: AsientoOrigen.COMEX,
      lineas: lineasInput,
    });

    // Persist costoUnitario por ItemDespacho (referencial; el real se
    // setea en aplicarIngresoDespacho durante la action).
    for (const id of despacho.items) {
      const cu = itemDespachoCostoUnit.get(id.id);
      if (cu) {
        await inner.itemDespacho.update({
          where: { id: id.id },
          data: { costoUnitario: money(cu) },
        });
      }
    }

    await inner.despacho.update({
      where: { id: despacho.id },
      data: { asientoId: asiento.id },
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

// ============================================================
// Gasto local (factura ad-hoc con N líneas + IVA/IIBB header)
// ============================================================
//
// Asiento generado:
//
//   Por cada linea:
//     DEBE  linea.cuentaContableGastoId   subtotal × tc
//
//   DEBE  1.1.4.01 IVA Crédito Fiscal      iva × tc          (si > 0)
//   DEBE  1.1.4.03 IIBB Crédito             iibb × tc        (si > 0)
//   DEBE  primera_línea.cuenta             otros × tc        (si > 0)
//
//   HABER proveedor.cuentaContableId       total × tc
//
// Usa las mismas cuentas IVA/IIBB de COMPRA_CODIGOS (no son de
// importación). Total proveedor = subtotal + iva + iibb + otros.
export async function crearAsientoGasto(
  gastoId: string,
  tx?: TxClient,
): Promise<Asiento> {
  const run = async (inner: TxClient) => {
    const gasto = await inner.gasto.findUnique({
      where: { id: gastoId },
      include: {
        proveedor: {
          select: {
            id: true,
            nombre: true,
            cuentaContableId: true,
          },
        },
        lineas: { orderBy: { id: "asc" } },
      },
    });
    if (!gasto) {
      throw new AsientoError(
        "DOMINIO_INVALIDO",
        `Gasto ${gastoId} no existe.`,
      );
    }
    if (gasto.asientoId) {
      throw new AsientoError(
        "DOMINIO_INVALIDO",
        `Gasto ${gasto.numero} ya tiene asiento contable.`,
      );
    }
    if (gasto.lineas.length === 0) {
      throw new AsientoError(
        "DOMINIO_INVALIDO",
        `Gasto ${gasto.numero}: agregá al menos una línea con cuenta de gasto.`,
      );
    }

    const porCodigo = await ensureCuentasMap(inner, COMPRA_CODIGOS);

    let proveedorCuentaId = gasto.proveedor.cuentaContableId;
    if (!proveedorCuentaId) {
      proveedorCuentaId =
        porCodigo.get(COMPRA_CODIGOS.PROVEEDOR_FALLBACK.codigo) ?? null;
      if (!proveedorCuentaId) {
        throw new AsientoError(
          "CUENTA_INVALIDA",
          `Proveedor ${gasto.proveedor.nombre} sin cuenta contable y falta fallback ${COMPRA_CODIGOS.PROVEEDOR_FALLBACK.codigo}.`,
        );
      }
    }

    const tc = toDecimal(gasto.tipoCambio);
    const ivaArs = toDecimal(gasto.iva).times(tc).toDecimalPlaces(2);
    const iibbArs = toDecimal(gasto.iibb).times(tc).toDecimalPlaces(2);
    const otrosArs = toDecimal(gasto.otros).times(tc).toDecimalPlaces(2);

    const facturaLabel = gasto.facturaNumero
      ? `${gasto.proveedor.nombre} Fact.${gasto.facturaNumero}`
      : `${gasto.proveedor.nombre} ${gasto.numero}`;

    const lineas: LineaInput[] = [];
    let subtotalArs = toDecimal(0);
    for (const linea of gasto.lineas) {
      const lineaArs = toDecimal(linea.subtotal).times(tc).toDecimalPlaces(2);
      if (!gtZero(lineaArs)) continue;
      lineas.push({
        cuentaId: linea.cuentaContableGastoId,
        debe: money(lineaArs).toString(),
        haber: 0,
        descripcion: `${facturaLabel} — ${linea.descripcion}`,
      });
      subtotalArs = subtotalArs.plus(lineaArs);
    }
    if (lineas.length === 0) {
      throw new AsientoError(
        "DOMINIO_INVALIDO",
        `Gasto ${gasto.numero}: la suma de las líneas es cero.`,
      );
    }
    if (ivaArs.gt(0)) {
      lineas.push({
        cuentaId: porCodigo.get(COMPRA_CODIGOS.IVA_CREDITO.codigo)!,
        debe: money(ivaArs).toString(),
        haber: 0,
        descripcion: `${facturaLabel} — IVA crédito`,
      });
    }
    if (iibbArs.gt(0)) {
      lineas.push({
        cuentaId: porCodigo.get(COMPRA_CODIGOS.IIBB_CREDITO.codigo)!,
        debe: money(iibbArs).toString(),
        haber: 0,
        descripcion: `${facturaLabel} — IIBB crédito`,
      });
    }
    if (otrosArs.gt(0)) {
      lineas.push({
        cuentaId: gasto.lineas[0].cuentaContableGastoId,
        debe: money(otrosArs).toString(),
        haber: 0,
        descripcion: `${facturaLabel} — otros`,
      });
    }
    const totalArs = subtotalArs.plus(ivaArs).plus(iibbArs).plus(otrosArs);
    lineas.push({
      cuentaId: proveedorCuentaId,
      debe: 0,
      haber: money(totalArs).toString(),
      descripcion: `${facturaLabel} — total a pagar${gasto.fechaVencimiento ? ` (vence ${gasto.fechaVencimiento.toISOString().slice(0, 10)})` : ""}`,
    });

    const asiento = await crearAsientoEnTx(inner, {
      fecha: gasto.fecha,
      descripcion: `Gasto ${gasto.numero} — ${gasto.proveedor.nombre}`,
      origen: AsientoOrigen.GASTO,
      moneda: Moneda.ARS,
      tipoCambio: 1,
      lineas,
    });
    await inner.gasto.update({
      where: { id: gastoId },
      data: { asientoId: asiento.id, estado: "CONTABILIZADO" },
    });
    return asiento;
  };
  if (tx) return run(tx);
  return withNumeracionRetry(() => db.$transaction(run));
}
