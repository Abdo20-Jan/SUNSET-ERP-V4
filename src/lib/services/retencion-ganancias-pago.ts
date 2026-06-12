import "server-only";

import { Decimal } from "decimal.js";

import { db } from "@/lib/db";
import {
  type CondicionGanancias,
  type ConceptoRG830,
  Moneda,
  MovimientoTesoreriaTipo,
  Prisma,
} from "@/generated/prisma/client";
import { DIAS_VENCIMIENTO_RETENCION_ARCA } from "./cuenta-registry";
import {
  calcularRetencionGanancias,
  type ResultadoRetencionGanancias,
} from "./retencion-ganancias";

// Capa de aplicación (con I/O) de la retención de Ganancias en el flujo de
// pago. Resuelve el proveedor, el parámetro fiscal vigente y el acumulado
// mensual, delega el cálculo a la función pura `retencion-ganancias.ts`, y
// persiste el registro `RetencionPracticada` + auditoría. Cualquier delegate
// de Prisma (cliente o transacción) sirve como `dbc` — las lecturas se hacen
// dentro de la misma transacción del pago para que el acumulado sea
// consistente (sin TOCTOU).

type ReaderClient = Pick<
  Prisma.TransactionClient,
  "proveedor" | "parametroRetencion" | "lineaAsiento"
>;

type WriterClient = Pick<Prisma.TransactionClient, "retencionPracticada" | "auditLog">;

export type ProveedorRetencion = {
  id: string;
  nombre: string;
  cuit: string | null;
  cuentaContableId: number | null;
  sujetoRetencionGanancias: boolean;
  condicionGanancias: CondicionGanancias;
  conceptoRG830: ConceptoRG830 | null;
  alicuotaRetencionGananciasOverride: Prisma.Decimal | null;
  certificadoExclusionGanancias: string | null;
  vigenciaCertExclusionGanancias: Date | null;
};

export type ParametroSnapshot = {
  id: number;
  regimen: string;
  concepto: ConceptoRG830;
  condicion: CondicionGanancias;
  minimoNoSujeto: string;
  montoFijo: string;
  alicuota: string;
  vigenciaDesde: string;
  vigenciaHasta: string | null;
};

export type RetencionPagoContexto = {
  proveedor: ProveedorRetencion;
  cuentaProveedorId: number;
  resultado: ResultadoRetencionGanancias;
  parametroSnapshot: ParametroSnapshot | null;
};

const PROVEEDOR_SELECT = {
  id: true,
  nombre: true,
  cuit: true,
  cuentaContableId: true,
  sujetoRetencionGanancias: true,
  condicionGanancias: true,
  conceptoRG830: true,
  alicuotaRetencionGananciasOverride: true,
  certificadoExclusionGanancias: true,
  vigenciaCertExclusionGanancias: true,
} as const;

async function resolverParametro(
  dbc: ReaderClient,
  args: { concepto: ConceptoRG830; condicion: CondicionGanancias; fecha: Date },
) {
  return dbc.parametroRetencion.findFirst({
    where: {
      tipo: "GANANCIAS",
      concepto: args.concepto,
      condicion: args.condicion,
      activo: true,
      vigenciaDesde: { lte: args.fecha },
      OR: [{ vigenciaHasta: null }, { vigenciaHasta: { gte: args.fecha } }],
    },
    // Tiebreak determinístico por id si dos filas comparten vigenciaDesde
    // (no debería ocurrir gracias a @@unique, pero evita ambigüedad).
    orderBy: [{ vigenciaDesde: "desc" }, { id: "desc" }],
  });
}

/**
 * Base acumulada del MES CALENDARIO de `fecha` para el proveedor: la suma
 * del BRUTO ya pagado (DEBE sobre su cuenta contable) en asientos de
 * tesorería contabilizados. Captura TODOS los pagos previos del mes —
 * tanto los que retuvieron como los que no (debajo del mínimo) — porque la
 * base sujeta de RG 830 es el monto pagado, no sólo lo retenido. Excluye
 * anulados vía el filtro de estado, y es concepto-agnóstico porque el
 * proveedor tiene un único `conceptoRG830`.
 */
