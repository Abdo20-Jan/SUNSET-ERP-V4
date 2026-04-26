import "server-only";

import { z } from "zod";

import { db } from "@/lib/db";
import { eqMoney, gtZero, money, sumMoney, toDecimal } from "@/lib/decimal";
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
    data: { asientoId: null },
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

const TRANSFERENCIA_CODIGOS = {
  DIF_CAMBIO_POSITIVA: "4.3.1.01",
  DIF_CAMBIO_NEGATIVA: "5.8.2.01",
} as const;

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
      const codigo = diff.gt(0)
        ? TRANSFERENCIA_CODIGOS.DIF_CAMBIO_POSITIVA
        : TRANSFERENCIA_CODIGOS.DIF_CAMBIO_NEGATIVA;

      const cuentaDif = await inner.cuentaContable.findUnique({
        where: { codigo },
        select: { id: true, activa: true },
      });

      if (!cuentaDif) {
        throw new AsientoError(
          "CUENTA_INVALIDA",
          `Falta la cuenta contable ${codigo} (Diferencia de Cambio) en el plan de cuentas.`,
        );
      }
      if (!cuentaDif.activa) {
        throw new AsientoError(
          "CUENTA_INACTIVA",
          `La cuenta ${codigo} (Diferencia de Cambio) está inactiva.`,
        );
      }

      const absDiff = money(diff.abs()).toString();
      lineas.push({
        cuentaId: cuentaDif.id,
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

const EMBARQUE_CODIGOS = {
  // DEBE — capitalización + créditos fiscales
  MERCADERIAS_EN_TRANSITO: "1.1.5.02",
  DIE_EGRESO: "5.7.1.01",
  TASA_ESTADISTICA_EGRESO: "5.7.1.02",
  ARANCEL_SIM_EGRESO: "5.7.1.03",
  IVA_CREDITO_IMPORTACION: "1.1.4.04",
  IVA_ADICIONAL_CREDITO: "1.1.4.05",
  IIBB_CREDITO_IMPORTACION: "1.1.4.06",
  GANANCIAS_CREDITO: "1.1.4.07",
  // DEBE — créditos fiscales de costos logísticos (no importación)
  IVA_CREDITO_COMPRAS: "1.1.4.01",
  IIBB_CREDITO_COMPRAS: "1.1.4.11",
  // HABER — proveedor de la mercadería + AFIP/Aduana
  DIE_PASIVO: "2.1.5.01",
  TASA_ESTADISTICA_PASIVO: "2.1.5.02",
  ARANCEL_SIM_PASIVO: "2.1.5.03",
  IVA_POR_PAGAR: "2.1.5.04",
  IIBB_POR_PAGAR: "2.1.3.02",
  GANANCIAS_POR_PAGAR: "2.1.3.03",
  PROVEEDOR_EXTERIOR_FALLBACK: "2.1.1.02",
} as const;

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

    const codigos = Object.values(EMBARQUE_CODIGOS);
    const cuentas = await inner.cuentaContable.findMany({
      where: { codigo: { in: codigos } },
      select: { id: true, codigo: true },
    });
    const porCodigo = new Map(cuentas.map((c) => [c.codigo, c.id]));
    for (const codigo of codigos) {
      if (!porCodigo.has(codigo)) {
        throw new AsientoError(
          "CUENTA_INVALIDA",
          `Falta la cuenta contable ${codigo} en el plan de cuentas.`,
        );
      }
    }

    const tcEmb = toDecimal(embarque.tipoCambio);
    const fobArs = toDecimal(embarque.fobTotal).times(tcEmb).toDecimalPlaces(2);

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

    // 1) FOB → Mercadería en tránsito vs. proveedor del exterior
    const proveedorExteriorCuentaId =
      embarque.proveedor.cuentaContableId ??
      porCodigo.get(EMBARQUE_CODIGOS.PROVEEDOR_EXTERIOR_FALLBACK)!;
    pushDebe(
      porCodigo.get(EMBARQUE_CODIGOS.MERCADERIAS_EN_TRANSITO)!,
      fobArs,
      `FOB embarque ${embarque.codigo} (${embarque.proveedor.nombre})`,
    );
    pushHaber(
      proveedorExteriorCuentaId,
      fobArs,
      `Proveedor exterior (${embarque.proveedor.nombre}) — FOB`,
    );

    // 2) Tributos aduaneros (DEBE gasto/crédito, HABER AFIP/Aduana por pagar)
    pushDebe(porCodigo.get(EMBARQUE_CODIGOS.DIE_EGRESO)!, die, "DIE");
    pushHaber(
      porCodigo.get(EMBARQUE_CODIGOS.DIE_PASIVO)!,
      die,
      "DIE por pagar (Aduana)",
    );

    pushDebe(
      porCodigo.get(EMBARQUE_CODIGOS.TASA_ESTADISTICA_EGRESO)!,
      te,
      "Tasa estadística",
    );
    pushHaber(
      porCodigo.get(EMBARQUE_CODIGOS.TASA_ESTADISTICA_PASIVO)!,
      te,
      "Tasa estadística por pagar",
    );

    pushDebe(
      porCodigo.get(EMBARQUE_CODIGOS.ARANCEL_SIM_EGRESO)!,
      arancelSim,
      "Arancel SIM",
    );
    pushHaber(
      porCodigo.get(EMBARQUE_CODIGOS.ARANCEL_SIM_PASIVO)!,
      arancelSim,
      "Arancel SIM por pagar",
    );

    pushDebe(
      porCodigo.get(EMBARQUE_CODIGOS.IVA_CREDITO_IMPORTACION)!,
      ivaAduana,
      "IVA crédito fiscal importación",
    );
    pushDebe(
      porCodigo.get(EMBARQUE_CODIGOS.IVA_ADICIONAL_CREDITO)!,
      ivaAdicional,
      "IVA adicional importación",
    );
    pushHaber(
      porCodigo.get(EMBARQUE_CODIGOS.IVA_POR_PAGAR)!,
      ivaAduana.plus(ivaAdicional),
      "IVA importación por pagar (IVA + adicional)",
    );

    pushDebe(
      porCodigo.get(EMBARQUE_CODIGOS.IIBB_CREDITO_IMPORTACION)!,
      iibbAduana,
      "Percepción IIBB importación",
    );
    pushHaber(
      porCodigo.get(EMBARQUE_CODIGOS.IIBB_POR_PAGAR)!,
      iibbAduana,
      "IIBB importación por pagar",
    );

    pushDebe(
      porCodigo.get(EMBARQUE_CODIGOS.GANANCIAS_CREDITO)!,
      ganancias,
      "Percepción Ganancias importación",
    );
    pushHaber(
      porCodigo.get(EMBARQUE_CODIGOS.GANANCIAS_POR_PAGAR)!,
      ganancias,
      "Ganancias importación por pagar",
    );

    // 3) Costos logísticos: por cada factura (proveedor) iteramos sus
    //    líneas, generando una línea DEBE por concepto + IVA + IIBB
    //    contra la cuenta del proveedor en HABER (consolidado de la factura).
    for (const factura of embarque.costos) {
      if (factura.lineas.length === 0) continue;

      if (!factura.proveedor.cuentaContableId) {
        throw new AsientoError(
          "CUENTA_INVALIDA",
          `El proveedor ${factura.proveedor.nombre} no tiene cuenta contable asociada (revisar Maestros / Proveedores).`,
        );
      }

      const tc = toDecimal(factura.tipoCambio);
      let totalFacturaArs = toDecimal(0);

      for (const linea of factura.lineas) {
        const subtotalArs = toDecimal(linea.subtotal)
          .times(tc)
          .toDecimalPlaces(2);
        const ivaArs = toDecimal(linea.iva).times(tc).toDecimalPlaces(2);
        const iibbArs = toDecimal(linea.iibb).times(tc).toDecimalPlaces(2);
        const otrosArs = toDecimal(linea.otros).times(tc).toDecimalPlaces(2);

        const lineaTotalArs = subtotalArs
          .plus(ivaArs)
          .plus(iibbArs)
          .plus(otrosArs);
        if (!lineaTotalArs.gt(0)) continue;

        totalFacturaArs = totalFacturaArs.plus(lineaTotalArs);

        const lineaLabel =
          linea.descripcion?.trim() ||
          linea.tipo.replace(/_/g, " ").toLowerCase();
        const desc = `${factura.proveedor.nombre}${factura.facturaNumero ? ` Fact.${factura.facturaNumero}` : ""} — ${lineaLabel}`;

        pushDebe(linea.cuentaContableGastoId, subtotalArs, `${desc} — neto`);
        pushDebe(
          porCodigo.get(EMBARQUE_CODIGOS.IVA_CREDITO_COMPRAS)!,
          ivaArs,
          `${desc} — IVA`,
        );
        pushDebe(
          porCodigo.get(EMBARQUE_CODIGOS.IIBB_CREDITO_COMPRAS)!,
          iibbArs,
          `${desc} — IIBB`,
        );
        pushDebe(linea.cuentaContableGastoId, otrosArs, `${desc} — otros`);
      }

      if (totalFacturaArs.gt(0)) {
        pushHaber(
          factura.proveedor.cuentaContableId,
          totalFacturaArs,
          `${factura.proveedor.nombre}${factura.facturaNumero ? ` Fact.${factura.facturaNumero}` : ""} — total a pagar`,
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
