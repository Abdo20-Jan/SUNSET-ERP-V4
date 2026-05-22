import "server-only";

import { z } from "zod";

import { db } from "@/lib/db";
import { eqMoney, gtZero, money, type MoneyInput, sumMoney, toDecimal } from "@/lib/decimal";
import { isStockDualEnabled } from "@/lib/features";
import { secureRandomInt } from "@/lib/secure-random";
import { type CuentaDef, ensureCuentasMap, getOrCreateCuenta } from "@/lib/services/cuenta-auto";
import { revertirIngresoEmbarque } from "@/lib/services/stock";
import {
  COMEX_ZPA_CODIGOS,
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
  DivergenciaCausa,
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
  | "DOMINIO_INVALIDO"
  | "ASIENTO_ANULADO"
  | "PERIODO_ORIGEN_CERRADO"
  | "PERIODO_DESTINO_CERRADO"
  | "PERIODO_DESTINO_INEXISTENTE"
  | "MISMO_PERIODO"
  | "CONCURRENCIA";

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

export async function withNumeracionRetry<T>(run: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_NUMERACION_RETRIES; attempt++) {
    try {
      return await run();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        lastErr = err;
        await sleep(5 + secureRandomInt(20));
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

async function obtenerProximoNumero(tx: TxClient, periodoId: number): Promise<number> {
  const agg = await tx.asiento.aggregate({
    where: { periodoId },
    _max: { numero: true },
  });
  return (agg._max.numero ?? 0) + 1;
}

export async function moverAsientoDePeriodoEnTx(
  tx: TxClient,
  asientoId: string,
  periodoDestinoId: number,
): Promise<{ numeroAnterior: number; numeroNuevo: number; periodoOrigenId: number }> {
  const asiento = await tx.asiento.findUnique({
    where: { id: asientoId },
    select: {
      id: true,
      estado: true,
      numero: true,
      periodoId: true,
      periodo: { select: { estado: true } },
    },
  });
  if (!asiento) {
    throw new AsientoError("ASIENTO_INEXISTENTE", "El asiento no existe.");
  }
  if (asiento.estado === AsientoEstado.ANULADO) {
    throw new AsientoError("ASIENTO_ANULADO", "Un asiento anulado no se puede mover.");
  }
  if (asiento.periodo.estado === PeriodoEstado.CERRADO) {
    throw new AsientoError(
      "PERIODO_ORIGEN_CERRADO",
      "El período de origen está cerrado. Reabrilo antes de mover.",
    );
  }
  if (asiento.periodoId === periodoDestinoId) {
    throw new AsientoError("MISMO_PERIODO", "El asiento ya está en ese período.");
  }
  const destino = await tx.periodoContable.findUnique({
    where: { id: periodoDestinoId },
    select: { id: true, estado: true },
  });
  if (!destino) {
    throw new AsientoError("PERIODO_DESTINO_INEXISTENTE", "El período destino no existe.");
  }
  if (destino.estado === PeriodoEstado.CERRADO) {
    throw new AsientoError(
      "PERIODO_DESTINO_CERRADO",
      "El período destino está cerrado. Reabrilo antes de mover.",
    );
  }

  const numeroNuevo = await obtenerProximoNumero(tx, periodoDestinoId);
  await tx.asiento.update({
    where: { id: asientoId },
    data: { periodoId: periodoDestinoId, numero: numeroNuevo },
  });

  return {
    numeroAnterior: asiento.numero,
    numeroNuevo,
    periodoOrigenId: asiento.periodoId,
  };
}

export async function cambiarFechaAsientoEnTx(
  tx: TxClient,
  asientoId: string,
  nuevaFecha: Date,
): Promise<{
  fechaAnterior: Date;
  fechaNueva: Date;
  periodoAnteriorId: number;
  periodoNuevoId: number;
  numeroAnterior: number;
  numeroNuevo: number;
}> {
  const asiento = await tx.asiento.findUnique({
    where: { id: asientoId },
    select: {
      id: true,
      estado: true,
      numero: true,
      fecha: true,
      periodoId: true,
      periodo: { select: { estado: true } },
    },
  });
  if (!asiento) {
    throw new AsientoError("ASIENTO_INEXISTENTE", "El asiento no existe.");
  }
  if (asiento.estado === AsientoEstado.ANULADO) {
    throw new AsientoError("ASIENTO_ANULADO", "Un asiento anulado no se puede mover.");
  }
  if (asiento.periodo.estado === PeriodoEstado.CERRADO) {
    throw new AsientoError(
      "PERIODO_ORIGEN_CERRADO",
      "El período de origen está cerrado. Reabrilo antes de cambiar la fecha.",
    );
  }

  // resolverPeriodo ya valida que el período exista y esté ABIERTO.
  const destino = await resolverPeriodo(tx, nuevaFecha);

  if (destino.id === asiento.periodoId) {
    // Mismo período: solo actualizamos fecha, mantenemos numero.
    await tx.asiento.update({
      where: { id: asientoId },
      data: { fecha: nuevaFecha },
    });
    return {
      fechaAnterior: asiento.fecha,
      fechaNueva: nuevaFecha,
      periodoAnteriorId: asiento.periodoId,
      periodoNuevoId: destino.id,
      numeroAnterior: asiento.numero,
      numeroNuevo: asiento.numero,
    };
  }

  const numeroNuevo = await obtenerProximoNumero(tx, destino.id);
  await tx.asiento.update({
    where: { id: asientoId },
    data: { fecha: nuevaFecha, periodoId: destino.id, numero: numeroNuevo },
  });

  return {
    fechaAnterior: asiento.fecha,
    fechaNueva: nuevaFecha,
    periodoAnteriorId: asiento.periodoId,
    periodoNuevoId: destino.id,
    numeroAnterior: asiento.numero,
    numeroNuevo,
  };
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

async function validarCuentas(tx: TxClient, cuentaIds: number[]): Promise<void> {
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

async function crearAsientoEnTx(tx: TxClient, input: CrearAsientoInput): Promise<Asiento> {
  const parsed = crearAsientoSchema.parse(input);

  const { totalDebe, totalHaber } = validarLineasYBalance(parsed.lineas);

  const tcDec = toDecimal(parsed.tipoCambio);
  if (tcDec.lte(0)) {
    throw new AsientoError("LINEA_INVALIDA", "tipoCambio debe ser mayor a cero.");
  }
  if (parsed.moneda === Moneda.ARS && !tcDec.eq(1)) {
    throw new AsientoError("LINEA_INVALIDA", "tipoCambio debe ser 1 cuando moneda=ARS.");
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
  return withNumeracionRetry(() => db.$transaction((innerTx) => crearAsientoEnTx(innerTx, input)));
}

async function contabilizarEnTx(tx: TxClient, asientoId: string): Promise<Asiento> {
  const asiento = await tx.asiento.findUnique({
    where: { id: asientoId },
    include: { periodo: { select: { estado: true } } },
  });

  if (!asiento) {
    throw new AsientoError("ASIENTO_INEXISTENTE", `El asiento ${asientoId} no existe.`);
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

export async function contabilizarAsiento(asientoId: string, tx?: TxClient): Promise<Asiento> {
  if (tx) return contabilizarEnTx(tx, asientoId);
  return db.$transaction((innerTx) => contabilizarEnTx(innerTx, asientoId));
}

async function anularEnTx(tx: TxClient, asientoId: string): Promise<Asiento> {
  const asiento = await tx.asiento.findUnique({
    where: { id: asientoId },
    include: { periodo: { select: { estado: true } } },
  });

  if (!asiento) {
    throw new AsientoError("ASIENTO_INEXISTENTE", `El asiento ${asientoId} no existe.`);
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
  // EmbarqueCosto factura standalone: si su asiento es anulado directamente
  // (no via anularAsientoEmbarqueCosto), también marcar el costo como ANULADA.
  await tx.embarqueCosto.updateMany({
    where: { asientoId },
    data: { asientoId: null, estado: "ANULADA" },
  });

  return tx.asiento.update({
    where: { id: asientoId },
    data: { estado: AsientoEstado.ANULADO },
  });
}

export async function anularAsiento(asientoId: string, tx?: TxClient): Promise<Asiento> {
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
      throw new AsientoError("DOMINIO_INVALIDO", `PrestamoExterno ${prestamoId} no existe.`);
    }

    if (prestamo.asientoId) {
      throw new AsientoError(
        "ESTADO_INVALIDO",
        `El préstamo ${prestamoId} ya tiene un asiento asociado (${prestamo.asientoId}).`,
      );
    }

    const valor = money(toDecimal(prestamo.principal).mul(toDecimal(prestamo.tipoCambio)));

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

    const updPrestamo = await inner.prestamoExterno.updateMany({
      where: { id: prestamoId, asientoId: null },
      data: { asientoId: asiento.id },
    });
    if (updPrestamo.count !== 1) {
      throw new AsientoError(
        "CONCURRENCIA",
        `Préstamo ${prestamoId} fue contabilizado simultáneamente por otro proceso (race detectado).`,
      );
    }

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
      throw new AsientoError("DOMINIO_INVALIDO", `MovimientoTesoreria ${movimientoId} no existe.`);
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
      mov.tipo === MovimientoTesoreriaTipo.PAGO && mov.cuentaContable?.codigo === "5.8.1.06";

    let lineas: LineaInput[];

    if (esImpuestoLey25413) {
      const creditoCuentaId = await getOrCreateCuenta(
        inner,
        EXTRACTO_BANCARIO_CODIGOS.CREDITO_LEY_25413_GANANCIAS,
      );
      const montoAbs = toDecimal(mov.monto).toNumber();
      const creditoMonto = Math.round(montoAbs * PORCENTAJE_LEY_25413_COMPUTABLE * 100) / 100;
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

    const updMov = await inner.movimientoTesoreria.updateMany({
      where: { id: movimientoId, asientoId: null },
      data: { asientoId: asiento.id },
    });
    if (updMov.count !== 1) {
      throw new AsientoError(
        "CONCURRENCIA",
        `MovimientoTesoreria ${movimientoId} fue contabilizado simultáneamente por otro proceso (race detectado).`,
      );
    }

    return asiento;
  };

  if (tx) return run(tx);
  return withNumeracionRetry(() => db.$transaction(run));
}

export type CrearTransferenciaInput = {
  fecha: Date;
  fechaDestino?: Date | null;
  cuentaBancariaOrigenId: string;
  cuentaBancariaDestinoId: string;
  montoOrigen: string;
  montoDestino: string;
  tipoCambioOrigen: string;
  tipoCambioDestino: string;
  referenciaBancoOrigen?: string | null;
  referenciaBancoDestino?: string | null;
  descripcion?: string | null;
};

export async function crearAsientoTransferencia(
  input: CrearTransferenciaInput,
  tx?: TxClient,
): Promise<{ asiento: Asiento; movimientoId: string }> {
  const run = async (inner: TxClient): Promise<{ asiento: Asiento; movimientoId: string }> => {
    if (input.cuentaBancariaOrigenId === input.cuentaBancariaDestinoId) {
      throw new AsientoError("DOMINIO_INVALIDO", "La cuenta origen y destino deben ser distintas.");
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
      throw new AsientoError("LINEA_INVALIDA", "El monto origen debe ser mayor a cero.");
    }
    if (montoDestinoDec.lte(0)) {
      throw new AsientoError("LINEA_INVALIDA", "El monto destino debe ser mayor a cero.");
    }
    if (tcOrigenDec.lte(0) || tcDestinoDec.lte(0)) {
      throw new AsientoError("LINEA_INVALIDA", "Los tipos de cambio deben ser mayores a cero.");
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

    const refOrigenSuffix = input.referenciaBancoOrigen?.trim()
      ? ` — Ref ${input.referenciaBancoOrigen.trim()}`
      : "";
    const refDestinoSuffix = input.referenciaBancoDestino?.trim()
      ? ` — Ref ${input.referenciaBancoDestino.trim()}`
      : "";

    const lineas: LineaInput[] = [
      {
        cuentaId: destino.cuentaContableId,
        debe: destinoArs.toString(),
        haber: 0,
        descripcion: `Transferencia recibida desde ${origen.banco}${refDestinoSuffix}`,
      },
      {
        cuentaId: origen.cuentaContableId,
        debe: 0,
        haber: origenArs.toString(),
        descripcion: `Transferencia enviada a ${destino.banco}${refOrigenSuffix}`,
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
        descripcion: diff.gt(0) ? "Diferencia de cambio positiva" : "Diferencia de cambio negativa",
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
        fechaDestino: input.fechaDestino ?? null,
        monto: money(montoOrigenDec),
        moneda: origen.moneda,
        tipoCambio: new Prisma.Decimal(tcOrigenDec.toFixed(6)),
        descripcion: input.descripcion ?? null,
        referenciaBanco: input.referenciaBancoOrigen ?? null,
        referenciaBancoDestino: input.referenciaBancoDestino ?? null,
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
  fecha?: Date,
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
      throw new AsientoError("DOMINIO_INVALIDO", `Embarque ${embarqueId} no existe.`);
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
    const totalProveedorExteriorArs = fobArs.plus(fleteOrigenArs).plus(seguroOrigenArs);

    // Tributos vienen en moneda del embarque (despacho en USD); se convierten
    // a ARS aplicando el TC del embarque. Cada uno se redondea a 2dp ANTES
    // de sumarlos para el HABER consolidado, garantizando DEBE = HABER.
    const die = toDecimal(embarque.die).times(tcEmb).toDecimalPlaces(2);
    const te = toDecimal(embarque.tasaEstadistica).times(tcEmb).toDecimalPlaces(2);
    const arancelSim = toDecimal(embarque.arancelSim).times(tcEmb).toDecimalPlaces(2);
    const ivaAduana = toDecimal(embarque.iva).times(tcEmb).toDecimalPlaces(2);
    const ivaAdicional = toDecimal(embarque.ivaAdicional).times(tcEmb).toDecimalPlaces(2);
    const iibbAduana = toDecimal(embarque.iibb).times(tcEmb).toDecimalPlaces(2);
    const ganancias = toDecimal(embarque.ganancias).times(tcEmb).toDecimalPlaces(2);

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
    pushHaber(porCodigo.get(EMBARQUE_CODIGOS.DIE_PASIVO.codigo)!, die, "DIE por pagar (Aduana)");

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

    pushDebe(porCodigo.get(EMBARQUE_CODIGOS.ARANCEL_SIM_EGRESO.codigo)!, arancelSim, "Arancel SIM");
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
    //
    //    Estado de la factura: sólo se incluyen BORRADOR y LEGACY_BUNDLED.
    //    Las EMITIDA tienen su asiento standalone propio en fechaFactura
    //    (PR #2 de "Fato gerador para livro razão"); las ANULADA fueron
    //    canceladas explícitamente. LEGACY_BUNDLED preserva el flujo previo
    //    para registros creados antes del cambio.
    const facturasParaCierre = (
      tieneZonaPrimaria
        ? embarque.costos.filter((f) => f.momento !== "ZONA_PRIMARIA")
        : embarque.costos
    ).filter((f) => f.estado === "BORRADOR" || f.estado === "LEGACY_BUNDLED");
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
        const subtotalArs = toDecimal(linea.subtotal).times(tc).toDecimalPlaces(2);
        if (!subtotalArs.gt(0)) continue;

        const lineaLabel = linea.descripcion?.trim() || linea.tipo.replace(/_/g, " ").toLowerCase();
        pushDebe(linea.cuentaContableGastoId, subtotalArs, `${facturaLabel} — ${lineaLabel}`);
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
        pushDebe(factura.lineas[0].cuentaContableGastoId, otrosArs, `${facturaLabel} — otros`);
      }

      const totalFacturaArs = subtotalFacturaArs.plus(ivaArs).plus(iibbArs).plus(otrosArs);

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
      fecha: fecha ?? new Date(),
      descripcion: `Nacionalización embarque ${embarque.codigo}`,
      origen: AsientoOrigen.COMEX,
      lineas: lineasInput,
    });

    const updEmbCierre = await inner.embarque.updateMany({
      where: { id: embarqueId, asientoId: null },
      data: { asientoId: asiento.id },
    });
    if (updEmbCierre.count !== 1) {
      throw new AsientoError(
        "CONCURRENCIA",
        `Embarque ${embarqueId} fue cerrado simultáneamente por otro proceso (race detectado).`,
      );
    }

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
  fecha?: Date,
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
      throw new AsientoError("DOMINIO_INVALIDO", `Embarque ${embarqueId} no existe.`);
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
    const totalProveedorExteriorArs = fobArs.plus(fleteOrigenArs).plus(seguroOrigenArs);

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
    //    op. logístico, gastos línea marítima local). Filtra estado:
    //    sólo BORRADOR y LEGACY_BUNDLED. EMITIDA tienen asiento standalone
    //    propio (ADR fato gerador), ANULADA fueron canceladas.
    const facturasZP = embarque.costos.filter(
      (f) =>
        f.momento === "ZONA_PRIMARIA" && (f.estado === "BORRADOR" || f.estado === "LEGACY_BUNDLED"),
    );
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
        const lineaLabel = linea.descripcion?.trim() || linea.tipo.replace(/_/g, " ").toLowerCase();
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
        pushDebe(factura.lineas[0].cuentaContableGastoId, otrosArs, `${facturaLabel} — otros (ZP)`);
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
      fecha: fecha ?? new Date(),
      descripcion: `Zona primaria embarque ${embarque.codigo}`,
      origen: AsientoOrigen.COMEX,
      lineas: lineasInput,
    });

    const updEmbZP = await inner.embarque.updateMany({
      where: { id: embarqueId, asientoZonaPrimariaId: null },
      data: {
        asientoZonaPrimariaId: asiento.id,
        estado: "EN_ZONA_PRIMARIA",
      },
    });
    if (updEmbZP.count !== 1) {
      throw new AsientoError(
        "CONCURRENCIA",
        `Embarque ${embarqueId}: zona primaria fue confirmada simultáneamente por otro proceso (race detectado).`,
      );
    }

    return asiento;
  };

  if (tx) return run(tx);
  return withNumeracionRetry(() => db.$transaction(run));
}

// ============================================================
// Embarque — Arribo a Zona Primaria (Modelo Y, Ponte PR C)
// ============================================================
//
// Variante de `crearAsientoZonaPrimaria` para embarques CON contenedores
// (flag CONTENEDOR_DESCONSOLIDACION_ENABLED). A diferencia del flujo legacy
// (que DEBE 1.1.5.02 EN TRÁNSITO + ingresa stock al depósito ZPA), acá el
// costo total rateable se capitaliza directamente en **1.1.5.04 MERCADERÍAS
// EN ZONA PRIMARIA** y NO se mueve stock. El primer ingreso de stock recién
// ocurre en la desconsolidación (depósito fiscal), evitando la doble
// contabilización de inventario (ZPA + DF) — ver runbook comex-ativacao.md.
//
// La base capitalizada = la misma que `calcularRateioZonaPrimaria`: FOB +
// flete/seguro origen + Σ subtotales de facturas momento=ZONA_PRIMARIA (todo
// en ARS). Esto garantiza la reconciliación Σ costoFCUnitario×cant×TC ==
// débito 1.1.5.04. IVA/IIBB son créditos fiscales (no se capitalizan).
//
// Las facturas ZP pueden llegar ya EMITIDAS (la edición del embarque las
// auto-emite a gasto 5.x en su fecha). Para no perder ni duplicar el costo,
// este asiento RECLASIFICA las EMITIDA (DEBE 1.1.5.04 / HABER su cuenta 5.x,
// neteándola) y hace el booking completo de las BORRADOR. Así el costo de ZP
// siempre termina capitalizado, sea cual sea el estado de la factura.

export async function crearAsientoArriboComex(
  embarqueId: string,
  tx?: TxClient,
  fecha?: Date,
): Promise<Asiento> {
  const run = async (inner: TxClient) => {
    const embarque = await inner.embarque.findUnique({
      where: { id: embarqueId },
      include: {
        proveedor: { select: { id: true, nombre: true, cuentaContableId: true } },
        costos: {
          include: {
            proveedor: { select: { id: true, nombre: true, cuentaContableId: true } },
            lineas: { orderBy: { id: "asc" } },
          },
          orderBy: { id: "asc" },
        },
      },
    });

    if (!embarque) {
      throw new AsientoError("DOMINIO_INVALIDO", `Embarque ${embarqueId} no existe.`);
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
        `Embarque ${embarque.codigo} ya está cerrado/despachado — no se puede registrar arribo después.`,
      );
    }
    // Gap #7: defensa en profundidad. Un embarque USD con TC <= 1 corrompe la
    // base capitalizada (FOB×TC) y el costeo unitario. El zod del form lo
    // bloquea, pero acá lo cortamos antes de calcular por si llega por otra vía.
    if (embarque.moneda === "USD" && Number(embarque.tipoCambio) <= 1) {
      throw new AsientoError(
        "DOMINIO_INVALIDO",
        `Embarque ${embarque.codigo}: tipo de cambio USD inválido (<= 1) — corrija el TC antes de confirmar arribo.`,
      );
    }

    const porCodigo = await ensureCuentasMap(inner, EMBARQUE_CODIGOS);
    const cuentaZpaId = await getOrCreateCuenta(
      inner,
      COMEX_ZPA_CODIGOS.MERCADERIAS_EN_ZONA_PRIMARIA,
    );

    const tcEmb = toDecimal(embarque.tipoCambio);
    const fobArs = toDecimal(embarque.fobTotal).times(tcEmb).toDecimalPlaces(2);
    const fleteOrigenArs = embarque.valorFleteOrigen
      ? toDecimal(embarque.valorFleteOrigen).times(tcEmb).toDecimalPlaces(2)
      : toDecimal(0);
    const seguroOrigenArs = embarque.valorSeguroOrigen
      ? toDecimal(embarque.valorSeguroOrigen).times(tcEmb).toDecimalPlaces(2)
      : toDecimal(0);
    const totalProveedorExteriorArs = fobArs.plus(fleteOrigenArs).plus(seguroOrigenArs);

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

    // Costo rateable capitalizado en 1.1.5.04. Arranca con FOB+flete+seguro;
    // los subtotales de facturas ZP se suman abajo.
    let costoRateableArs = totalProveedorExteriorArs;
    const detalleOrigen =
      fleteOrigenArs.gt(0) || seguroOrigenArs.gt(0)
        ? ` (FOB + flete${seguroOrigenArs.gt(0) ? " + seguro" : ""} origen)`
        : "";

    // HABER: proveedor exterior por FOB + flete/seguro origen.
    const proveedorExteriorCuentaId =
      embarque.proveedor.cuentaContableId ??
      porCodigo.get(EMBARQUE_CODIGOS.PROVEEDOR_EXTERIOR_FALLBACK.codigo)!;
    pushHaber(
      proveedorExteriorCuentaId,
      totalProveedorExteriorArs,
      `Proveedor exterior (${embarque.proveedor.nombre})${detalleOrigen}`,
    );

    // Facturas momento=ZONA_PRIMARIA (treatment A: el subtotal capitaliza en
    // 1.1.5.04). Dos caminos según el estado, para que el costo SIEMPRE termine
    // en inventario sin doble contabilizar:
    //   - BORRADOR/LEGACY_BUNDLED: no tienen asiento propio → booking completo
    //     acá (subtotal vía 1.1.5.04 + IVA/IIBB crédito / HABER proveedor).
    //   - EMITIDA: ya tienen asiento standalone (DEBE gasto 5.x + IVA/IIBB /
    //     HABER proveedor) en la fecha de la factura. Acá sólo RECLASIFICAMOS
    //     el costo de gasto → inventario: DEBE 1.1.5.04 / HABER la cuenta 5.x
    //     que debitó la emisión (neteándola a cero). El IVA crédito y el CxP del
    //     proveedor quedan como los dejó la emisión (timing fiscal correcto).
    // Las ANULADA se ignoran (no aportan costo).
    const facturasZP = embarque.costos.filter(
      (f) => f.momento === "ZONA_PRIMARIA" && f.estado !== "ANULADA",
    );
    for (const factura of facturasZP) {
      if (factura.lineas.length === 0) continue;
      const tc = toDecimal(factura.tipoCambio);
      const facturaLabel = `${factura.proveedor.nombre}${factura.facturaNumero ? ` Fact.${factura.facturaNumero}` : ""}`;
      const yaEmitida = factura.estado === "EMITIDA";

      let subtotalFacturaArs = toDecimal(0);
      for (const linea of factura.lineas) {
        const subtotalArs = toDecimal(linea.subtotal).times(tc).toDecimalPlaces(2);
        if (!subtotalArs.gt(0)) continue;
        costoRateableArs = costoRateableArs.plus(subtotalArs);
        subtotalFacturaArs = subtotalFacturaArs.plus(subtotalArs);
        if (yaEmitida) {
          // Reclasificación: revierte el gasto que la emisión debitó en 5.x.
          pushHaber(
            linea.cuentaContableGastoId,
            subtotalArs,
            `${facturaLabel} — reclasificación gasto → 1.1.5.04 (arribo ZP)`,
          );
        }
      }

      // Las EMITIDA ya asentaron IVA/IIBB crédito y CxP: nada más que reclasificar.
      if (yaEmitida) continue;

      // BORRADOR/LEGACY: booking completo (proveedor + créditos fiscales).
      if (!factura.proveedor.cuentaContableId) {
        throw new AsientoError(
          "CUENTA_INVALIDA",
          `El proveedor ${factura.proveedor.nombre} no tiene cuenta contable asociada.`,
        );
      }
      const ivaArs = toDecimal(factura.iva).times(tc).toDecimalPlaces(2);
      const iibbArs = toDecimal(factura.iibb).times(tc).toDecimalPlaces(2);
      const otrosArs = toDecimal(factura.otros).times(tc).toDecimalPlaces(2);

      pushDebe(
        porCodigo.get(EMBARQUE_CODIGOS.IVA_CREDITO_COMPRAS.codigo)!,
        ivaArs,
        `${facturaLabel} — IVA crédito (arribo ZP)`,
      );
      pushDebe(
        porCodigo.get(EMBARQUE_CODIGOS.IIBB_CREDITO_COMPRAS.codigo)!,
        iibbArs,
        `${facturaLabel} — IIBB crédito (arribo ZP)`,
      );
      // `otros` se mantiene como gasto (no capitalizable) para balancear.
      if (otrosArs.gt(0)) {
        pushDebe(factura.lineas[0].cuentaContableGastoId, otrosArs, `${facturaLabel} — otros (ZP)`);
      }

      const totalFacturaArs = subtotalFacturaArs.plus(ivaArs).plus(iibbArs).plus(otrosArs);
      pushHaber(
        factura.proveedor.cuentaContableId,
        totalFacturaArs,
        `${facturaLabel} — total a pagar (arribo ZP)`,
      );
    }

    // DEBE 1.1.5.04 con el costo total rateable capitalizado.
    pushDebe(
      cuentaZpaId,
      costoRateableArs,
      `Arribo a zona primaria — embarque ${embarque.codigo} (${embarque.proveedor.nombre})${detalleOrigen}`,
    );

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
      fecha: fecha ?? new Date(),
      descripcion: `Arribo zona primaria embarque ${embarque.codigo}`,
      origen: AsientoOrigen.COMEX,
      lineas: lineasInput,
    });

    const updEmbZP = await inner.embarque.updateMany({
      where: { id: embarqueId, asientoZonaPrimariaId: null },
      data: { asientoZonaPrimariaId: asiento.id, estado: "EN_ZONA_PRIMARIA" },
    });
    if (updEmbZP.count !== 1) {
      throw new AsientoError(
        "CONCURRENCIA",
        `Embarque ${embarqueId}: arribo fue confirmado simultáneamente por otro proceso (race detectado).`,
      );
    }

    return asiento;
  };

  if (tx) return run(tx);
  return withNumeracionRetry(() => db.$transaction(run));
}

// ============================================================
// Comex ZPA — transferencias entre subcuentas de bienes de cambio (PR 3.1)
// ============================================================
//
// Helpers de bajo nivel que mueven el costo de la mercadería entre las
// subcuentas según su estado físico/aduanero. Los consumen los servicios
// de desconsolidación (Fase 3) y nacionalización; acá NO hay callers aún
// (flag CONTENEDOR_DESCONSOLIDACION_ENABLED apagada). El asiento de
// Responsabilidad Sustituta (cuentas de orden 9.x) se difiere a un PR
// dedicado de Fase 3 — requiere la categoría ORDEN en CuentaCategoria.

/** Flujo de mercadería entre subcuentas de bienes de cambio (1.1.5.x). */
export type FlujoSubcuentaComex =
  | "ARRIBO_ZONA_PRIMARIA" // DEBE 1.1.5.04 / HABER 1.1.5.02 (tránsito → ZPA)
  | "TRASLADO_DEPOSITO_FISCAL" // DEBE 1.1.5.05 / HABER 1.1.5.04 (ZPA → DF)
  | "NACIONALIZACION_VIA_DF" // DEBE 1.1.5.01 / HABER 1.1.5.05 (DF → nacional)
  | "NACIONALIZACION_DIRECTA"; // DEBE 1.1.5.01 / HABER 1.1.5.04 (ZPA → nacional)

const FLUJO_SUBCUENTA: Record<
  FlujoSubcuentaComex,
  { debe: CuentaDef; haber: CuentaDef; label: string }
> = {
  ARRIBO_ZONA_PRIMARIA: {
    debe: COMEX_ZPA_CODIGOS.MERCADERIAS_EN_ZONA_PRIMARIA,
    haber: EMBARQUE_CODIGOS.MERCADERIAS_EN_TRANSITO,
    label: "Arribo a zona primaria aduanera",
  },
  TRASLADO_DEPOSITO_FISCAL: {
    debe: COMEX_ZPA_CODIGOS.MERCADERIAS_EN_DEPOSITO_FISCAL,
    haber: COMEX_ZPA_CODIGOS.MERCADERIAS_EN_ZONA_PRIMARIA,
    label: "Traslado a depósito fiscal",
  },
  NACIONALIZACION_VIA_DF: {
    debe: EMBARQUE_CODIGOS.MERCADERIAS,
    haber: COMEX_ZPA_CODIGOS.MERCADERIAS_EN_DEPOSITO_FISCAL,
    label: "Nacionalización vía depósito fiscal",
  },
  NACIONALIZACION_DIRECTA: {
    debe: EMBARQUE_CODIGOS.MERCADERIAS,
    haber: COMEX_ZPA_CODIGOS.MERCADERIAS_EN_ZONA_PRIMARIA,
    label: "Nacionalización directa en puerto",
  },
};

export interface AsientoTransferenciaSubcuentaInput {
  flujo: FlujoSubcuentaComex;
  /** Monto en ARS (costo de la mercadería transferida). Debe ser > 0. */
  monto: MoneyInput;
  fecha: Date;
  /** Si no se pasa, se usa el label del flujo. */
  descripcion?: string;
}

/**
 * Asiento de transferencia de costo entre dos subcuentas de bienes de
 * cambio, según el `flujo` aduanero. Dos líneas balanceadas (DEBE/HABER).
 * Crea las cuentas lazy vía `getOrCreateCuenta` si aún no existen.
 */
export async function crearAsientoTransferenciaSubcuenta(
  input: AsientoTransferenciaSubcuentaInput,
  tx?: TxClient,
): Promise<Asiento> {
  const run = async (inner: TxClient) => {
    if (!gtZero(input.monto)) {
      throw new AsientoError(
        "LINEA_INVALIDA",
        "El monto de la transferencia entre subcuentas debe ser mayor a cero.",
      );
    }
    const mapping = FLUJO_SUBCUENTA[input.flujo];
    const debeId = await getOrCreateCuenta(inner, mapping.debe);
    const haberId = await getOrCreateCuenta(inner, mapping.haber);
    const valor = money(input.monto).toString();

    return crearAsientoEnTx(inner, {
      fecha: input.fecha,
      descripcion: input.descripcion?.trim() || mapping.label,
      origen: AsientoOrigen.COMEX,
      lineas: [
        {
          cuentaId: debeId,
          debe: valor,
          haber: 0,
          descripcion: `${mapping.label} (${mapping.debe.codigo})`,
        },
        {
          cuentaId: haberId,
          debe: 0,
          haber: valor,
          descripcion: `${mapping.label} (${mapping.haber.codigo})`,
        },
      ],
    });
  };

  if (tx) return run(tx);
  return withNumeracionRetry(() => db.$transaction(run));
}

// ============================================================
// Comex ZPA — divergencia formal D9 (físico ≠ declarado) (PR 3.1)
// ============================================================

/** Sentido de la divergencia detectada en la conferencia física. */
export type TipoDivergencia = "FALTA" | "SOBRA";
/** Subcuenta donde está contabilizada la mercadería al detectar la divergencia. */
export type UbicacionMercaderia = "ZONA_PRIMARIA" | "DEPOSITO_FISCAL";

export interface AsientoDivergenciaInput {
  tipo: TipoDivergencia;
  causa: DivergenciaCausa;
  /** Monto en ARS del costo de la diferencia. Debe ser > 0. */
  monto: MoneyInput;
  ubicacion: UbicacionMercaderia;
  /**
   * Cuenta a cobrar al responsable. Obligatoria en FALTA con causa
   * distinta de NAO_IDENTIFICADA (proveedor/transportista/depositario/
   * aseguradora). Ignorada en SOBRA o falta sin responsable.
   */
  cuentaPorCobrarId?: number;
  fecha: Date;
  descripcion?: string;
}

/**
 * Asiento de regularización de una divergencia formal (D9).
 *
 *  - SOBRA: DEBE subcuenta stock / HABER 4.9.1.01 (ingreso por diferencia).
 *  - FALTA sin responsable (NAO_IDENTIFICADA): DEBE 5.9.2.01 (pérdida) /
 *    HABER subcuenta stock.
 *  - FALTA con responsable: DEBE `cuentaPorCobrarId` / HABER subcuenta stock.
 *
 * `ubicacion` decide la subcuenta de stock (1.1.5.04 ZPA o 1.1.5.05 DF).
 */
export async function crearAsientoDivergencia(
  input: AsientoDivergenciaInput,
  tx?: TxClient,
): Promise<Asiento> {
  const run = async (inner: TxClient) => {
    if (!gtZero(input.monto)) {
      throw new AsientoError("LINEA_INVALIDA", "El monto de la divergencia debe ser mayor a cero.");
    }

    const subcuentaDef =
      input.ubicacion === "DEPOSITO_FISCAL"
        ? COMEX_ZPA_CODIGOS.MERCADERIAS_EN_DEPOSITO_FISCAL
        : COMEX_ZPA_CODIGOS.MERCADERIAS_EN_ZONA_PRIMARIA;
    const subcuentaId = await getOrCreateCuenta(inner, subcuentaDef);
    const valor = money(input.monto).toString();
    const ubicacionLabel = `${subcuentaDef.codigo}`;

    let lineas: LineaInput[];
    let descripcion: string;

    if (input.tipo === "SOBRA") {
      const ingresoId = await getOrCreateCuenta(
        inner,
        COMEX_ZPA_CODIGOS.INGRESO_POR_DIFERENCIA_INVENTARIO,
      );
      descripcion = input.descripcion?.trim() || `Divergencia D9 — sobra (${ubicacionLabel})`;
      lineas = [
        {
          cuentaId: subcuentaId,
          debe: valor,
          haber: 0,
          descripcion: `Sobra de inventario (${ubicacionLabel})`,
        },
        {
          cuentaId: ingresoId,
          debe: 0,
          haber: valor,
          descripcion: `Ingreso por diferencia de inventario (${COMEX_ZPA_CODIGOS.INGRESO_POR_DIFERENCIA_INVENTARIO.codigo})`,
        },
      ];
    } else if (input.causa === DivergenciaCausa.NAO_IDENTIFICADA) {
      const perdidaId = await getOrCreateCuenta(inner, COMEX_ZPA_CODIGOS.PERDIDAS_LOGISTICAS);
      descripcion =
        input.descripcion?.trim() || `Divergencia D9 — falta sin responsable (${ubicacionLabel})`;
      lineas = [
        {
          cuentaId: perdidaId,
          debe: valor,
          haber: 0,
          descripcion: `Pérdida logística (${COMEX_ZPA_CODIGOS.PERDIDAS_LOGISTICAS.codigo})`,
        },
        {
          cuentaId: subcuentaId,
          debe: 0,
          haber: valor,
          descripcion: `Faltante de inventario (${ubicacionLabel})`,
        },
      ];
    } else {
      if (input.cuentaPorCobrarId == null) {
        throw new AsientoError(
          "CUENTA_INVALIDA",
          `Divergencia D9 con responsable (${input.causa}) requiere cuentaPorCobrarId.`,
        );
      }
      descripcion =
        input.descripcion?.trim() ||
        `Divergencia D9 — falta a cobrar a ${input.causa} (${ubicacionLabel})`;
      lineas = [
        {
          cuentaId: input.cuentaPorCobrarId,
          debe: valor,
          haber: 0,
          descripcion: `A cobrar al responsable (${input.causa})`,
        },
        {
          cuentaId: subcuentaId,
          debe: 0,
          haber: valor,
          descripcion: `Faltante de inventario (${ubicacionLabel})`,
        },
      ];
    }

    return crearAsientoEnTx(inner, {
      fecha: input.fecha,
      descripcion,
      origen: AsientoOrigen.COMEX,
      lineas,
    });
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

export async function crearAsientoDespacho(despachoId: string, tx?: TxClient): Promise<Asiento> {
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
      throw new AsientoError("DOMINIO_INVALIDO", `Despacho ${despachoId} no existe.`);
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
      (f) => f.momento === "ZONA_PRIMARIA" && f.estado !== "ANULADA",
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
        : toDecimal(ie.cantidad).dividedBy(embarque.items.reduce((s, x) => s + x.cantidad, 0) || 1);
      const costoItemArs = costoEnTransitoTotalArs.times(proporcion);
      const costoUnit = costoItemArs.dividedBy(ie.cantidad).toDecimalPlaces(2);
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
    const te = toDecimal(despacho.tasaEstadistica).times(tcDsp).toDecimalPlaces(2);
    const arancelSim = toDecimal(despacho.arancelSim).times(tcDsp).toDecimalPlaces(2);
    const ivaAduana = toDecimal(despacho.iva).times(tcDsp).toDecimalPlaces(2);
    const ivaAdicional = toDecimal(despacho.ivaAdicional).times(tcDsp).toDecimalPlaces(2);
    const iibbAduana = toDecimal(despacho.iibb).times(tcDsp).toDecimalPlaces(2);
    const ganancias = toDecimal(despacho.ganancias).times(tcDsp).toDecimalPlaces(2);

    pushDebe(porCodigo.get(EMBARQUE_CODIGOS.DIE_EGRESO.codigo)!, die, "DIE");
    pushHaber(porCodigo.get(EMBARQUE_CODIGOS.DIE_PASIVO.codigo)!, die, "DIE por pagar (Aduana)");
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
    pushDebe(porCodigo.get(EMBARQUE_CODIGOS.ARANCEL_SIM_EGRESO.codigo)!, arancelSim, "Arancel SIM");
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

    // 3) Facturas linkadas a este despacho (DESPACHO). Filtra estado:
    //    sólo BORRADOR y LEGACY_BUNDLED. EMITIDA tienen asiento standalone
    //    propio (ADR fato gerador); ANULADA fueron canceladas.
    const facturasDespacho = embarque.costos.filter(
      (f) =>
        f.despachoId === despacho.id &&
        f.momento !== "ZONA_PRIMARIA" &&
        (f.estado === "BORRADOR" || f.estado === "LEGACY_BUNDLED"),
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
        const subtotalArs = toDecimal(linea.subtotal).times(tc).toDecimalPlaces(2);
        if (!subtotalArs.gt(0)) continue;
        const lineaLabel = linea.descripcion?.trim() || linea.tipo.replace(/_/g, " ").toLowerCase();
        pushDebe(linea.cuentaContableGastoId, subtotalArs, `${facturaLabel} — ${lineaLabel}`);
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
        pushDebe(factura.lineas[0].cuentaContableGastoId, otrosArs, `${facturaLabel} — otros`);
      }
      const totalFacturaArs = subtotalFacturaArs.plus(ivaArs).plus(iibbArs).plus(otrosArs);
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

    const updDesp = await inner.despacho.updateMany({
      where: { id: despacho.id, asientoId: null },
      data: { asientoId: asiento.id },
    });
    if (updDesp.count !== 1) {
      throw new AsientoError(
        "CONCURRENCIA",
        `Despacho ${despacho.id} fue contabilizado simultáneamente por otro proceso (race detectado).`,
      );
    }

    return asiento;
  };

  if (tx) return run(tx);
  return withNumeracionRetry(() => db.$transaction(run));
}

/**
 * Asiento del despacho parcial CRUZADO (Fase 4, flag CONTENEDOR_DESCONSOLIDACION
 * _ENABLED). Espeja `crearAsientoDespacho` pero:
 *  - La transferencia de subcuenta es 1.1.5.05 (DF) → 1.1.5.01 (mercaderías
 *    nacionalizadas) — flujo NACIONALIZACION_VIA_DF — en vez de 1.1.5.02→01.
 *  - El costo landed por línea sale del `ItemContenedor.costoFCUnitario`
 *    (snapshot FC en USD, ya rateado en ZP) × cantidad × TC del embarque, no
 *    del rateo FOB del ItemEmbarque.
 *  - Los tributos aduaneros y las facturas DESPACHO son idénticos al legacy
 *    (duplicados acá a propósito: el legacy NO tiene tests y está activo en
 *    prod — no se toca. Unificar DRY = follow-up cuando el legacy tenga red).
 *  - RespSustituta (DF de terceros, cuentas de orden 9.x) se difiere (igual
 *    que las cuentas de orden de Onda 1).
 */
export async function crearAsientoDespachoCruzado(
  despachoId: string,
  tx?: TxClient,
): Promise<Asiento> {
  const run = async (inner: TxClient) => {
    const despacho = await inner.despacho.findUnique({
      where: { id: despachoId },
      include: {
        embarque: {
          include: {
            costos: {
              include: {
                proveedor: { select: { id: true, nombre: true, cuentaContableId: true } },
                lineas: { orderBy: { id: "asc" } },
              },
              orderBy: { id: "asc" },
            },
          },
        },
        items: {
          include: {
            itemContenedor: {
              select: {
                id: true,
                productoId: true,
                costoFCUnitario: true,
                contenedor: { select: { depositoFiscalId: true } },
              },
            },
          },
          orderBy: { id: "asc" },
        },
      },
    });

    if (!despacho) {
      throw new AsientoError("DOMINIO_INVALIDO", `Despacho ${despachoId} no existe.`);
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
      throw new AsientoError("DOMINIO_INVALIDO", `Despacho ${despacho.codigo}: no tiene ítems.`);
    }
    const embarque = despacho.embarque;
    if (embarque.asientoId) {
      throw new AsientoError(
        "ESTADO_INVALIDO",
        `Embarque ${embarque.codigo}: ya tiene cierre monolítico — no admite despachos parciales.`,
      );
    }

    const porCodigo = await ensureCuentasMap(inner, EMBARQUE_CODIGOS);
    const cuentaDFId = await getOrCreateCuenta(
      inner,
      COMEX_ZPA_CODIGOS.MERCADERIAS_EN_DEPOSITO_FISCAL,
    );
    const tcEmb = toDecimal(embarque.tipoCambio);
    const tcDsp = toDecimal(despacho.tipoCambio);

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

    // 1) Transferencia 1.1.5.05 (DF) → 1.1.5.01 (mercaderías) por el costo
    //    landed de las líneas cruzadas (costoFCUnitario × cantidad × TC).
    let nacionalizadoArs = toDecimal(0);
    const itemDespachoCostoUnit = new Map<number, import("decimal.js").Decimal>();
    for (const id of despacho.items) {
      const ic = id.itemContenedor;
      if (!ic) {
        throw new AsientoError(
          "DOMINIO_INVALIDO",
          `Despacho ${despacho.codigo}: la línea ${id.id} no tiene itemContenedor (no es un despacho cruzado).`,
        );
      }
      if (ic.costoFCUnitario == null) {
        throw new AsientoError(
          "DOMINIO_INVALIDO",
          `Despacho ${despacho.codigo}: el ItemContenedor ${ic.id} no tiene costo FC (cerrá costos antes de nacionalizar).`,
        );
      }
      const costoUnitArs = toDecimal(ic.costoFCUnitario).times(tcEmb).toDecimalPlaces(2);
      itemDespachoCostoUnit.set(id.id, costoUnitArs);
      nacionalizadoArs = nacionalizadoArs.plus(costoUnitArs.times(id.cantidad).toDecimalPlaces(2));
    }
    pushDebe(
      porCodigo.get(EMBARQUE_CODIGOS.MERCADERIAS.codigo)!,
      nacionalizadoArs,
      `Despacho ${despacho.codigo} — nacionalización vía depósito fiscal (${despacho.items.length} línea${despacho.items.length === 1 ? "" : "s"})`,
    );
    pushHaber(
      cuentaDFId,
      nacionalizadoArs,
      `Despacho ${despacho.codigo} — sale de depósito fiscal`,
    );

    // 2) Tributos aduaneros del despacho (idéntico al legacy crearAsientoDespacho).
    const die = toDecimal(despacho.die).times(tcDsp).toDecimalPlaces(2);
    const te = toDecimal(despacho.tasaEstadistica).times(tcDsp).toDecimalPlaces(2);
    const arancelSim = toDecimal(despacho.arancelSim).times(tcDsp).toDecimalPlaces(2);
    const ivaAduana = toDecimal(despacho.iva).times(tcDsp).toDecimalPlaces(2);
    const ivaAdicional = toDecimal(despacho.ivaAdicional).times(tcDsp).toDecimalPlaces(2);
    const iibbAduana = toDecimal(despacho.iibb).times(tcDsp).toDecimalPlaces(2);
    const ganancias = toDecimal(despacho.ganancias).times(tcDsp).toDecimalPlaces(2);

    pushDebe(porCodigo.get(EMBARQUE_CODIGOS.DIE_EGRESO.codigo)!, die, "DIE");
    pushHaber(porCodigo.get(EMBARQUE_CODIGOS.DIE_PASIVO.codigo)!, die, "DIE por pagar (Aduana)");
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
    pushDebe(porCodigo.get(EMBARQUE_CODIGOS.ARANCEL_SIM_EGRESO.codigo)!, arancelSim, "Arancel SIM");
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

    // 3) Facturas linkadas a este despacho (DESPACHO). Mismo filtro que legacy.
    const facturasDespacho = embarque.costos.filter(
      (f) =>
        f.despachoId === despacho.id &&
        f.momento !== "ZONA_PRIMARIA" &&
        (f.estado === "BORRADOR" || f.estado === "LEGACY_BUNDLED"),
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
        const subtotalArs = toDecimal(linea.subtotal).times(tc).toDecimalPlaces(2);
        if (!subtotalArs.gt(0)) continue;
        const lineaLabel = linea.descripcion?.trim() || linea.tipo.replace(/_/g, " ").toLowerCase();
        pushDebe(linea.cuentaContableGastoId, subtotalArs, `${facturaLabel} — ${lineaLabel}`);
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
        pushDebe(factura.lineas[0].cuentaContableGastoId, otrosArs, `${facturaLabel} — otros`);
      }
      const totalFacturaArs = subtotalFacturaArs.plus(ivaArs).plus(iibbArs).plus(otrosArs);
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
      descripcion: `Despacho ${despacho.codigo} (cruzado) — embarque ${embarque.codigo}`,
      origen: AsientoOrigen.COMEX,
      lineas: lineasInput,
    });

    for (const id of despacho.items) {
      const cu = itemDespachoCostoUnit.get(id.id);
      if (cu) {
        await inner.itemDespacho.update({
          where: { id: id.id },
          data: { costoUnitario: money(cu) },
        });
      }
    }

    const updDesp = await inner.despacho.updateMany({
      where: { id: despacho.id, asientoId: null },
      data: { asientoId: asiento.id },
    });
    if (updDesp.count !== 1) {
      throw new AsientoError(
        "CONCURRENCIA",
        `Despacho ${despacho.id} fue contabilizado simultáneamente por otro proceso (race detectado).`,
      );
    }

    return asiento;
  };

  if (tx) return run(tx);
  return withNumeracionRetry(() => db.$transaction(run));
}

// ============================================================
// Ventas — asiento automático
// ============================================================
//
// DEBE  cliente.cuentaContableId (or 1.1.3.01 fallback)   totalCliente × TC (en ARS)
// HABER 4.1.1.01 Ventas Neumáticos                       subtotal × TC
// HABER 2.1.6.01 IVA Ventas por Pagar                    iva × TC
// HABER 2.1.3.02 IIBB por Pagar                          iibb × TC (si > 0)
// HABER 2.1.3.04 Otros Impuestos                         otros × TC (si > 0)
// DEBE  5.5.02 Ingresos Brutos (gasto)                   percepcionIIBB × TC (si > 0)
// HABER 2.1.3.05 IIBB Jurisdiccional a Depositar         percepcionIIBB × TC (si > 0)
//
// El cliente es la contraparte deudora; la venta genera la cuenta a cobrar.
// IIBB jurisdiccional NO se cobra adicional al cliente (embutido en
// el precio): totalCliente = subtotal + iva + iibb + otros (sin perc).
// Sunset absorbe el IIBB como gasto y lo deposita a la jurisdicción.
// Cada componente se redondea a 2dp ANTES de sumar para que DEBE = HABER exacto.

export async function crearAsientoVenta(ventaId: string, tx?: TxClient): Promise<Asiento> {
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
        percepcionIIBB: true,
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
      throw new AsientoError("DOMINIO_INVALIDO", `Venta ${ventaId} no existe.`);
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
    const percepcionIIBB = toDecimal(venta.percepcionIIBB).times(tc).toDecimalPlaces(2);
    const otros = toDecimal(venta.otros).times(tc).toDecimalPlaces(2);
    const flete = toDecimal(venta.flete).times(tc).toDecimalPlaces(2);
    // El total que paga el cliente NO incluye percepción IIBB —
    // esa va embutida en el precio (subtotal). Sunset absorbe IIBB
    // como gasto contra el pasivo a depositar a la jurisdicción.
    const total = subtotal.plus(iva).plus(iibb).plus(otros);

    // Costo de mercadería vendida (CMV) — usa costoPromedio del producto
    // al momento de emitir la venta. En ARS porque costoPromedio se
    // mantiene en pesos (capitalización post-rateio embarque).
    const totalCosto = venta.items
      .reduce(
        (acc, it) => acc.plus(toDecimal(it.producto.costoPromedio).times(it.cantidad)),
        toDecimal(0),
      )
      .toDecimalPlaces(2);

    // Provisión Impuesto Ganancias sobre la utilidad bruta
    // (subtotal - costo - flete - IIBB embutido). Flete e IIBB
    // jurisdiccional reducen la utilidad gravable (gastos deducibles).
    const utilidadBruta = subtotal.minus(totalCosto).minus(flete).minus(percepcionIIBB);
    const provisionGanancias = utilidadBruta.gt(0)
      ? utilidadBruta.times(TASA_PROVISION_GANANCIAS).toDecimalPlaces(2)
      : toDecimal(0);

    const clienteCuentaId =
      venta.cliente.cuentaContableId ?? porCodigo.get(VENTA_CODIGOS.CLIENTE_FALLBACK.codigo)!;

    // Cheques recibidos como cobro: DEBE 1.1.4.20 por el valor REAL de
    // los cheques (no por el total facturado). Si los cheques exceden
    // el total, el sobrante queda en 2.1.7.01 ANTICIPOS DE CLIENTES
    // (pasivo) — saldo a favor del cliente aplicable a facturas futuras.
    // Si los cheques cubren menos que el total, el residual queda como
    // saldo deudor del cliente (cuenta corriente).
    const totalCheques = venta.chequesRecibidos
      .reduce((acc, c) => acc.plus(toDecimal(c.importe)), toDecimal(0))
      .toDecimalPlaces(2);
    const cuentaChequesId = porCodigo.get(VENTA_CODIGOS.VALORES_A_COBRAR.codigo)!;
    const diferenciaCheques = totalCheques.minus(total);
    const saldoCliente = diferenciaCheques.lt(0) ? diferenciaCheques.abs() : toDecimal(0);
    const excedenteAnticipo = diferenciaCheques.gt(0) ? diferenciaCheques : toDecimal(0);

    const lineas: LineaInput[] = [];
    if (totalCheques.gt(0)) {
      lineas.push({
        cuentaId: cuentaChequesId,
        debe: money(totalCheques).toString(),
        haber: 0,
        descripcion: `Venta ${venta.numero} — cheques de terceros recibidos`,
      });
    }
    if (saldoCliente.gt(0)) {
      lineas.push({
        cuentaId: clienteCuentaId,
        debe: money(saldoCliente).toString(),
        haber: 0,
        descripcion: `Venta ${venta.numero} — ${venta.cliente.nombre}`,
      });
    }
    if (excedenteAnticipo.gt(0)) {
      lineas.push({
        cuentaId: porCodigo.get(VENTA_CODIGOS.ANTICIPOS_CLIENTES.codigo)!,
        debe: 0,
        haber: money(excedenteAnticipo).toString(),
        descripcion: `Venta ${venta.numero} — anticipo (cheques exceden total facturado)`,
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
    // IIBB jurisdiccional embutido — Sunset absorbe el IIBB de la
    // jurisdicción del cliente como gasto. DEBE 5.5.02 / HABER 2.1.3.05.
    // El cliente NO paga este monto adicional (ya está en el subtotal).
    if (percepcionIIBB.gt(0)) {
      lineas.push({
        cuentaId: porCodigo.get(VENTA_CODIGOS.IIBB_GASTO.codigo)!,
        debe: money(percepcionIIBB).toString(),
        haber: 0,
        descripcion: `Venta ${venta.numero} — IIBB jurisdiccional embutido`,
      });
      lineas.push({
        cuentaId: porCodigo.get(VENTA_CODIGOS.PERCEPCIONES_IIBB_A_DEPOSITAR.codigo)!,
        debe: 0,
        haber: money(percepcionIIBB).toString(),
        descripcion: `Venta ${venta.numero} — IIBB jurisdiccional a depositar`,
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
    //
    // W3 stock dual (gated): cuando STOCK_DUAL_ENABLED=true la contrapartida
    // HABER se hace contra `MERCADERIAS_A_ENTREGAR` (1.1.5.03), una cuenta
    // provisória que se cancela contra MERCADERIAS (1.1.5.01) cuando se
    // confirma la entrega. Esto mantiene contable y físico alineados durante
    // la ventana emisión→entrega.
    if (totalCosto.gt(0)) {
      const cuentaContrapartidaCodigo = isStockDualEnabled()
        ? VENTA_CODIGOS.MERCADERIAS_A_ENTREGAR.codigo
        : VENTA_CODIGOS.MERCADERIAS.codigo;
      lineas.push({
        cuentaId: porCodigo.get(VENTA_CODIGOS.CMV.codigo)!,
        debe: money(totalCosto).toString(),
        haber: 0,
        descripcion: `Venta ${venta.numero} — CMV (costo a promedio)`,
      });
      lineas.push({
        cuentaId: porCodigo.get(cuentaContrapartidaCodigo)!,
        debe: 0,
        haber: money(totalCosto).toString(),
        descripcion: isStockDualEnabled()
          ? `Venta ${venta.numero} — provisión mercaderías a entregar`
          : `Venta ${venta.numero} — egreso de stock`,
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
    const updVenta = await inner.venta.updateMany({
      where: { id: ventaId, asientoId: null },
      data: { asientoId: asiento.id },
    });
    if (updVenta.count !== 1) {
      throw new AsientoError(
        "CONCURRENCIA",
        `Venta ${ventaId} fue emitida simultáneamente por otro proceso (race detectado).`,
      );
    }
    return asiento;
  };
  if (tx) return run(tx);
  return withNumeracionRetry(() => db.$transaction(run));
}

// ============================================================
// Entrega de venta (W3) — asiento de baja física
// ============================================================
//
// DEBE  1.1.5.03 MERCADERIAS A ENTREGAR    Σ(cantidad × costoUnitario)
// HABER 1.1.5.01 MERCADERIAS                ídem
//
// Cancela la cuenta provisória que crearAsientoVenta había debitado
// contra CMV. Después de este asiento, el contable está alineado con
// el stock físico (que también baja vía MovimientoStock EGRESO).

export async function crearAsientoEntrega(entregaId: string, tx?: TxClient): Promise<Asiento> {
  const run = async (inner: TxClient) => {
    const entrega = await inner.entregaVenta.findUnique({
      where: { id: entregaId },
      select: {
        id: true,
        numero: true,
        fecha: true,
        asientoId: true,
        venta: { select: { numero: true } },
        items: {
          select: { cantidad: true, costoUnitario: true },
        },
      },
    });
    if (!entrega) {
      throw new AsientoError("DOMINIO_INVALIDO", `Entrega ${entregaId} no existe.`);
    }
    if (entrega.asientoId) {
      throw new AsientoError(
        "DOMINIO_INVALIDO",
        `Entrega ${entrega.numero} ya tiene asiento contable.`,
      );
    }

    const totalCosto = entrega.items
      .reduce((acc, it) => acc.plus(toDecimal(it.costoUnitario).times(it.cantidad)), toDecimal(0))
      .toDecimalPlaces(2);

    if (!totalCosto.gt(0)) {
      throw new AsientoError(
        "DOMINIO_INVALIDO",
        `Entrega ${entrega.numero} no tiene costo registrado — nada que asentar.`,
      );
    }

    const porCodigo = await ensureCuentasMap(inner, VENTA_CODIGOS);
    const lineas: LineaInput[] = [
      {
        cuentaId: porCodigo.get(VENTA_CODIGOS.MERCADERIAS_A_ENTREGAR.codigo)!,
        debe: money(totalCosto).toString(),
        haber: 0,
        descripcion: `Entrega ${entrega.numero} — cancela mercaderías a entregar (venta ${entrega.venta.numero})`,
      },
      {
        cuentaId: porCodigo.get(VENTA_CODIGOS.MERCADERIAS.codigo)!,
        debe: 0,
        haber: money(totalCosto).toString(),
        descripcion: `Entrega ${entrega.numero} — egreso de stock`,
      },
    ];

    const asiento = await crearAsientoEnTx(inner, {
      fecha: entrega.fecha,
      descripcion: `Entrega ${entrega.numero} (venta ${entrega.venta.numero})`,
      origen: AsientoOrigen.MANUAL,
      moneda: Moneda.ARS,
      tipoCambio: 1,
      lineas,
    });
    const updEntrega = await inner.entregaVenta.updateMany({
      where: { id: entregaId, asientoId: null },
      data: { asientoId: asiento.id },
    });
    if (updEntrega.count !== 1) {
      throw new AsientoError(
        "CONCURRENCIA",
        `EntregaVenta ${entregaId} fue contabilizada simultáneamente por otro proceso (race detectado).`,
      );
    }
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

export async function crearAsientoCompra(compraId: string, tx?: TxClient): Promise<Asiento> {
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
      throw new AsientoError("DOMINIO_INVALIDO", `Compra ${compraId} no existe.`);
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
      compra.proveedor.cuentaGastoContableId ?? (await getOrCreateCuenta(inner, gastoDef));

    const tc = toDecimal(compra.tipoCambio);
    const subtotal = toDecimal(compra.subtotal).times(tc).toDecimalPlaces(2);
    const iva = toDecimal(compra.iva).times(tc).toDecimalPlaces(2);
    const iibb = toDecimal(compra.iibb).times(tc).toDecimalPlaces(2);
    const otros = toDecimal(compra.otros).times(tc).toDecimalPlaces(2);
    const total = subtotal.plus(iva).plus(iibb).plus(otros);

    let proveedorCuentaId = compra.proveedor.cuentaContableId;
    if (!proveedorCuentaId) {
      proveedorCuentaId = porCodigo.get(COMPRA_CODIGOS.PROVEEDOR_FALLBACK.codigo) ?? null;
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
    const updCompra = await inner.compra.updateMany({
      where: { id: compraId, asientoId: null },
      data: { asientoId: asiento.id },
    });
    if (updCompra.count !== 1) {
      throw new AsientoError(
        "CONCURRENCIA",
        `Compra ${compraId} fue emitida simultáneamente por otro proceso (race detectado).`,
      );
    }
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
export async function crearAsientoGasto(gastoId: string, tx?: TxClient): Promise<Asiento> {
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
      throw new AsientoError("DOMINIO_INVALIDO", `Gasto ${gastoId} no existe.`);
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
      proveedorCuentaId = porCodigo.get(COMPRA_CODIGOS.PROVEEDOR_FALLBACK.codigo) ?? null;
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
    const updGasto = await inner.gasto.updateMany({
      where: { id: gastoId, asientoId: null },
      data: { asientoId: asiento.id, estado: "CONTABILIZADO" },
    });
    if (updGasto.count !== 1) {
      throw new AsientoError(
        "CONCURRENCIA",
        `Gasto ${gastoId} fue contabilizado simultáneamente por otro proceso (race detectado).`,
      );
    }
    return asiento;
  };
  if (tx) return run(tx);
  return withNumeracionRetry(() => db.$transaction(run));
}

// ============================================================
// EMBARQUE COSTO — Factura standalone (ADR fato gerador)
// ============================================================
//
// Genera asiento individual para una EmbarqueCosto en `fechaFactura`
// (ADR 2026-05-06-fato-gerador-livro-razao). Reemplaza el bundling
// previo en el asiento de cierre/despacho.
//
// Estado lifecycle:
//  - BORRADOR        creado, sin asiento
//  - EMITIDA         con asiento standalone (DEBE lineas+IVA+IIBB+otros / HABER proveedor)
//  - ANULADA         asiento anulado, factura cancelada
//  - LEGACY_BUNDLED  contabilizado en cierre/despacho (pre-PR)

export async function crearAsientoEmbarqueCosto(
  costoId: number,
  tx?: TxClient,
  fecha?: Date,
): Promise<Asiento> {
  const run = async (inner: TxClient) => {
    const costo = await inner.embarqueCosto.findUnique({
      where: { id: costoId },
      include: {
        proveedor: { select: { id: true, nombre: true, cuentaContableId: true } },
        embarque: { select: { codigo: true } },
        lineas: { orderBy: { id: "asc" } },
      },
    });
    if (!costo) {
      throw new AsientoError("DOMINIO_INVALIDO", `EmbarqueCosto ${costoId} no existe.`);
    }
    if (costo.asientoId) {
      throw new AsientoError(
        "DOMINIO_INVALIDO",
        `EmbarqueCosto ${costoId} ya tiene asiento contable.`,
      );
    }
    if (costo.estado === "EMITIDA") {
      throw new AsientoError("ESTADO_INVALIDO", `EmbarqueCosto ${costoId} ya está EMITIDA.`);
    }
    if (costo.estado === "LEGACY_BUNDLED") {
      throw new AsientoError(
        "ESTADO_INVALIDO",
        `EmbarqueCosto ${costoId} es LEGACY_BUNDLED — ya fue contabilizado en el cierre/despacho.`,
      );
    }
    if (!costo.fechaFactura) {
      throw new AsientoError(
        "DOMINIO_INVALIDO",
        `EmbarqueCosto ${costoId}: fechaFactura es requerida para emitir.`,
      );
    }
    if (costo.lineas.length === 0) {
      throw new AsientoError(
        "DOMINIO_INVALIDO",
        `EmbarqueCosto ${costoId}: agregá al menos una línea con cuenta de gasto.`,
      );
    }
    if (!costo.proveedor.cuentaContableId) {
      throw new AsientoError(
        "CUENTA_INVALIDA",
        `Proveedor ${costo.proveedor.nombre} no tiene cuenta contable asociada.`,
      );
    }

    const porCodigo = await ensureCuentasMap(inner, EMBARQUE_CODIGOS);
    const tc = toDecimal(costo.tipoCambio);
    const ivaArs = toDecimal(costo.iva).times(tc).toDecimalPlaces(2);
    const iibbArs = toDecimal(costo.iibb).times(tc).toDecimalPlaces(2);
    const otrosArs = toDecimal(costo.otros).times(tc).toDecimalPlaces(2);

    const facturaLabel = `${costo.proveedor.nombre}${costo.facturaNumero ? ` Fact.${costo.facturaNumero}` : ` EmbarqueCosto#${costo.id}`} — ${costo.embarque.codigo}`;

    const lineas: LineaInput[] = [];
    let subtotalArs = toDecimal(0);
    for (const linea of costo.lineas) {
      const lineaArs = toDecimal(linea.subtotal).times(tc).toDecimalPlaces(2);
      if (!gtZero(lineaArs)) continue;
      const lineaLabel = linea.descripcion?.trim() || linea.tipo.replace(/_/g, " ").toLowerCase();
      lineas.push({
        cuentaId: linea.cuentaContableGastoId,
        debe: money(lineaArs).toString(),
        haber: 0,
        descripcion: `${facturaLabel} — ${lineaLabel}`,
      });
      subtotalArs = subtotalArs.plus(lineaArs);
    }
    if (lineas.length === 0) {
      throw new AsientoError(
        "DOMINIO_INVALIDO",
        `EmbarqueCosto ${costoId}: la suma de las líneas es cero.`,
      );
    }
    if (ivaArs.gt(0)) {
      lineas.push({
        cuentaId: porCodigo.get(EMBARQUE_CODIGOS.IVA_CREDITO_COMPRAS.codigo)!,
        debe: money(ivaArs).toString(),
        haber: 0,
        descripcion: `${facturaLabel} — IVA crédito`,
      });
    }
    if (iibbArs.gt(0)) {
      lineas.push({
        cuentaId: porCodigo.get(EMBARQUE_CODIGOS.IIBB_CREDITO_COMPRAS.codigo)!,
        debe: money(iibbArs).toString(),
        haber: 0,
        descripcion: `${facturaLabel} — IIBB crédito`,
      });
    }
    if (otrosArs.gt(0)) {
      // "Otros" se imputa al primer gasto de la factura (consistente con
      // crearAsientoEmbarque legacy bundling).
      lineas.push({
        cuentaId: costo.lineas[0].cuentaContableGastoId,
        debe: money(otrosArs).toString(),
        haber: 0,
        descripcion: `${facturaLabel} — otros`,
      });
    }
    const totalArs = subtotalArs.plus(ivaArs).plus(iibbArs).plus(otrosArs);
    lineas.push({
      cuentaId: costo.proveedor.cuentaContableId,
      debe: 0,
      haber: money(totalArs).toString(),
      descripcion: `${facturaLabel} — total a pagar${costo.fechaVencimiento ? ` (vence ${costo.fechaVencimiento.toISOString().slice(0, 10)})` : ""}`,
    });

    const asiento = await crearAsientoEnTx(inner, {
      fecha: fecha ?? costo.fechaFactura,
      descripcion: `Factura emitida ${costo.facturaNumero ?? `EmbarqueCosto#${costo.id}`} — ${costo.embarque.codigo}`,
      origen: AsientoOrigen.COMEX,
      moneda: Moneda.ARS,
      tipoCambio: 1,
      lineas,
    });
    await contabilizarEnTx(inner, asiento.id);
    const updCosto = await inner.embarqueCosto.updateMany({
      where: { id: costoId, asientoId: null },
      data: { asientoId: asiento.id, estado: "EMITIDA" },
    });
    if (updCosto.count !== 1) {
      throw new AsientoError(
        "CONCURRENCIA",
        `EmbarqueCosto ${costoId} fue emitido simultáneamente por otro proceso (race detectado).`,
      );
    }
    return asiento;
  };
  if (tx) return run(tx);
  return withNumeracionRetry(() => db.$transaction(run));
}

export async function anularAsientoEmbarqueCosto(costoId: number, tx?: TxClient): Promise<void> {
  const run = async (inner: TxClient) => {
    const costo = await inner.embarqueCosto.findUnique({
      where: { id: costoId },
      select: { id: true, asientoId: true, estado: true },
    });
    if (!costo) {
      throw new AsientoError("DOMINIO_INVALIDO", `EmbarqueCosto ${costoId} no existe.`);
    }
    if (costo.estado !== "EMITIDA" || !costo.asientoId) {
      throw new AsientoError(
        "ESTADO_INVALIDO",
        `EmbarqueCosto ${costoId} no está EMITIDA — nada para anular.`,
      );
    }
    await anularEnTx(inner, costo.asientoId);
    // anularEnTx ya hace updateMany sobre EmbarqueCosto vía detach, pero
    // duplicamos por idempotencia (caso anularEnTx haya cambiado).
    await inner.embarqueCosto.update({
      where: { id: costoId },
      data: { estado: "ANULADA", asientoId: null },
    });
  };
  if (tx) return run(tx);
  await db.$transaction(run);
}