export async function calcularAcumuladoMensual(
  dbc: ReaderClient,
  args: { cuentaProveedorId: number; fecha: Date },
): Promise<Decimal> {
  const inicioMes = new Date(Date.UTC(args.fecha.getUTCFullYear(), args.fecha.getUTCMonth(), 1));
  const inicioMesSiguiente = new Date(
    Date.UTC(args.fecha.getUTCFullYear(), args.fecha.getUTCMonth() + 1, 1),
  );
  const agg = await dbc.lineaAsiento.aggregate({
    where: {
      cuentaId: args.cuentaProveedorId,
      debe: { gt: 0 },
      asiento: {
        origen: "TESORERIA",
        estado: "CONTABILIZADO",
        fecha: { gte: inicioMes, lt: inicioMesSiguiente },
      },
    },
    _sum: { debe: true },
  });
  return new Decimal((agg._sum.debe ?? 0).toString());
}

/**
 * Determina si un PAGO genera retención de Ganancias y, en caso afirmativo,
 * devuelve el contexto (proveedor + cálculo + snapshot del parámetro). Sólo
 * aplica a pagos en ARS, dirigidos a UN único proveedor (todas las líneas a
 * la misma cuenta contable) que esté marcado como sujeto. Devuelve `null`
 * cuando no corresponde retención — el caller sigue el flujo de pago normal.
 */
export async function resolverRetencionGananciasParaPago(
  args: {
    tipo: MovimientoTesoreriaTipo;
    moneda: Moneda;
    fecha: Date;
    lineas: { cuentaContableId: number }[];
    base: Decimal;
  },
  dbc: ReaderClient = db,
): Promise<RetencionPagoContexto | null> {
  if (args.tipo !== MovimientoTesoreriaTipo.PAGO) return null;
  // RG 830 es doméstico (ARS). Pagos USD (proveedor exterior) quedan fuera.
  if (args.moneda !== Moneda.ARS) return null;

  const cuentaIds = [...new Set(args.lineas.map((l) => l.cuentaContableId))];
  // Sólo pago a un único proveedor (una sola cuenta contrapartida). Pagos
  // mixtos (varias cuentas) no se auto-retienen en v1.
  if (cuentaIds.length !== 1) return null;
  const cuentaProveedorId = cuentaIds[0]!;

  // La cuenta debe mapear a EXACTAMENTE un proveedor. Proveedor.cuentaContableId
  // no es @unique, y existe la cuenta fallback compartida 2.1.1.01: si dos
  // proveedores comparten la cuenta, no se puede atribuir la retención (ni el
  // acumulado mensual) con certeza → se omite la retención (más seguro que
  // mis-retener / emitir un certificado con el CUIT equivocado).
  const proveedores = (await dbc.proveedor.findMany({
    where: { cuentaContableId: cuentaProveedorId },
    select: PROVEEDOR_SELECT,
    take: 2,
  })) as ProveedorRetencion[];
  if (proveedores.length !== 1) return null;
  const proveedor = proveedores[0]!;
  if (!proveedor.sujetoRetencionGanancias) return null;

  // Resolver parámetro + acumulado sólo si hay concepto (sin él, la regla
  // no puede determinarse y no hay retención).
  let parametro: Awaited<ReturnType<typeof resolverParametro>> = null;
  let acumulado = new Decimal(0);
  if (proveedor.conceptoRG830) {
    parametro = await resolverParametro(dbc, {
      concepto: proveedor.conceptoRG830,
      condicion: proveedor.condicionGanancias,
      fecha: args.fecha,
    });
    acumulado = await calcularAcumuladoMensual(dbc, {
      cuentaProveedorId,
      fecha: args.fecha,
    });
  }

  const resultado = calcularRetencionGanancias({
    base: args.base,
    baseAcumuladaMesPrevio: acumulado,
    proveedor: {
      sujetoRetencionGanancias: proveedor.sujetoRetencionGanancias,
      condicionGanancias: proveedor.condicionGanancias,
      conceptoRG830: proveedor.conceptoRG830,
      alicuotaRetencionGananciasOverride: proveedor.alicuotaRetencionGananciasOverride,
      certificadoExclusionGanancias: proveedor.certificadoExclusionGanancias,
      vigenciaCertExclusionGanancias: proveedor.vigenciaCertExclusionGanancias,
    },
    parametro: parametro
      ? {
          minimoNoSujeto: parametro.minimoNoSujeto.toString(),
          montoFijo: parametro.montoFijo.toString(),
          alicuota: parametro.alicuota.toString(),
        }
      : null,
    fechaPago: args.fecha,
  });

  if (!resultado.aplica) return null;

  const parametroSnapshot: ParametroSnapshot | null = parametro
    ? {
        id: parametro.id,
        regimen: parametro.regimen,
        concepto: parametro.concepto,
        condicion: parametro.condicion,
        minimoNoSujeto: parametro.minimoNoSujeto.toString(),
        montoFijo: parametro.montoFijo.toString(),
        alicuota: parametro.alicuota.toString(),
        vigenciaDesde: parametro.vigenciaDesde.toISOString(),
        vigenciaHasta: parametro.vigenciaHasta ? parametro.vigenciaHasta.toISOString() : null,
      }
    : null;

  return { proveedor, cuentaProveedorId, resultado, parametroSnapshot };
}

/**
 * Construye el contexto de una retención de Ganancias MANUAL: el usuario
 * ingresa el importe a retener directamente en el diálogo de pago, sin que
 * el sistema lo calcule desde parámetros ni acumulado mensual. A diferencia
 * de `resolverRetencionGananciasParaPago`, NO exige que el proveedor esté
 * marcado `sujetoRetencionGanancias` — aplica a cualquier proveedor, siempre
 * que el pago sea en ARS a una única cuenta de proveedor identificable
 * (mapea a exactamente un proveedor, para poder emitir el certificado con el
 * CUIT correcto). Devuelve `null` cuando no se puede atribuir el proveedor o
 * los datos son inválidos; el caller traduce eso a un error claro. La
 * persistencia (`registrarRetencionPracticada`) y el asiento son idénticos
 * al camino automático.
 */
export async function construirRetencionManualParaPago(
  args: {
    tipo: MovimientoTesoreriaTipo;
    moneda: Moneda;
    lineas: { cuentaContableId: number }[];
    base: Decimal;
    importeRetenido: Decimal;
    concepto: ConceptoRG830;
  },
  dbc: ReaderClient = db,
): Promise<RetencionPagoContexto | null> {
  if (args.tipo !== MovimientoTesoreriaTipo.PAGO) return null;
  if (args.moneda !== Moneda.ARS) return null;

  const base = args.base.toDecimalPlaces(2);
  const importeRetenido = args.importeRetenido.toDecimalPlaces(2);
  // Defensa: la retención debe ser positiva y dejar un neto > 0 (no se puede
  // retener todo el pago). El schema del action ya valida esto, acá es red de
  // seguridad para cualquier otro caller.
  if (importeRetenido.lte(0) || importeRetenido.gte(base)) return null;

  const cuentaIds = [...new Set(args.lineas.map((l) => l.cuentaContableId))];
  if (cuentaIds.length !== 1) return null;
  const cuentaProveedorId = cuentaIds[0]!;

  const proveedores = (await dbc.proveedor.findMany({
    where: { cuentaContableId: cuentaProveedorId },
    select: PROVEEDOR_SELECT,
    take: 2,
  })) as ProveedorRetencion[];
  if (proveedores.length !== 1) return null;
  const proveedor = proveedores[0]!;

  const alicuota = importeRetenido.div(base).mul(100).toDecimalPlaces(4);
  const importeNetoAPagar = base.minus(importeRetenido);

  const resultado: ResultadoRetencionGanancias = {
    aplica: true,
    motivoNoAplica: null,
    concepto: args.concepto,
    condicion: proveedor.condicionGanancias,
    base,
    baseAcumuladaMesPrevio: new Decimal(0),
    minimoNoSujeto: new Decimal(0),
    baseExcedente: base,
    montoFijo: new Decimal(0),
    alicuota,
    importeRetenido,
    importeNetoAPagar,
    detalleCalculo:
      `RG 830 (manual) — ${args.concepto} (${proveedor.condicionGanancias}). ` +
      `Base ${base.toFixed(2)}; importe retenido ingresado manualmente ${importeRetenido.toFixed(2)} ` +
      `(alícuota implícita ${alicuota.toString()}%). Neto a pagar ${importeNetoAPagar.toFixed(2)}.`,
  };

  return { proveedor, cuentaProveedorId, resultado, parametroSnapshot: null };
}

function addDays(fecha: Date, dias: number): Date {
  return new Date(fecha.getTime() + dias * 86_400_000);
}

/**
 * Genera un número de certificado secuencial por año:
 * `RET-GAN-YYYY-NNNNNN`. La unicidad la garantiza el índice @unique de
 * `RetencionPracticada.certificadoNumero` (una colisión por concurrencia
 * aborta la transacción del pago — volumen bajo, riesgo aceptable en v1).
 */
async function generarCertificadoNumero(
  dbc: Pick<Prisma.TransactionClient, "retencionPracticada">,
  fecha: Date,
): Promise<string> {
  const year = fecha.getUTCFullYear();
  const prefix = `RET-GAN-${year}-`;
  const count = await dbc.retencionPracticada.count({
    where: { certificadoNumero: { startsWith: prefix } },
  });
  return `${prefix}${String(count + 1).padStart(6, "0")}`;
}

/**
 * Persiste la retención practicada + log de auditoría dentro de la
 * transacción del pago. Devuelve el registro creado.
 */
export async function registrarRetencionPracticada(
  tx: WriterClient,
  args: {
    contexto: RetencionPagoContexto;
    movimientoTesoreriaId: string;
    fecha: Date;
    createdById: string;
  },
) {
  const { contexto, movimientoTesoreriaId, fecha, createdById } = args;
  const { proveedor, resultado, parametroSnapshot } = contexto;

  const certificadoNumero = await generarCertificadoNumero(tx, fecha);
  const fechaVencimientoArca = addDays(fecha, DIAS_VENCIMIENTO_RETENCION_ARCA);

  const registro = await tx.retencionPracticada.create({
    data: {
      tipo: "GANANCIAS",
      regimen: "RG_830",
      concepto: resultado.concepto!,
      proveedorId: proveedor.id,
      movimientoTesoreriaId,
      base: resultado.base.toFixed(2),
      baseAcumuladaMesPrevio: resultado.baseAcumuladaMesPrevio.toFixed(2),
      minimoNoSujeto: resultado.minimoNoSujeto.toFixed(2),
      alicuota: resultado.alicuota.toFixed(4),
      montoFijo: resultado.montoFijo.toFixed(2),
      importeRetenido: resultado.importeRetenido.toFixed(2),
      condicionGanancias: proveedor.condicionGanancias,
      fechaRetencion: fecha,
      fechaVencimientoArca,
      estado: "PENDIENTE_ARCA",
      certificadoNumero,
      parametrosSnapshot: parametroSnapshot ?? Prisma.JsonNull,
      detalleCalculo: resultado.detalleCalculo,
      createdById,
    },
    select: { id: true, certificadoNumero: true },
  });

  await tx.auditLog.create({
    data: {
      tabla: "RetencionPracticada",
      registroId: registro.id,
      accion: "CREATE",
      datosNuevos: {
        proveedorId: proveedor.id,
        proveedorNombre: proveedor.nombre,
        concepto: resultado.concepto,
        condicion: proveedor.condicionGanancias,
        base: resultado.base.toFixed(2),
        baseAcumuladaMesPrevio: resultado.baseAcumuladaMesPrevio.toFixed(2),
        minimoNoSujeto: resultado.minimoNoSujeto.toFixed(2),
        montoFijo: resultado.montoFijo.toFixed(2),
        alicuota: resultado.alicuota.toFixed(4),
        importeRetenido: resultado.importeRetenido.toFixed(2),
        certificadoNumero,
        parametroId: parametroSnapshot?.id ?? null,
        movimientoTesoreriaId,
      },
      usuarioId: createdById,
    },
  });

  return registro;
}
