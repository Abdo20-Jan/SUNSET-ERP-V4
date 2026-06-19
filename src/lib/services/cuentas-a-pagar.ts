import "server-only";

import { montoNativoPendiente } from "@/lib/aging-presentacion";
import { db } from "@/lib/db";
import { toDecimal } from "@/lib/decimal";
import { VEP_ADUANA_CODIGOS } from "@/lib/services/cuenta-registry";
import {
  CODIGO_SALDO_PENDIENTE_ADUANA,
  PREFIJO_ADUANA,
  PREFIJO_DEUDAS_FISCALES,
  PREFIJO_PROVEEDORES_LOCAL,
  PREFIJOS_TRIBUTOS_DESPACHO,
} from "@/lib/services/prefijos-plan";
import { getSaldoUsdNativoPorCuenta } from "@/lib/services/saldo-usd-nativo";
import {
  AsientoEstado,
  CompraEstado,
  EmbarqueCostoEstado,
  EmbarqueEstado,
  GastoEstado,
  Moneda,
  MovimientoTesoreriaTipo,
  type Prisma,
  TipoProveedor,
} from "@/generated/prisma/client";

export const TIPOS_PROVEEDOR_EXTERIOR: TipoProveedor[] = [
  TipoProveedor.MERCADERIA_EXTERIOR,
  TipoProveedor.SERVICIOS_EXTERIOR,
];

export function isProveedorExterior(p: {
  tipoProveedor: TipoProveedor;
  pais?: string | null;
}): boolean {
  if (TIPOS_PROVEEDOR_EXTERIOR.includes(p.tipoProveedor)) return true;
  if (p.pais && p.pais.toUpperCase() !== "AR") return true;
  return false;
}

export type ProveedorAsociado = {
  id: string;
  nombre: string;
  cuit: string | null;
  pais: string;
  estado: string;
};

export type CxPRow = {
  cuentaId: number;
  cuentaCodigo: string;
  cuentaNombre: string;
  saldo: string;
  // Saldo USD nativo: presente sólo si la cuenta tiene líneas con
  // monedaOrigen=USD (proveedores USD-natos). Es invariante a TC — el
  // principal histórico en USD. El campo `saldo` (ARS) sigue siendo la
  // valuación contable al TC del momento de cada lanzamiento.
  saldoUsd?: string;
  proveedores: ProveedorAsociado[];
};

export type CuentasAPagar = {
  proveedoresComerciales: CxPRow[]; // 2.1.1.x
  aduana: CxPRow[]; // 2.1.5.x
  fiscales: CxPRow[]; // 2.1.3.x
  totalGeneral: string;
};

const PREFIXES = {
  PROVEEDORES: PREFIJO_PROVEEDORES_LOCAL,
  ADUANA: PREFIJO_ADUANA,
  FISCALES: PREFIJO_DEUDAS_FISCALES,
} as const;

export async function getCuentasAPagar(): Promise<CuentasAPagar> {
  const cuentas = await db.cuentaContable.findMany({
    where: {
      activa: true,
      OR: [
        { codigo: { startsWith: PREFIXES.PROVEEDORES } },
        { codigo: { startsWith: PREFIXES.ADUANA } },
        { codigo: { startsWith: PREFIXES.FISCALES } },
      ],
    },
    select: {
      id: true,
      codigo: true,
      nombre: true,
      tipo: true,
      proveedores: {
        select: {
          id: true,
          nombre: true,
          cuit: true,
          pais: true,
          estado: true,
        },
        orderBy: { nombre: "asc" },
      },
    },
    orderBy: { codigo: "asc" },
  });

  const cuentaIds = cuentas.map((c) => c.id);
  const sums = cuentaIds.length
    ? await db.lineaAsiento.groupBy({
        by: ["cuentaId"],
        where: {
          cuentaId: { in: cuentaIds },
          asiento: { estado: AsientoEstado.CONTABILIZADO },
        },
        _sum: { debe: true, haber: true },
      })
    : [];

  const saldoPorCuenta = new Map<number, string>(
    sums.map((s) => {
      const haber = toDecimal(s._sum.haber ?? 0);
      const debe = toDecimal(s._sum.debe ?? 0);
      return [s.cuentaId, haber.minus(debe).toFixed(2)];
    }),
  );

  // Saldo USD-nativo: suma montoOrigen sólo de líneas con monedaOrigen=USD.
  // Las cuentas sin ninguna línea USD-nata no aparecen en este map.
  const sumsUsd = cuentaIds.length
    ? await db.lineaAsiento.groupBy({
        by: ["cuentaId"],
        where: {
          cuentaId: { in: cuentaIds },
          monedaOrigen: Moneda.USD,
          asiento: { estado: AsientoEstado.CONTABILIZADO },
        },
        _sum: { montoOrigen: true },
      })
    : [];
  // _sum.montoOrigen viene del campo nullable y mezcla debe/haber sin signo.
  // Hay que volver a leer por separado (debe vs haber) para netear.
  const sumsUsdDebe = cuentaIds.length
    ? await db.lineaAsiento.groupBy({
        by: ["cuentaId"],
        where: {
          cuentaId: { in: cuentaIds },
          monedaOrigen: Moneda.USD,
          asiento: { estado: AsientoEstado.CONTABILIZADO },
          debe: { gt: 0 },
        },
        _sum: { montoOrigen: true },
      })
    : [];
  const sumsUsdHaber = cuentaIds.length
    ? await db.lineaAsiento.groupBy({
        by: ["cuentaId"],
        where: {
          cuentaId: { in: cuentaIds },
          monedaOrigen: Moneda.USD,
          asiento: { estado: AsientoEstado.CONTABILIZADO },
          haber: { gt: 0 },
        },
        _sum: { montoOrigen: true },
      })
    : [];
  const usdDebePorCuenta = new Map<number, import("decimal.js").Decimal>(
    sumsUsdDebe.map((s) => [s.cuentaId, toDecimal(s._sum.montoOrigen ?? 0)]),
  );
  const usdHaberPorCuenta = new Map<number, import("decimal.js").Decimal>(
    sumsUsdHaber.map((s) => [s.cuentaId, toDecimal(s._sum.montoOrigen ?? 0)]),
  );
  const saldoUsdPorCuenta = new Map<number, string>();
  for (const c of sumsUsd) {
    const debeUsd = usdDebePorCuenta.get(c.cuentaId) ?? toDecimal(0);
    const haberUsd = usdHaberPorCuenta.get(c.cuentaId) ?? toDecimal(0);
    const saldoUsd = haberUsd.minus(debeUsd);
    if (saldoUsd.gt(0.005)) {
      saldoUsdPorCuenta.set(c.cuentaId, saldoUsd.toFixed(2));
    }
  }

  const proveedoresComerciales: CxPRow[] = [];
  const aduana: CxPRow[] = [];
  const fiscales: CxPRow[] = [];
  let totalGeneral = toDecimal(0);

  for (const c of cuentas) {
    if (c.tipo !== "ANALITICA") continue;
    const saldoStr = saldoPorCuenta.get(c.id) ?? "0";
    const saldo = toDecimal(saldoStr);
    if (!saldo.gt(0)) continue;

    const saldoUsdStr = saldoUsdPorCuenta.get(c.id);
    const row: CxPRow = {
      cuentaId: c.id,
      cuentaCodigo: c.codigo,
      cuentaNombre: c.nombre,
      saldo: saldoStr,
      ...(saldoUsdStr ? { saldoUsd: saldoUsdStr } : {}),
      proveedores: c.proveedores,
    };

    if (c.codigo.startsWith(PREFIXES.PROVEEDORES)) {
      proveedoresComerciales.push(row);
    } else if (c.codigo.startsWith(PREFIXES.ADUANA)) {
      aduana.push(row);
    } else if (c.codigo.startsWith(PREFIXES.FISCALES)) {
      fiscales.push(row);
    }

    totalGeneral = totalGeneral.plus(saldo);
  }

  return {
    proveedoresComerciales,
    aduana,
    fiscales,
    totalGeneral: totalGeneral.toFixed(2),
  };
}

// Saldo por proveedor individual (cuando cada proveedor tiene su propia
// cuenta analítica). Útil para la lista "Pendientes por proveedor".
export type SaldoProveedor = {
  proveedorId: string;
  proveedorNombre: string;
  cuentaId: number;
  cuentaCodigo: string;
  cuentaNombre: string;
  saldo: string;
};

export async function getSaldosPorProveedor(): Promise<SaldoProveedor[]> {
  const proveedores = await db.proveedor.findMany({
    where: { cuentaContableId: { not: null } },
    select: {
      id: true,
      nombre: true,
      cuentaContableId: true,
      cuentaContable: { select: { codigo: true, nombre: true } },
    },
    orderBy: { nombre: "asc" },
  });

  const cuentaIds = proveedores
    .map((p) => p.cuentaContableId)
    .filter((id): id is number => id !== null);

  const sums = cuentaIds.length
    ? await db.lineaAsiento.groupBy({
        by: ["cuentaId"],
        where: {
          cuentaId: { in: cuentaIds },
          asiento: { estado: AsientoEstado.CONTABILIZADO },
        },
        _sum: { debe: true, haber: true },
      })
    : [];

  const saldoPorCuenta = new Map<number, string>(
    sums.map((s) => {
      const haber = toDecimal(s._sum.haber ?? 0);
      const debe = toDecimal(s._sum.debe ?? 0);
      return [s.cuentaId, haber.minus(debe).toFixed(2)];
    }),
  );

  return proveedores
    .map((p) => ({
      proveedorId: p.id,
      proveedorNombre: p.nombre,
      cuentaId: p.cuentaContableId!,
      cuentaCodigo: p.cuentaContable!.codigo,
      cuentaNombre: p.cuentaContable!.nombre,
      saldo: saldoPorCuenta.get(p.cuentaContableId!) ?? "0.00",
    }))
    .filter((r) => toDecimal(r.saldo).gt(0));
}

// ============================================================
// Proveedores elegibles como intermediário (despachante) en el multi-pago.
// ============================================================
// El picker de "beneficiário intermediário" debe listar TODOS los
// proveedores activos con cuenta contable — no sólo los que tienen factura
// o saldo en abierto. Un despachante (ej: CYSAR) puede no tener ninguna
// factura cargada en el sistema y aun así ser el beneficiário al que se le
// transfiere para que pague las facturas de TRP/EXOLGAN/etc en nuestro
// nombre. El shape es compatible con ProveedorOption del EmbarqueBatchPago.
export type ProveedorIntermediario = {
  proveedorId: string;
  proveedorNombre: string;
  cuentaContableId: number;
};

export async function listarProveedoresParaIntermediario(): Promise<ProveedorIntermediario[]> {
  const proveedores = await db.proveedor.findMany({
    where: {
      estado: "activo",
      cuentaContableId: { not: null },
    },
    select: {
      id: true,
      nombre: true,
      cuentaContableId: true,
    },
    orderBy: { nombre: "asc" },
  });

  return proveedores.map((p) => ({
    proveedorId: p.id,
    proveedorNombre: p.nombre,
    cuentaContableId: p.cuentaContableId!,
  }));
}

// ============================================================
// Saldos con aging (por proveedor, mostrando vencimientos)
// ============================================================

export type FacturaPendiente = {
  origen: "compra" | "embarque" | "gasto";
  id: string;
  numero: string;
  // Documento mãe: código del embarque (origen=embarque), número interno
  // del gasto (origen=gasto), número del pedido de compra (origen=compra,
  // null si la compra no fue originada por una OC). Sirve para
  // trazabilidad — saber de qué viene la factura sin tener que abrirla.
  referencia: string | null;
  fecha: string;
  fechaVencimiento: string | null;
  diasParaVencer: number | null; // negativo = vencida hace N días
  bucket: "vencida" | "proxima" | "al_dia" | "sin_fecha";
  monto: string; // ARS (Compra/Gasto: total convertido. EmbarqueCosto: lineas convertidas a ARS)
  // Pendiente en la moneda NATIVA de la factura (USD → ÷TC emisión; ARS →
  // igual a `monto`). Para presentación native-aware sin ÷tc ciego.
  montoNativo: string;
  moneda: string;
};

export type SaldoProveedorAging = {
  proveedorId: string;
  proveedorNombre: string;
  cuit: string | null;
  pais: string;
  cuentaContableId: number | null;
  saldoTotal: string; // contable, vía cuenta. Es la verdad (ARS).
  // Saldo USD nativo de la cuenta del proveedor (monedaOrigen=USD). Presente
  // sólo si la posición es USD-nata. Para pickSaldoNativo en presentación.
  saldoTotalUsd?: string;
  vencido: string;
  proximo: string; // ≤ 7 días
  alDia: string;
  facturas: FacturaPendiente[];
};

const DAY_MS = 86_400_000;

export async function getSaldosPorProveedorConAging(): Promise<SaldoProveedorAging[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const proveedores = await db.proveedor.findMany({
    select: {
      id: true,
      nombre: true,
      cuit: true,
      pais: true,
      cuentaContableId: true,
    },
    orderBy: { nombre: "asc" },
  });

  // Saldos contables por cuenta del proveedor (haber - debe = lo que se debe)
  const cuentaIds = proveedores
    .map((p) => p.cuentaContableId)
    .filter((id): id is number => id !== null);

  const sums = cuentaIds.length
    ? await db.lineaAsiento.groupBy({
        by: ["cuentaId"],
        where: {
          cuentaId: { in: cuentaIds },
          asiento: { estado: AsientoEstado.CONTABILIZADO },
        },
        _sum: { debe: true, haber: true },
      })
    : [];

  const saldoPorCuenta = new Map<number, string>(
    sums.map((s) => {
      const haber = toDecimal(s._sum.haber ?? 0);
      const debe = toDecimal(s._sum.debe ?? 0);
      return [s.cuentaId, haber.minus(debe).toFixed(2)];
    }),
  );

  // Saldo USD-nativo por cuenta del proveedor (lado acreedor: pasivo).
  const saldoUsdPorCuenta = await getSaldoUsdNativoPorCuenta(cuentaIds, "acreedor");

  // Pagos efectivos por (cuenta del proveedor, asiento): se calcula el NETO
  // (sum DEBE − sum HABER) por asiento en la cuenta del proveedor. Esto
  // descuenta correctamente flows tipo "Pago múltiple intermediário" donde
  // un asiento debita el total bruto y luego acredita parte como "Saldo
  // pendiente con intermediário" en la misma cuenta — el pago real es el
  // neto que sale del banco, no el DEBE bruto.
  //
  // Tokens de match = unión de tokens de las líneas DEBE del asiento en la
  // cuenta (las líneas HABER suelen ser descripciones genéricas tipo
  // "Saldo pendiente" sin identificadores).
  const lineasTodas =
    cuentaIds.length > 0
      ? await db.lineaAsiento.findMany({
          where: {
            cuentaId: { in: cuentaIds },
            asiento: { estado: AsientoEstado.CONTABILIZADO },
          },
          select: {
            id: true,
            cuentaId: true,
            asientoId: true,
            debe: true,
            haber: true,
            descripcion: true,
          },
        })
      : [];

  // ============================================================
  // Layer 0 — Aplicaciones de pago con FK estructural (PR hardening 2026-05-19)
  // ============================================================
  // Cuando un pago vincula explícitamente una linea DEBE a una factura
  // (via AplicacionPagoEmbarqueCosto/Compra/Gasto), Layer 0 es la fuente
  // de verdad — no depende de tokens en descripción.
  //
  // Para evitar double-counting con Layer 1/2/4 (que parsean descripciones),
  // las líneas DEBE referenciadas por una AplicacionPago* se EXCLUYEN del
  // construcción de `pagosPorCuentaTokens`. Layer 1/2/4 ven solamente las
  // líneas DEBE sin FK — token matching opera sobre pagos legacy.
  const lineaIdsConAplicacion = new Set<number>();
  const [aplPagoEmbCosto, aplPagoCompra, aplPagoGasto] = await Promise.all([
    db.aplicacionPagoEmbarqueCosto.findMany({
      select: { lineaAsientoId: true, embarqueCostoId: true, montoArs: true },
    }),
    db.aplicacionPagoCompra.findMany({
      select: { lineaAsientoId: true, compraId: true, montoArs: true },
    }),
    db.aplicacionPagoGasto.findMany({
      select: { lineaAsientoId: true, gastoId: true, montoArs: true },
    }),
  ]);
  const pagadoFkPorEmbCosto = new Map<number, ReturnType<typeof toDecimal>>();
  const pagadoFkPorCompra = new Map<string, ReturnType<typeof toDecimal>>();
  const pagadoFkPorGasto = new Map<string, ReturnType<typeof toDecimal>>();
  for (const a of aplPagoEmbCosto) {
    lineaIdsConAplicacion.add(a.lineaAsientoId);
    const prev = pagadoFkPorEmbCosto.get(a.embarqueCostoId) ?? toDecimal(0);
    pagadoFkPorEmbCosto.set(a.embarqueCostoId, prev.plus(toDecimal(a.montoArs)));
  }
  for (const a of aplPagoCompra) {
    lineaIdsConAplicacion.add(a.lineaAsientoId);
    const prev = pagadoFkPorCompra.get(a.compraId) ?? toDecimal(0);
    pagadoFkPorCompra.set(a.compraId, prev.plus(toDecimal(a.montoArs)));
  }
  for (const a of aplPagoGasto) {
    lineaIdsConAplicacion.add(a.lineaAsientoId);
    const prev = pagadoFkPorGasto.get(a.gastoId) ?? toDecimal(0);
    pagadoFkPorGasto.set(a.gastoId, prev.plus(toDecimal(a.montoArs)));
  }

  function tokensDescripcion(desc: string | null): Set<string> {
    if (!desc) return new Set();
    return new Set(desc.split(/[\s—,;]+/).filter((t) => t.length > 0));
  }

  // Map (cuentaId::asientoId) → { neto, tokens }
  type AsientoCuentaInfo = {
    neto: ReturnType<typeof toDecimal>;
    tokens: Set<string>;
  };
  const porAsientoCuenta = new Map<string, AsientoCuentaInfo>();
  for (const l of lineasTodas) {
    // Layer 0 ya cubrió esta línea — saltar para evitar double-count
    // con Layer 1/2/4 token-based.
    if (lineaIdsConAplicacion.has(l.id)) continue;
    const key = `${l.cuentaId}::${l.asientoId}`;
    let info = porAsientoCuenta.get(key);
    if (!info) {
      info = { neto: toDecimal(0), tokens: new Set() };
      porAsientoCuenta.set(key, info);
    }
    const debe = toDecimal(l.debe);
    const haber = toDecimal(l.haber);
    info.neto = info.neto.plus(debe).minus(haber);
    // Solo líneas DEBE contribuyen tokens — HABER suele ser genérico
    if (debe.gt(0)) {
      for (const t of tokensDescripcion(l.descripcion)) info.tokens.add(t);
    }
  }

  // Por cuentaId, lista de pagos efectivos (neto > 0). Para Layer 1 y 2 se
  // usa este "debe" que ya es el neto del asiento.
  const pagosPorCuentaTokens = new Map<
    number,
    Array<{ tokens: Set<string>; debe: ReturnType<typeof toDecimal> }>
  >();
  for (const [key, info] of porAsientoCuenta) {
    if (info.neto.lte(0.005)) continue; // asiento sin pago efectivo neto
    const cuentaId = Number(key.split("::")[0]);
    const arr = pagosPorCuentaTokens.get(cuentaId) ?? [];
    arr.push({ tokens: info.tokens, debe: info.neto });
    pagosPorCuentaTokens.set(cuentaId, arr);
  }

  // Token genéricos que NÃO devem disparar match — protegem contra
  // colisão em fallbacks como "Factura #3" (genérico p/ EmbarqueCosto sem
  // facturaNumero), "Pago", "factura" etc.
  const TOKENS_GENERICOS = new Set(["Factura", "factura", "Pago", "pago"]);

  function montoPagadoFactura(numero: string, cuentaId: number | null) {
    if (cuentaId === null) return toDecimal(0);
    const lineas = pagosPorCuentaTokens.get(cuentaId);
    if (!lineas) return toDecimal(0);
    // Tokenizar el numero objetivo igual que la descripción para matchear
    // multi-token (ex: "Factura #3" → ["Factura", "#3"]).
    const numeroTokens = numero.split(/[\s—,;]+/).filter((t) => t.length > 0);
    if (numeroTokens.length === 0) return toDecimal(0);
    // Token específico = un token que NÃO seja genérico. Exigimos que
    // pelo menos UM token específico esteja presente para considerar match.
    // Caso contrário, "Factura #3" pode colidir com qualquer pago a outra
    // factura genérica do mesmo proveedor.
    const tokensEspecificos = numeroTokens.filter((t) => !TOKENS_GENERICOS.has(t));
    if (tokensEspecificos.length === 0) return toDecimal(0);

    let pagado = toDecimal(0);
    for (const l of lineas) {
      const todosPresentes = numeroTokens.every((t) => l.tokens.has(t));
      if (todosPresentes) pagado = pagado.plus(l.debe);
    }
    return pagado;
  }

  // Pagos registrados por código de embarque — sirven para detectar facturas
  // ya canceladas via flow "Pago por embarque" o "Pago múltiple", donde la
  // descripción de la línea DEBE contiene el código del embarque (formato
  // "AR-YYMMDD-NNNCN") en lugar del numero específico de la factura.
  function montoPagadoEmbarque(embarqueCodigo: string, cuentaId: number | null) {
    if (cuentaId === null) return toDecimal(0);
    const lineas = pagosPorCuentaTokens.get(cuentaId);
    if (!lineas) return toDecimal(0);
    let pagado = toDecimal(0);
    for (const l of lineas) {
      if (l.tokens.has(embarqueCodigo)) pagado = pagado.plus(l.debe);
    }
    return pagado;
  }

  // Compras EMITIDAS o RECIBIDAS, no canceladas
  const compras = await db.compra.findMany({
    where: { estado: { in: [CompraEstado.EMITIDA, CompraEstado.RECIBIDA] } },
    select: {
      id: true,
      numero: true,
      fecha: true,
      fechaVencimiento: true,
      total: true,
      tipoCambio: true,
      moneda: true,
      proveedorId: true,
      pedidoCompra: { select: { numero: true } },
    },
  });

  // EmbarqueCostos contabilizados (con asiento): EMITIDA (asiento standalone,
  // en cualquier estado de embarque — cubre el flujo bonded EN_ZONA_PRIMARIA)
  // o LEGACY_BUNDLED (contabilizada en el cierre del embarque, flujo antiguo).
  // Excluye BORRADOR (sin asiento) y ANULADA (cancelada).
  const costos = await db.embarqueCosto.findMany({
    where: {
      estado: {
        in: [EmbarqueCostoEstado.EMITIDA, EmbarqueCostoEstado.LEGACY_BUNDLED],
      },
    },
    select: {
      id: true,
      facturaNumero: true,
      fechaFactura: true,
      fechaVencimiento: true,
      tipoCambio: true,
      moneda: true,
      proveedorId: true,
      iva: true,
      iibb: true,
      otros: true,
      lineas: { select: { subtotal: true } },
      embarque: { select: { codigo: true } },
    },
  });

  // Gastos contabilizados (estado = CONTABILIZADO genera saldo a pagar)
  const gastos = await db.gasto.findMany({
    where: { estado: GastoEstado.CONTABILIZADO },
    select: {
      id: true,
      numero: true,
      facturaNumero: true,
      fecha: true,
      fechaVencimiento: true,
      total: true,
      tipoCambio: true,
      moneda: true,
      proveedorId: true,
    },
  });

  function clasificar(fechaVenc: Date | null): {
    dias: number | null;
    bucket: FacturaPendiente["bucket"];
  } {
    if (!fechaVenc) return { dias: null, bucket: "sin_fecha" };
    const venc = new Date(fechaVenc);
    venc.setHours(0, 0, 0, 0);
    const dias = Math.round((venc.getTime() - today.getTime()) / DAY_MS);
    if (dias < 0) return { dias, bucket: "vencida" };
    if (dias <= 7) return { dias, bucket: "proxima" };
    return { dias, bucket: "al_dia" };
  }

  // Map proveedorId → cuentaContableId para resolver pagos
  const cuentaPorProveedor = new Map<string, number | null>(
    proveedores.map((p) => [p.id, p.cuentaContableId]),
  );

  // Estructura interna usada en las 3 pasadas de detección de pagos. Mantiene
  // el total bruto ARS y los créditos aplicados por cada layer para poder
  // cruzar pagos por embarque sin doble contabilizar lo ya descontado por
  // match de número de factura.
  type FacturaInterna = FacturaPendiente & {
    totalArs: ReturnType<typeof toDecimal>;
    tipoCambioStr: string;
    pagadoFk: ReturnType<typeof toDecimal>; // Layer 0 — AplicacionPago*
    pagadoNumero: ReturnType<typeof toDecimal>;
    pagadoEmbarque: ReturnType<typeof toDecimal>;
    pagadoFifoSinId: ReturnType<typeof toDecimal>;
    pagadoFifo: ReturnType<typeof toDecimal>;
  };

  function registrarFactura(
    factura: Omit<FacturaPendiente, "montoNativo">,
    totalArs: ReturnType<typeof toDecimal>,
    proveedorId: string,
    pagadoFk: ReturnType<typeof toDecimal>,
    tipoCambioStr: string,
  ) {
    const cuentaId = cuentaPorProveedor.get(proveedorId) ?? null;
    const pagadoNumero = montoPagadoFactura(factura.numero, cuentaId);
    const arr = facturasPorProveedor.get(proveedorId) ?? [];
    arr.push({
      ...factura,
      montoNativo: "0", // provisório — recalculado con el pendiente final
      totalArs,
      tipoCambioStr,
      pagadoFk,
      pagadoNumero,
      pagadoEmbarque: toDecimal(0),
      pagadoFifoSinId: toDecimal(0),
      pagadoFifo: toDecimal(0),
    });
    facturasPorProveedor.set(proveedorId, arr);
  }

  const facturasPorProveedor = new Map<string, FacturaInterna[]>();

  for (const c of compras) {
    const totalArs = toDecimal(c.total).times(toDecimal(c.tipoCambio));
    const { dias, bucket } = clasificar(c.fechaVencimiento);
    registrarFactura(
      {
        origen: "compra",
        id: c.id,
        numero: c.numero,
        referencia: c.pedidoCompra?.numero ?? null,
        fecha: c.fecha.toISOString(),
        fechaVencimiento: c.fechaVencimiento?.toISOString() ?? null,
        diasParaVencer: dias,
        bucket,
        monto: totalArs.toFixed(2), // sobrescrito por emitirSiPendiente
        moneda: c.moneda,
      },
      totalArs,
      c.proveedorId,
      pagadoFkPorCompra.get(c.id) ?? toDecimal(0),
      toDecimal(c.tipoCambio).toString(),
    );
  }

  for (const c of costos) {
    const subtotalLineas = c.lineas.reduce(
      (acc, l) => acc.plus(toDecimal(l.subtotal)),
      toDecimal(0),
    );
    const totalMoneda = subtotalLineas
      .plus(toDecimal(c.iva))
      .plus(toDecimal(c.iibb))
      .plus(toDecimal(c.otros));
    const totalArs = totalMoneda.times(toDecimal(c.tipoCambio));
    const { dias, bucket } = clasificar(c.fechaVencimiento);
    registrarFactura(
      {
        origen: "embarque",
        id: String(c.id),
        numero: c.facturaNumero ?? `Factura #${c.id}`,
        referencia: c.embarque.codigo,
        fecha: (c.fechaFactura ?? new Date()).toISOString(),
        fechaVencimiento: c.fechaVencimiento?.toISOString() ?? null,
        diasParaVencer: dias,
        bucket,
        monto: totalArs.toFixed(2),
        moneda: c.moneda,
      },
      totalArs,
      c.proveedorId,
      pagadoFkPorEmbCosto.get(c.id) ?? toDecimal(0),
      toDecimal(c.tipoCambio).toString(),
    );
  }

  for (const g of gastos) {
    const totalArs = toDecimal(g.total).times(toDecimal(g.tipoCambio));
    const { dias, bucket } = clasificar(g.fechaVencimiento);
    // Si facturaNumero existe, "numero" muestra el comprobante del proveedor
    // y "referencia" muestra el numero interno del gasto. Si no, ambos son
    // el mismo y la columna referencia queda vacía para no duplicar.
    const tieneFacturaNumero = g.facturaNumero != null && g.facturaNumero !== g.numero;
    registrarFactura(
      {
        origen: "gasto",
        id: g.id,
        numero: g.facturaNumero ?? g.numero,
        referencia: tieneFacturaNumero ? g.numero : null,
        fecha: g.fecha.toISOString(),
        fechaVencimiento: g.fechaVencimiento?.toISOString() ?? null,
        diasParaVencer: dias,
        bucket,
        monto: totalArs.toFixed(2),
        moneda: g.moneda,
      },
      totalArs,
      g.proveedorId,
      pagadoFkPorGasto.get(g.id) ?? toDecimal(0),
      toDecimal(g.tipoCambio).toString(),
    );
  }

  // ============================================================
  // Layer 2 — Pago por embarque (origen=embarque):
  // El flow "Pago por embarque" / "Pago múltiple" registra DEBE en la
  // cuenta del proveedor con descripción tipo "AR-YYMMDD-NNNCN — proveedor"
  // — sin numero específico de factura.
  //
  // Threshold de cobertura: solo se zera el grupo si el pago efectivo
  // (neto, computado en pagosPorCuentaTokens vía DEBE − HABER por asiento)
  // cubre ≥80% del total pendiente del grupo. Esto evita falsos positivos
  // en flows "Pago múltiple intermediário" donde el asiento debita el
  // total bruto pero acredita la mayor parte como "Saldo pendiente con
  // intermediário" en la misma cuenta — el pago real (lo que sale del
  // banco) puede ser solo 5-10% del bruto, lo que NO debe zerar las
  // facturas (Layer 3 ajusta el agregado contra saldoContable).
  //
  // Cuando supera 98%, se zera todo el grupo aunque sobre un poco de
  // residuo en saldoContable — ese residuo suele ser comisión o saldo
  // remanente con despachante que el usuario considera la factura paga.
  // (Threshold subido de 80% a 98% en 2026-05-06: 80% escondía facturas
  // con ~20% de saldo intermediário aún pendiente — el user necesita
  // verlas en pendentes para liquidar.)
  // ============================================================
  const COBERTURA_MINIMA = 0.98;

  for (const [proveedorId, fcts] of facturasPorProveedor) {
    const cuentaId = cuentaPorProveedor.get(proveedorId) ?? null;
    if (cuentaId === null) continue;

    // Agrupar facturas origen=embarque por código de embarque
    const porEmbarque = new Map<string, FacturaInterna[]>();
    for (const f of fcts) {
      if (f.origen !== "embarque" || !f.referencia) continue;
      const arr = porEmbarque.get(f.referencia) ?? [];
      arr.push(f);
      porEmbarque.set(f.referencia, arr);
    }

    for (const [embarqueCodigo, grupo] of porEmbarque) {
      const pagoEmbarqueTotal = montoPagadoEmbarque(embarqueCodigo, cuentaId);
      // Lo ya atribuido vía match por número (puede ser 0 si los pagos no
      // mencionan ningún número específico — caso pago por embarque puro)
      const pagoYaAtribuido = grupo.reduce((acc, f) => acc.plus(f.pagadoNumero), toDecimal(0));
      const pagoExtra = pagoEmbarqueTotal.minus(pagoYaAtribuido);
      if (pagoExtra.lte(0.005)) continue;

      const totalPendienteGrupo = grupo.reduce(
        (acc, f) => acc.plus(f.totalArs.minus(f.pagadoNumero)),
        toDecimal(0),
      );
      if (totalPendienteGrupo.lte(0.005)) continue;

      // Threshold: cobertura efectiva debe ser ≥ COBERTURA_MINIMA del total
      const cobertura = pagoExtra.div(totalPendienteGrupo).toNumber();
      if (cobertura < COBERTURA_MINIMA) continue;

      // Pago efetivo ≥ 80% del total — zerar todo el grupo
      for (const f of grupo) {
        f.pagadoEmbarque = f.totalArs.minus(f.pagadoNumero);
      }
    }
  }

  // ============================================================
  // Layer 4 — Pagos sin identificador (FIFO por cuenta del proveedor):
  // Captura pagos efectivos en la cuenta del proveedor cuya descripción
  // no menciona ni número de factura (Layer 1) ni código de embarque
  // (Layer 2) — ej. "PAGO ARS 159373.40", "TP LOGISTICA - LOGISTICA",
  // o descripción vacía. Distribuye via FIFO (factura más antigua
  // primero) entre las pendientes del proveedor, limitado al
  // sumaPendientes para no descontar de más.
  //
  // Estrictamente más robusto que Layer 3 (FIFO contra saldoContable),
  // porque no se confunde con "deuda fantasma" antigua acumulada en la
  // cuenta. Layer 3 se mantiene como fallback para casos en que el
  // pago se acreditó en una cuenta distinta del proveedor (no aparece
  // en pagosPorCuentaTokens) pero sí en el ledger contable.
  // ============================================================
  for (const [proveedorId, fcts] of facturasPorProveedor) {
    const cuentaId = cuentaPorProveedor.get(proveedorId) ?? null;
    if (cuentaId === null) continue;

    const pagos = pagosPorCuentaTokens.get(cuentaId) ?? [];
    const pagoTotalCuenta = pagos.reduce((acc, l) => acc.plus(l.debe), toDecimal(0));
    const pagoAtribuido = fcts.reduce(
      (acc, f) => acc.plus(f.pagadoNumero).plus(f.pagadoEmbarque),
      toDecimal(0),
    );
    let pagoNoAtribuido = pagoTotalCuenta.minus(pagoAtribuido);
    if (pagoNoAtribuido.lte(0.005)) continue;

    const fctsOrdenadas = [...fcts].sort((a, b) => a.fecha.localeCompare(b.fecha));
    for (const f of fctsOrdenadas) {
      if (pagoNoAtribuido.lte(0.005)) break;
      const pendienteFactura = f.totalArs.minus(f.pagadoNumero).minus(f.pagadoEmbarque);
      if (pendienteFactura.lte(0.005)) continue;
      const tomar = pendienteFactura.gt(pagoNoAtribuido) ? pagoNoAtribuido : pendienteFactura;
      f.pagadoFifoSinId = f.pagadoFifoSinId.plus(tomar);
      pagoNoAtribuido = pagoNoAtribuido.minus(tomar);
    }
  }

  const result: SaldoProveedorAging[] = [];
  for (const p of proveedores) {
    const facturasInternas = facturasPorProveedor.get(p.id) ?? [];
    const saldoContable =
      p.cuentaContableId != null ? (saldoPorCuenta.get(p.cuentaContableId) ?? "0.00") : "0.00";
    const saldoContableDec = toDecimal(saldoContable);

    // El ledger contable es la verdad: si saldo ≤ 0 (no se debe nada),
    // descartar todas las facturas — pagas via flow legacy / pago genérico
    // sin identificador en descripción.
    if (saldoContableDec.lte(0.005)) {
      if (saldoContableDec.lte(0)) continue;
      // saldo entre 0 y 0.005: tratar como cero
      continue;
    }

    // Pendientes brutos por factura (después de Layer 0 + 1 + 2 + 4)
    type Pendiente = { f: FacturaInterna; pendiente: ReturnType<typeof toDecimal> };
    const pendientes: Pendiente[] = facturasInternas
      .map((f) => ({
        f,
        pendiente: f.totalArs
          .minus(f.pagadoFk)
          .minus(f.pagadoNumero)
          .minus(f.pagadoEmbarque)
          .minus(f.pagadoFifoSinId),
      }))
      .filter((x) => x.pendiente.gt(0.005));

    // ============================================================
    // Layer 3 — Fallback FIFO contra saldoContable:
    // Si la suma de pendientes excede el saldo contable de la cuenta del
    // proveedor (verdad última del ledger), hubo pagos sin identificador
    // (descripción genérica como "PAGO ARS NNN.NN"). Descontamos del más
    // antiguo al más nuevo hasta que el residual coincida con saldoContable.
    // ============================================================
    const sumaPendientes = pendientes.reduce((acc, x) => acc.plus(x.pendiente), toDecimal(0));
    if (sumaPendientes.gt(saldoContableDec.plus(0.005))) {
      let exceso = sumaPendientes.minus(saldoContableDec);
      pendientes.sort((a, b) => a.f.fecha.localeCompare(b.f.fecha));
      for (const x of pendientes) {
        if (exceso.lte(0.005)) break;
        const tomar = x.pendiente.gt(exceso) ? exceso : x.pendiente;
        x.f.pagadoFifo = x.f.pagadoFifo.plus(tomar);
        x.pendiente = x.pendiente.minus(tomar);
        exceso = exceso.minus(tomar);
      }
    }

    // Facturas finales — umbral 0.50 ARS para descartar residuos de centavo
    // que vienen del cruce FIFO entre Layer 2 y Layer 3 (drift entre cifras
    // brutas en haber con dos decimales y pagos efectivos en netos).
    const facturas: FacturaPendiente[] = pendientes
      .filter((x) => x.pendiente.gt(0.5))
      .map(({ f, pendiente }) => ({
        origen: f.origen,
        id: f.id,
        numero: f.numero,
        referencia: f.referencia,
        fecha: f.fecha,
        fechaVencimiento: f.fechaVencimiento,
        diasParaVencer: f.diasParaVencer,
        bucket: f.bucket,
        monto: pendiente.toFixed(2),
        montoNativo: montoNativoPendiente(pendiente.toFixed(2), f.moneda, f.tipoCambioStr),
        moneda: f.moneda,
      }));

    let vencido = toDecimal(0);
    let proximo = toDecimal(0);
    let alDia = toDecimal(0);
    for (const f of facturas) {
      const m = toDecimal(f.monto);
      if (f.bucket === "vencida") vencido = vencido.plus(m);
      else if (f.bucket === "proxima") proximo = proximo.plus(m);
      else alDia = alDia.plus(m);
    }

    facturas.sort((a, b) => {
      const da = a.diasParaVencer ?? Number.POSITIVE_INFINITY;
      const db_ = b.diasParaVencer ?? Number.POSITIVE_INFINITY;
      return da - db_;
    });

    const saldoTotalUsdStr = p.cuentaContableId
      ? saldoUsdPorCuenta.get(p.cuentaContableId)
      : undefined;

    result.push({
      proveedorId: p.id,
      proveedorNombre: p.nombre,
      cuit: p.cuit,
      pais: p.pais,
      cuentaContableId: p.cuentaContableId,
      saldoTotal: saldoContable,
      ...(saldoTotalUsdStr ? { saldoTotalUsd: saldoTotalUsdStr } : {}),
      vencido: vencido.toFixed(2),
      proximo: proximo.toFixed(2),
      alDia: alDia.toFixed(2),
      facturas,
    });
  }

  result.sort((a, b) => toDecimal(b.vencido).minus(toDecimal(a.vencido)).toNumber());
  return result;
}

// ============================================================
// Cuentas a pagar agrupadas por EMBARQUE — para "pagar todos los
// costos de un embarque a un proveedor en un único movimiento".
// ============================================================

export type CuentaAPagarPorEmbarque = {
  embarqueId: string;
  embarqueCodigo: string;
  proveedorId: string;
  proveedorNombre: string;
  proveedorCuentaContableId: number | null;
  proveedorCuentaCodigo: string | null;
  facturas: Array<{
    id: number;
    numero: string;
    fecha: string;
    fechaVencimiento: string | null;
    totalArs: string;
  }>;
  totalArs: string;
  // Saldo vivo de la cuenta del proveedor (haber − debe a través de
  // todos los asientos contabilizados). Si la cuenta está en cero, el
  // grupo se omite — todo está pagado. Si > 0, ese monto es la deuda
  // real (puede cubrir N embarques pendientes del mismo proveedor).
  saldoVivoProveedorArs: string;
  // Monto sugerido para pagar este grupo: min(totalArs, saldoVivo).
  // Si totalArs > saldoVivo, indica que ya hubo pagos parciales
  // (probablemente de otros embarques del mismo proveedor) reduciendo
  // la deuda viva.
  pendienteArs: string;
};

export async function getCuentasAPagarPorEmbarque(): Promise<CuentaAPagarPorEmbarque[]> {
  // EmbarqueCostos contabilizados (con asiento): EMITIDA (asiento standalone,
  // en cualquier estado de embarque — cubre el flujo bonded EN_ZONA_PRIMARIA)
  // o LEGACY_BUNDLED (contabilizada en el cierre del embarque, flujo antiguo).
  // Excluye BORRADOR (sin asiento) y ANULADA (cancelada).
  const costos = await db.embarqueCosto.findMany({
    where: {
      estado: {
        in: [EmbarqueCostoEstado.EMITIDA, EmbarqueCostoEstado.LEGACY_BUNDLED],
      },
    },
    select: {
      id: true,
      facturaNumero: true,
      fechaFactura: true,
      fechaVencimiento: true,
      tipoCambio: true,
      moneda: true,
      iva: true,
      iibb: true,
      otros: true,
      lineas: { select: { subtotal: true } },
      embarque: { select: { id: true, codigo: true } },
      proveedor: {
        select: {
          id: true,
          nombre: true,
          cuentaContableId: true,
          cuentaContable: { select: { codigo: true } },
        },
      },
    },
    orderBy: { fechaFactura: "desc" },
  });

  // Agrupar por (embarqueId + proveedorId)
  type GroupKey = string;
  const groups = new Map<GroupKey, CuentaAPagarPorEmbarque>();

  for (const c of costos) {
    const subtotalLineas = c.lineas.reduce(
      (acc, l) => acc.plus(toDecimal(l.subtotal)),
      toDecimal(0),
    );
    const totalMoneda = subtotalLineas
      .plus(toDecimal(c.iva))
      .plus(toDecimal(c.iibb))
      .plus(toDecimal(c.otros));
    const totalArs = totalMoneda.times(toDecimal(c.tipoCambio));

    const key: GroupKey = `${c.embarque.id}::${c.proveedor.id}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        embarqueId: c.embarque.id,
        embarqueCodigo: c.embarque.codigo,
        proveedorId: c.proveedor.id,
        proveedorNombre: c.proveedor.nombre,
        proveedorCuentaContableId: c.proveedor.cuentaContableId,
        proveedorCuentaCodigo: c.proveedor.cuentaContable?.codigo ?? null,
        facturas: [],
        totalArs: "0",
        saldoVivoProveedorArs: "0",
        pendienteArs: "0",
      };
      groups.set(key, group);
    }
    group.facturas.push({
      id: c.id,
      numero: c.facturaNumero ?? `Factura #${c.id}`,
      fecha: (c.fechaFactura ?? new Date()).toISOString(),
      fechaVencimiento: c.fechaVencimiento?.toISOString() ?? null,
      totalArs: totalArs.toFixed(2),
    });
  }

  // Calcular total + filtrar grupos donde ya se aplicaron pagos por
  // ese embarque puntual a la cuenta del proveedor.
  const result: CuentaAPagarPorEmbarque[] = [];

  // Saldo vivo global del proveedor (haber - debe) — informativo.
  const cuentaIds = Array.from(groups.values())
    .map((g) => g.proveedorCuentaContableId)
    .filter((id): id is number => id !== null);
  const sums =
    cuentaIds.length > 0
      ? await db.lineaAsiento.groupBy({
          by: ["cuentaId"],
          where: {
            cuentaId: { in: cuentaIds },
            asiento: { estado: AsientoEstado.CONTABILIZADO },
          },
          _sum: { debe: true, haber: true },
        })
      : [];
  const saldoVivoPorCuenta = new Map<number, string>(
    sums.map((s) => {
      const haber = toDecimal(s._sum.haber ?? 0);
      const debe = toDecimal(s._sum.debe ?? 0);
      return [s.cuentaId, haber.minus(debe).toFixed(2)];
    }),
  );

  // Construir pagosPorCuentaTokens espelhando la lógica de
  // getSaldosPorProveedorConAging: por cuenta del proveedor, lista de
  // asientos contabilizados con NETO (DEBE − HABER) > 0 y los tokens
  // de descripción de las líneas DEBE. Esto habilita Layer 1 (match
  // por número de factura) y Layer 4 (FIFO sin id) en este endpoint —
  // antes solo detectaba pagos mencionando el código del embarque.
  const lineasTodas =
    cuentaIds.length > 0
      ? await db.lineaAsiento.findMany({
          where: {
            cuentaId: { in: cuentaIds },
            asiento: { estado: AsientoEstado.CONTABILIZADO },
          },
          select: {
            id: true,
            cuentaId: true,
            asientoId: true,
            debe: true,
            haber: true,
            descripcion: true,
          },
        })
      : [];

  // Layer 0 — AplicacionPagoEmbarqueCosto (este endpoint solo cubre
  // facturas EmbarqueCosto). Construye pagadoFkPorEmbCosto y registra
  // las líneas DEBE ya cubiertas para excluirlas de Layer 1/2/4.
  const aplicaciones = await db.aplicacionPagoEmbarqueCosto.findMany({
    select: { lineaAsientoId: true, embarqueCostoId: true, montoArs: true },
  });
  const pagadoFkPorEmbCosto = new Map<number, ReturnType<typeof toDecimal>>();
  const lineaIdsConAplicacion = new Set<number>();
  for (const a of aplicaciones) {
    lineaIdsConAplicacion.add(a.lineaAsientoId);
    const prev = pagadoFkPorEmbCosto.get(a.embarqueCostoId) ?? toDecimal(0);
    pagadoFkPorEmbCosto.set(a.embarqueCostoId, prev.plus(toDecimal(a.montoArs)));
  }

  function tokensDescripcion(desc: string | null): Set<string> {
    if (!desc) return new Set();
    return new Set(desc.split(/[\s—,;]+/).filter((t) => t.length > 0));
  }

  type AsientoCuentaInfo = {
    neto: ReturnType<typeof toDecimal>;
    tokens: Set<string>;
  };
  const porAsientoCuenta = new Map<string, AsientoCuentaInfo>();
  for (const l of lineasTodas) {
    if (lineaIdsConAplicacion.has(l.id)) continue; // Layer 0 ya cubrió
    const key = `${l.cuentaId}::${l.asientoId}`;
    let info = porAsientoCuenta.get(key);
    if (!info) {
      info = { neto: toDecimal(0), tokens: new Set() };
      porAsientoCuenta.set(key, info);
    }
    const debe = toDecimal(l.debe);
    const haber = toDecimal(l.haber);
    info.neto = info.neto.plus(debe).minus(haber);
    if (debe.gt(0)) {
      for (const t of tokensDescripcion(l.descripcion)) info.tokens.add(t);
    }
  }

  const pagosPorCuentaTokens = new Map<
    number,
    Array<{ tokens: Set<string>; debe: ReturnType<typeof toDecimal> }>
  >();
  for (const [key, info] of porAsientoCuenta) {
    if (info.neto.lte(0.005)) continue;
    const cuentaId = Number(key.split("::")[0]);
    const arr = pagosPorCuentaTokens.get(cuentaId) ?? [];
    arr.push({ tokens: info.tokens, debe: info.neto });
    pagosPorCuentaTokens.set(cuentaId, arr);
  }

  const TOKENS_GENERICOS = new Set(["Factura", "factura", "Pago", "pago"]);

  function montoPagadoFactura(
    numero: string,
    cuentaId: number | null,
  ): ReturnType<typeof toDecimal> {
    if (cuentaId === null) return toDecimal(0);
    const lineas = pagosPorCuentaTokens.get(cuentaId);
    if (!lineas) return toDecimal(0);
    const numeroTokens = numero.split(/[\s—,;]+/).filter((t) => t.length > 0);
    if (numeroTokens.length === 0) return toDecimal(0);
    const tokensEspecificos = numeroTokens.filter((t) => !TOKENS_GENERICOS.has(t));
    if (tokensEspecificos.length === 0) return toDecimal(0);
    let pagado = toDecimal(0);
    for (const l of lineas) {
      if (numeroTokens.every((t) => l.tokens.has(t))) pagado = pagado.plus(l.debe);
    }
    return pagado;
  }

  function montoPagadoEmbarque(
    embarqueCodigo: string,
    cuentaId: number | null,
  ): ReturnType<typeof toDecimal> {
    if (cuentaId === null) return toDecimal(0);
    const lineas = pagosPorCuentaTokens.get(cuentaId);
    if (!lineas) return toDecimal(0);
    let pagado = toDecimal(0);
    for (const l of lineas) {
      if (l.tokens.has(embarqueCodigo)) pagado = pagado.plus(l.debe);
    }
    return pagado;
  }

  // Per proveedor: lista de todas las facturas de este endpoint (con
  // pendiente acumulado por Layer 1 y Layer 2). Layer 4 FIFO se aplica
  // después distribuyendo el remanente no atribuido.
  type FacturaCalc = {
    grupoKey: string;
    facturaId: number;
    numero: string;
    fecha: string;
    embarqueCodigo: string;
    totalArs: ReturnType<typeof toDecimal>;
    pagadoFk: ReturnType<typeof toDecimal>; // Layer 0 — AplicacionPagoEmbarqueCosto
    pagadoNumero: ReturnType<typeof toDecimal>;
    pagadoEmbarque: ReturnType<typeof toDecimal>;
    pagadoFifoSinId: ReturnType<typeof toDecimal>;
  };
  const facturasPorProveedor = new Map<string, FacturaCalc[]>();
  const cuentaPorProveedor = new Map<string, number | null>();
  for (const [key, g] of groups) {
    cuentaPorProveedor.set(g.proveedorId, g.proveedorCuentaContableId);
    const arr = facturasPorProveedor.get(g.proveedorId) ?? [];
    for (const f of g.facturas) {
      arr.push({
        grupoKey: key,
        facturaId: f.id,
        numero: f.numero,
        fecha: f.fecha,
        embarqueCodigo: g.embarqueCodigo,
        totalArs: toDecimal(f.totalArs),
        pagadoFk: pagadoFkPorEmbCosto.get(f.id) ?? toDecimal(0),
        pagadoNumero: montoPagadoFactura(f.numero, g.proveedorCuentaContableId),
        pagadoEmbarque: toDecimal(0),
        pagadoFifoSinId: toDecimal(0),
      });
    }
    facturasPorProveedor.set(g.proveedorId, arr);
  }

  // Layer 2 — pago por código de embarque con threshold 98% del grupo
  const COBERTURA_MINIMA = 0.98;
  for (const [proveedorId, fcts] of facturasPorProveedor) {
    const cuentaId = cuentaPorProveedor.get(proveedorId) ?? null;
    if (cuentaId === null) continue;
    const porEmbarque = new Map<string, FacturaCalc[]>();
    for (const f of fcts) {
      const arr = porEmbarque.get(f.embarqueCodigo) ?? [];
      arr.push(f);
      porEmbarque.set(f.embarqueCodigo, arr);
    }
    for (const [embarqueCodigo, grupo] of porEmbarque) {
      const pagoEmbarqueTotal = montoPagadoEmbarque(embarqueCodigo, cuentaId);
      const pagoYaAtribuido = grupo.reduce(
        (acc, f) => acc.plus(f.pagadoFk).plus(f.pagadoNumero),
        toDecimal(0),
      );
      const pagoExtra = pagoEmbarqueTotal.minus(pagoYaAtribuido);
      if (pagoExtra.lte(0.005)) continue;
      const totalPendienteGrupo = grupo.reduce(
        (acc, f) => acc.plus(f.totalArs.minus(f.pagadoFk).minus(f.pagadoNumero)),
        toDecimal(0),
      );
      if (totalPendienteGrupo.lte(0.005)) continue;
      const cobertura = pagoExtra.div(totalPendienteGrupo).toNumber();
      if (cobertura < COBERTURA_MINIMA) continue;
      for (const f of grupo) {
        f.pagadoEmbarque = f.totalArs.minus(f.pagadoFk).minus(f.pagadoNumero);
      }
    }
  }

  // Layer 4 — pagos sin identificador (FIFO por cuenta del proveedor)
  for (const [proveedorId, fcts] of facturasPorProveedor) {
    const cuentaId = cuentaPorProveedor.get(proveedorId) ?? null;
    if (cuentaId === null) continue;
    const pagos = pagosPorCuentaTokens.get(cuentaId) ?? [];
    const pagoTotalCuenta = pagos.reduce((acc, l) => acc.plus(l.debe), toDecimal(0));
    const pagoAtribuido = fcts.reduce(
      (acc, f) => acc.plus(f.pagadoNumero).plus(f.pagadoEmbarque),
      toDecimal(0),
    );
    // pagosPorCuentaTokens YA excluye líneas con AplicacionPago (Layer 0).
    // No incluimos pagadoFk en pagoAtribuido aquí — sería double-discount.
    let pagoNoAtribuido = pagoTotalCuenta.minus(pagoAtribuido);
    if (pagoNoAtribuido.lte(0.005)) continue;
    const fctsOrdenadas = [...fcts].sort((a, b) => a.fecha.localeCompare(b.fecha));
    for (const f of fctsOrdenadas) {
      if (pagoNoAtribuido.lte(0.005)) break;
      const pendienteFactura = f.totalArs
        .minus(f.pagadoFk)
        .minus(f.pagadoNumero)
        .minus(f.pagadoEmbarque);
      if (pendienteFactura.lte(0.005)) continue;
      const tomar = pendienteFactura.gt(pagoNoAtribuido) ? pagoNoAtribuido : pendienteFactura;
      f.pagadoFifoSinId = f.pagadoFifoSinId.plus(tomar);
      pagoNoAtribuido = pagoNoAtribuido.minus(tomar);
    }
  }

  // Indexar facturas calculadas por grupo para sumar pendiente
  const pendientePorGrupo = new Map<string, ReturnType<typeof toDecimal>>();
  const pagadoEmbarquePorGrupo = new Map<string, ReturnType<typeof toDecimal>>();
  for (const fcts of facturasPorProveedor.values()) {
    for (const f of fcts) {
      const pendF = f.totalArs
        .minus(f.pagadoFk)
        .minus(f.pagadoNumero)
        .minus(f.pagadoEmbarque)
        .minus(f.pagadoFifoSinId);
      const curPend = pendientePorGrupo.get(f.grupoKey) ?? toDecimal(0);
      pendientePorGrupo.set(f.grupoKey, curPend.plus(pendF.gt(0) ? pendF : toDecimal(0)));
      const pagadoF = f.pagadoFk
        .plus(f.pagadoNumero)
        .plus(f.pagadoEmbarque)
        .plus(f.pagadoFifoSinId);
      const curPag = pagadoEmbarquePorGrupo.get(f.grupoKey) ?? toDecimal(0);
      pagadoEmbarquePorGrupo.set(f.grupoKey, curPag.plus(pagadoF));
    }
  }

  for (const [key, g] of groups) {
    const totalGrupo = g.facturas.reduce((acc, f) => acc.plus(toDecimal(f.totalArs)), toDecimal(0));
    g.totalArs = totalGrupo.toFixed(2);

    const saldoVivo = g.proveedorCuentaContableId
      ? toDecimal(saldoVivoPorCuenta.get(g.proveedorCuentaContableId) ?? "0")
      : toDecimal(0);
    g.saldoVivoProveedorArs = saldoVivo.toFixed(2);

    const pagadoTotal = pagadoEmbarquePorGrupo.get(key) ?? toDecimal(0);
    const pendienteEmbarque = pendientePorGrupo.get(key) ?? totalGrupo;

    // Threshold de cobertura: si el pago (Layer 1 + 2 + 4) cubre ≥98% del
    // total del grupo, considerar pagado y omitir.
    if (totalGrupo.gt(0) && pagadoTotal.div(totalGrupo).toNumber() >= COBERTURA_MINIMA) continue;

    if (pendienteEmbarque.lte(0.5)) continue;

    // También respetar el saldo vivo global: si <=0, todo está pagado.
    if (saldoVivo.lte(0)) continue;

    // pendienteArs = min(pendienteEmbarque, saldoVivo). Cubre el caso
    // edge donde el embarque tiene pagos sin código pero hubo
    // amortización al proveedor.
    const pendiente = pendienteEmbarque.gt(saldoVivo) ? saldoVivo : pendienteEmbarque;
    g.pendienteArs = pendiente.toFixed(2);

    g.facturas.sort((a, b) => a.fecha.localeCompare(b.fecha));
    result.push(g);
  }

  // Orden: embarque DESC, proveedor ASC
  result.sort((a, b) => {
    if (a.embarqueCodigo !== b.embarqueCodigo) {
      return b.embarqueCodigo.localeCompare(a.embarqueCodigo);
    }
    return a.proveedorNombre.localeCompare(b.proveedorNombre);
  });

  return result;
}

// ============================================================
// VEP / Despacho aduanero por embarque — todos los tributos
// (DIE, Tasa, IVA imp, Arancel SIM, IIBB, Ganancias) que se
// pagan en un único Volante Electrónico de Pago.
// ============================================================

const PREFIXES_TRIBUTOS_DESPACHO = PREFIJOS_TRIBUTOS_DESPACHO;

export type CuentaVepLinea = {
  cuentaId: number;
  cuentaCodigo: string;
  cuentaNombre: string;
  monto: string; // ARS — monto del asiento del embarque (HABER en esa cuenta)
};

export type VepEmbarque = {
  embarqueId: string;
  embarqueCodigo: string;
  asientoId: string | null;
  asientoNumero: number | null;
  fecha: string; // ISO
  cuentas: CuentaVepLinea[];
  totalArs: string;
  pagado: boolean; // true si la suma de DEBEs posteriores cubre el HABER
};

export async function getVepEmbarques(): Promise<VepEmbarque[]> {
  // Embarques CERRADOS con asiento contabilizado
  const embarques = await db.embarque.findMany({
    where: {
      estado: EmbarqueEstado.CERRADO,
      asientoId: { not: null },
    },
    select: {
      id: true,
      codigo: true,
      asientoId: true,
      asiento: {
        select: {
          id: true,
          numero: true,
          fecha: true,
          lineas: {
            where: {
              cuenta: {
                OR: PREFIXES_TRIBUTOS_DESPACHO.map((p) => ({
                  codigo: { startsWith: p },
                })),
              },
            },
            select: {
              haber: true,
              debe: true,
              cuenta: {
                select: { id: true, codigo: true, nombre: true },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const result: VepEmbarque[] = [];

  for (const e of embarques) {
    if (!e.asiento) continue;

    // Sumar HABER por cuenta (eso es el VEP del embarque)
    const porCuenta = new Map<number, CuentaVepLinea>();
    for (const l of e.asiento.lineas) {
      const haber = toDecimal(l.haber);
      if (haber.lte(0)) continue;
      const existing = porCuenta.get(l.cuenta.id);
      if (existing) {
        existing.monto = toDecimal(existing.monto).plus(haber).toFixed(2);
      } else {
        porCuenta.set(l.cuenta.id, {
          cuentaId: l.cuenta.id,
          cuentaCodigo: l.cuenta.codigo,
          cuentaNombre: l.cuenta.nombre,
          monto: haber.toFixed(2),
        });
      }
    }

    if (porCuenta.size === 0) continue;

    const cuentas = Array.from(porCuenta.values()).sort((a, b) =>
      a.cuentaCodigo.localeCompare(b.cuentaCodigo),
    );
    const totalArs = cuentas
      .reduce((acc, c) => acc.plus(toDecimal(c.monto)), toDecimal(0))
      .toFixed(2);

    // Detectar si ya fue pagado: buscar asientos posteriores con DEBE en
    // las mismas cuentas con descripción que mencione el código del embarque.
    const cuentaIds = cuentas.map((c) => c.cuentaId);
    const debesPosteriores = await db.lineaAsiento.findMany({
      where: {
        cuentaId: { in: cuentaIds },
        debe: { gt: 0 },
        asiento: {
          estado: AsientoEstado.CONTABILIZADO,
          createdAt: { gt: e.asiento.fecha },
          descripcion: { contains: e.codigo },
        },
      },
      select: { debe: true },
    });
    const totalDebePosterior = debesPosteriores.reduce(
      (acc, l) => acc.plus(toDecimal(l.debe)),
      toDecimal(0),
    );
    const pagado = totalDebePosterior.gte(toDecimal(totalArs));

    result.push({
      embarqueId: e.id,
      embarqueCodigo: e.codigo,
      asientoId: e.asiento.id,
      asientoNumero: e.asiento.numero,
      fecha: e.asiento.fecha.toISOString(),
      cuentas,
      totalArs,
      pagado,
    });
  }

  return result;
}

/** Refuerzos / VEPs complementarios pendientes — saldo HABER de
 *  la cuenta 2.1.5.99 SALDO PENDIENTE ADUANA agrupado por embarque
 *  (extraído de la descripción de la línea o del asiento). */
export type RefuerzoVepPendiente = {
  embarqueCodigo: string;
  saldoPendiente: string;
  fechaOrigen: string; // ISO — fecha del primer asiento que generó el refuerzo
};

const RE_EMBARQUE_CODIGO = /AR-\d{6}-[A-Z0-9]+/;

export async function getRefuerzosVepPendientes(): Promise<RefuerzoVepPendiente[]> {
  const cuenta = await db.cuentaContable.findFirst({
    where: { codigo: CODIGO_SALDO_PENDIENTE_ADUANA },
    select: { id: true },
  });
  if (!cuenta) return [];

  const lineas = await db.lineaAsiento.findMany({
    where: {
      cuentaId: cuenta.id,
      asiento: { estado: AsientoEstado.CONTABILIZADO },
    },
    select: {
      debe: true,
      haber: true,
      descripcion: true,
      asiento: { select: { fecha: true, descripcion: true } },
    },
  });

  // Agrupar por código de embarque extraído de la descripción.
  // Sólo consideramos líneas cuyo texto contenga un código AR-… ; las
  // que no — caso atípico — quedan agrupadas como "_genérico" y no se
  // muestran (no podemos asociarlas a un embarque para pagarlas).
  type Bucket = { saldo: ReturnType<typeof toDecimal>; fecha: Date };
  const porEmbarque = new Map<string, Bucket>();

  for (const l of lineas) {
    const text = `${l.descripcion ?? ""} ${l.asiento.descripcion ?? ""}`;
    const m = text.match(RE_EMBARQUE_CODIGO);
    if (!m) continue;
    const codigo = m[0];
    const haber = toDecimal(l.haber);
    const debe = toDecimal(l.debe);
    const delta = haber.minus(debe); // pasivo: HABER suma saldo, DEBE lo cancela
    const existing = porEmbarque.get(codigo);
    if (existing) {
      existing.saldo = existing.saldo.plus(delta);
      if (l.asiento.fecha < existing.fecha) existing.fecha = l.asiento.fecha;
    } else {
      porEmbarque.set(codigo, { saldo: delta, fecha: l.asiento.fecha });
    }
  }

  return Array.from(porEmbarque.entries())
    .filter(([, v]) => v.saldo.gt(0.005))
    .map(([codigo, v]) => ({
      embarqueCodigo: codigo,
      saldoPendiente: v.saldo.toFixed(2),
      fechaOrigen: v.fecha.toISOString(),
    }))
    .sort((a, b) => a.embarqueCodigo.localeCompare(b.embarqueCodigo));
}

/** Saldo deudor de la cuenta CRÉDITO A FAVOR ADUANA (1.1.4.13).
 *  Retorna el monto disponible para aplicar contra próximos VEPs.
 *  Devuelve "0.00" si la cuenta no existe o el saldo es <= 0. */
export async function getSaldoCreditoAduana(): Promise<{
  cuentaId: number | null;
  cuentaCodigo: string;
  saldo: string;
}> {
  const cuenta = await db.cuentaContable.findFirst({
    where: { codigo: VEP_ADUANA_CODIGOS.CREDITO_ADUANA.codigo },
    select: { id: true, codigo: true },
  });
  if (!cuenta) {
    return {
      cuentaId: null,
      cuentaCodigo: VEP_ADUANA_CODIGOS.CREDITO_ADUANA.codigo,
      saldo: "0.00",
    };
  }
  const agg = await db.lineaAsiento.aggregate({
    where: {
      cuentaId: cuenta.id,
      asiento: { estado: AsientoEstado.CONTABILIZADO },
    },
    _sum: { debe: true, haber: true },
  });
  const debe = toDecimal(agg._sum.debe ?? 0);
  const haber = toDecimal(agg._sum.haber ?? 0);
  const saldo = debe.minus(haber); // ACTIVO: deudor = debe - haber
  return {
    cuentaId: cuenta.id,
    cuentaCodigo: cuenta.codigo,
    saldo: saldo.lte(0) ? "0.00" : saldo.toFixed(2),
  };
}

// ============================================================
// SALDOS DE PROVEEDORES DEL EXTERIOR (USD)
// ============================================================
//
// Para proveedores marcados como MERCADERIA_EXTERIOR / SERVICIOS_EXTERIOR
// (o con pais != AR), calcula saldos en USD a partir de:
//   bruto USD = sum(Compra.total + EmbarqueCosto totales) con moneda=USD
//   pagado USD = sum(MovimientoTesoreria.monto) con moneda=USD que
//                referencien la factura/embarque vía tokens en descripción
//
// El cómputo es independiente de la verdad contable ARS (que mantiene su
// saldo en `getSaldosPorProveedorConAging`). El propósito es operativo:
// el usuario debe X USD; cuando los paga, fecha el TC del día.

export type FacturaSaldoUsd = {
  // "compra"      → Compra USD del proveedor exterior (mercadería FOB con flujo Pedido→Compra)
  // "embarque"    → EmbarqueCosto USD (factura de servicios de importación al proveedor exterior)
  // "embarqueFob" → factura VIRTUAL derivada del Embarque + ItemEmbarque cuando no hay Compra ni
  //                 EmbarqueCosto cadastrada del proveedor exterior (flujo Modelo Y bonded típico,
  //                 donde la deuda FOB existe sólo en los items del embarque)
  origen: "compra" | "embarque" | "embarqueFob";
  id: string;
  numero: string;
  fecha: string;
  fechaVencimiento: string | null;
  tipoCambioOriginal: string; // TC al momento de la factura
  totalUsd: string;
  pagadoUsd: string;
  saldoUsd: string;
};

export type EmbarqueSaldoUsd = {
  embarqueId: string;
  embarqueCodigo: string;
  saldoUsd: string;
  facturas: FacturaSaldoUsd[];
};

export type ProveedorExteriorSaldo = {
  proveedorId: string;
  proveedorNombre: string;
  pais: string;
  cuit: string | null;
  saldoUsd: string;
  embarques: EmbarqueSaldoUsd[];
  // Compras USD sin link a un embarque (proveedor exterior pero compra
  // directa sin contenedor — caso menos común, agrupado aparte).
  facturasSueltas: FacturaSaldoUsd[];
};

function tokenizar(s: string | null | undefined): Set<string> {
  if (!s) return new Set();
  return new Set(s.split(/[\s—,;]+/).filter((t) => t.length > 0));
}

// ------------------------------------------------------------
// Pagos USD aplicados a cuentas de proveedores del exterior.
//
// Fuente del monto USD de cada línea DEBE de pago, en orden:
//   1. montoOrigen con monedaOrigen=USD — canónico: el principal USD es
//      metadata de la línea, invariante a TC (debe/haber viven en ARS).
//   2. Legacy sin metadata (asiento USD + MovimientoTesoreria PAGO USD):
//      con una sola línea DEBE en el asiento, el monto USD del movimiento
//      es de esa línea (cubre el pago exterior 2-líneas con debe en ARS y
//      el pago manual single-contrapartida); con multi-DEBE, las líneas
//      legacy están grabadas en USD crudo y `debe` ES el USD.
//   Nunca debe−haber como si fuera USD: en el modelo canónico debe está
//   en ARS y leerlo como USD hacía desaparecer facturas (pagado ARS
//   gigante → saldo negativo → filtrada de la vista).
//
// Match pago→factura:
//   - Si la línea tiene AplicacionPago* (FK estructural), cuenta SOLO
//     para sus facturas aplicadas (prorrateo por montoArs si hay split);
//     los tokens se ignoran — evita doble descuento cuando otra factura
//     del mismo embarque comparte el código en la descripción.
//   - Sin aplicaciones (legacy / embarqueFob): tokens en la descripción.
//
// Compartido entre getSaldosExteriorPorProveedor (vista) y
// pagarFacturaExteriorAction (validación de saldo) para que ambos vean
// exactamente el mismo pagado USD.
// ------------------------------------------------------------

type DecimalT = ReturnType<typeof toDecimal>;
type DbClient = Prisma.TransactionClient | typeof db;

export type PagoUsdAplicado = {
  usd: DecimalT;
  tokens: Set<string>;
  aplicacionesCompra: Array<{ compraId: string; montoArs: DecimalT }>;
  aplicacionesEmbarqueCosto: Array<{ embarqueCostoId: number; montoArs: DecimalT }>;
  // Aplicaciones a gastos: nunca matchean facturas del exterior, pero su
  // presencia ancla la línea (layer 0) — no debe caer al fallback de tokens.
  aplicadoGastoArs: DecimalT;
};

export type FacturaUsdRef = {
  origen: "compra" | "embarqueCosto" | "embarqueFob";
  /** UUID (compra / embarqueFob = id del Embarque) o id numérico como string (embarqueCosto). */
  id: string;
  numero: string;
  embarqueCodigo: string | null;
};

export async function getPagosUsdPorCuenta(
  client: DbClient,
  cuentaIds: number[],
): Promise<Map<number, PagoUsdAplicado[]>> {
  const out = new Map<number, PagoUsdAplicado[]>();
  if (cuentaIds.length === 0) return out;

  const lineas = await client.lineaAsiento.findMany({
    where: {
      cuentaId: { in: cuentaIds },
      debe: { gt: 0 },
      asiento: {
        estado: AsientoEstado.CONTABILIZADO,
        movimiento: { tipo: MovimientoTesoreriaTipo.PAGO },
      },
      OR: [
        { monedaOrigen: Moneda.USD },
        { asiento: { moneda: Moneda.USD, movimiento: { moneda: Moneda.USD } } },
      ],
    },
    select: {
      cuentaId: true,
      debe: true,
      descripcion: true,
      monedaOrigen: true,
      montoOrigen: true,
      asiento: {
        select: {
          moneda: true,
          movimiento: { select: { monto: true, moneda: true } },
          lineas: { where: { debe: { gt: 0 } }, select: { id: true } },
        },
      },
      aplicacionesPagoCompra: { select: { compraId: true, montoArs: true } },
      aplicacionesPagoEmbarqueCosto: { select: { embarqueCostoId: true, montoArs: true } },
      aplicacionesPagoGasto: { select: { montoArs: true } },
    },
  });

  for (const l of lineas) {
    const usd = usdDeLineaPago(l);
    if (usd.lte(0.005)) continue;
    const arr = out.get(l.cuentaId) ?? [];
    arr.push({
      usd,
      tokens: tokenizar(l.descripcion),
      aplicacionesCompra: l.aplicacionesPagoCompra.map((a) => ({
        compraId: a.compraId,
        montoArs: toDecimal(a.montoArs),
      })),
      aplicacionesEmbarqueCosto: l.aplicacionesPagoEmbarqueCosto.map((a) => ({
        embarqueCostoId: a.embarqueCostoId,
        montoArs: toDecimal(a.montoArs),
      })),
      aplicadoGastoArs: l.aplicacionesPagoGasto.reduce(
        (acc, a) => acc.plus(toDecimal(a.montoArs)),
        toDecimal(0),
      ),
    });
    out.set(l.cuentaId, arr);
  }
  return out;
}

function usdDeLineaPago(l: {
  debe: Prisma.Decimal;
  monedaOrigen: Moneda | null;
  montoOrigen: Prisma.Decimal | null;
  asiento: {
    moneda: Moneda;
    movimiento: { monto: Prisma.Decimal; moneda: Moneda } | null;
    lineas: Array<{ id: number }>;
  };
}): DecimalT {
  if (l.monedaOrigen === Moneda.USD && l.montoOrigen !== null) {
    return toDecimal(l.montoOrigen);
  }
  const mov = l.asiento.movimiento;
  if (l.asiento.moneda === Moneda.USD && mov !== null && mov.moneda === Moneda.USD) {
    if (l.asiento.lineas.length === 1) return toDecimal(mov.monto);
    return toDecimal(l.debe);
  }
  return toDecimal(0);
}

export function pagadoUsdParaFactura(
  pagos: PagoUsdAplicado[] | undefined,
  factura: FacturaUsdRef,
): DecimalT {
  let pagado = toDecimal(0);
  if (!pagos || pagos.length === 0) return pagado;
  const numTokens = tokenizar(factura.numero);

  for (const p of pagos) {
    const totalAplicadoArs = [...p.aplicacionesCompra, ...p.aplicacionesEmbarqueCosto]
      .reduce((acc, a) => acc.plus(a.montoArs), toDecimal(0))
      .plus(p.aplicadoGastoArs);

    if (totalAplicadoArs.gt(0)) {
      // Layer 0 — FK estructural: la línea cuenta sólo para sus facturas.
      let arsParaFactura = toDecimal(0);
      if (factura.origen === "compra") {
        for (const a of p.aplicacionesCompra) {
          if (a.compraId === factura.id) arsParaFactura = arsParaFactura.plus(a.montoArs);
        }
      } else if (factura.origen === "embarqueCosto") {
        const idNum = Number(factura.id);
        for (const a of p.aplicacionesEmbarqueCosto) {
          if (a.embarqueCostoId === idNum) arsParaFactura = arsParaFactura.plus(a.montoArs);
        }
      }
      if (arsParaFactura.gt(0)) {
        pagado = pagado.plus(p.usd.times(arsParaFactura).dividedBy(totalAplicadoArs));
      }
      continue;
    }

    // Fallback legacy / embarqueFob (sin tabla de aplicación): tokens.
    const matchNumero = numTokens.size > 0 && [...numTokens].every((t) => p.tokens.has(t));
    const matchEmbarque = factura.embarqueCodigo !== null && p.tokens.has(factura.embarqueCodigo);
    if (matchNumero || matchEmbarque) pagado = pagado.plus(p.usd);
  }
  return pagado.toDecimalPlaces(2);
}

export async function getSaldosExteriorPorProveedor(): Promise<ProveedorExteriorSaldo[]> {
  const proveedores = await db.proveedor.findMany({
    where: {
      OR: [{ tipoProveedor: { in: TIPOS_PROVEEDOR_EXTERIOR } }, { NOT: { pais: "AR" } }],
    },
    select: {
      id: true,
      nombre: true,
      cuit: true,
      pais: true,
      cuentaContableId: true,
      tipoProveedor: true,
    },
    orderBy: { nombre: "asc" },
  });

  const proveedorIds = proveedores.map((p) => p.id);
  if (proveedorIds.length === 0) return [];

  // Pagos USD por proveedor (vía cuenta contable proveedor + descripción tokens)
  const cuentaIds = proveedores
    .map((p) => p.cuentaContableId)
    .filter((id): id is number => id !== null);

  // Pagos USD por cuenta del proveedor — montoOrigen + AplicacionPago* como
  // fuente de verdad, con fallback legacy (ver getPagosUsdPorCuenta arriba).
  const pagosUsdPorCuenta = await getPagosUsdPorCuenta(db, cuentaIds);

  // Compras USD del proveedor
  const compras = await db.compra.findMany({
    where: {
      proveedorId: { in: proveedorIds },
      moneda: Moneda.USD,
      estado: { in: [CompraEstado.EMITIDA, CompraEstado.RECIBIDA] },
    },
    select: {
      id: true,
      numero: true,
      fecha: true,
      fechaVencimiento: true,
      total: true,
      tipoCambio: true,
      proveedorId: true,
    },
  });

  // EmbarqueCostos USD vinculados al proveedor (sólo CERRADO o embarque
  // contabilizado — facturas que ya generan saldo).
  const costos = await db.embarqueCosto.findMany({
    where: {
      proveedorId: { in: proveedorIds },
      moneda: Moneda.USD,
      embarque: {
        estado: {
          in: [
            EmbarqueEstado.EN_ZONA_PRIMARIA,
            EmbarqueEstado.EN_ADUANA,
            EmbarqueEstado.DESPACHADO,
            EmbarqueEstado.EN_DEPOSITO,
            EmbarqueEstado.CERRADO,
          ],
        },
      },
    },
    select: {
      id: true,
      facturaNumero: true,
      fechaFactura: true,
      fechaVencimiento: true,
      tipoCambio: true,
      iva: true,
      iibb: true,
      otros: true,
      proveedorId: true,
      lineas: { select: { subtotal: true } },
      embarque: { select: { id: true, codigo: true } },
    },
  });

  // Embarques propios del proveedor exterior (mercadería FOB).
  // 3 modelos posibles de "factura USD":
  //   - Compra USD vinculada via PedidoCompra → embarques[].pedidoCompraId  (flujo Pedido→Compra)
  //   - EmbarqueCosto USD del proveedor exterior (raro: factura por servicios al exterior)
  //   - Embarque + ItemEmbarque (FOB virtual): cuando ninguno de los anteriores existe, la
  //     deuda FOB se deriva de los items del embarque (cantidad × precioUnitarioFob × moneda=USD).
  //     Aplica al flujo Modelo Y bonded típico, donde la deuda existe sólo en items.
  const embarques = await db.embarque.findMany({
    where: {
      proveedorId: { in: proveedorIds },
      estado: {
        in: [
          EmbarqueEstado.EN_TRANSITO,
          EmbarqueEstado.EN_PUERTO,
          EmbarqueEstado.EN_ZONA_PRIMARIA,
          EmbarqueEstado.EN_ADUANA,
          EmbarqueEstado.DESPACHADO,
          EmbarqueEstado.EN_DEPOSITO,
          EmbarqueEstado.CERRADO,
        ],
      },
    },
    select: {
      id: true,
      codigo: true,
      proveedorId: true,
      pedidoCompraId: true,
      moneda: true,
      tipoCambio: true,
      createdAt: true,
      items: { select: { cantidad: true, precioUnitarioFob: true } },
    },
  });

  // Map pedidoCompraId → embarque para asociar compras a embarques
  const embarquePorPedido = new Map<number, { id: string; codigo: string }>();
  for (const e of embarques) {
    if (e.pedidoCompraId) {
      embarquePorPedido.set(e.pedidoCompraId, { id: e.id, codigo: e.codigo });
    }
  }
  // Map proveedorId → embarques del proveedor
  const embarquesPorProveedor = new Map<string, Array<{ id: string; codigo: string }>>();
  for (const e of embarques) {
    const arr = embarquesPorProveedor.get(e.proveedorId) ?? [];
    arr.push({ id: e.id, codigo: e.codigo });
    embarquesPorProveedor.set(e.proveedorId, arr);
  }

  // Cargar compras con su pedidoCompra para detectar el embarque asociado
  const comprasConPedido = await db.compra.findMany({
    where: { id: { in: compras.map((c) => c.id) } },
    select: { id: true, pedidoCompraId: true },
  });
  const pedidoPorCompra = new Map<string, number | null>(
    comprasConPedido.map((c) => [c.id, c.pedidoCompraId]),
  );

  const cuentaPorProveedor = new Map<string, number | null>(
    proveedores.map((p) => [p.id, p.cuentaContableId]),
  );

  const result: ProveedorExteriorSaldo[] = [];

  for (const p of proveedores) {
    const cuentaId = cuentaPorProveedor.get(p.id) ?? null;
    const pagosProv = cuentaId !== null ? pagosUsdPorCuenta.get(cuentaId) : undefined;
    const embarquesProv = embarquesPorProveedor.get(p.id) ?? [];

    // Bucket por embarque + sueltas
    const facturasPorEmbarque = new Map<string, FacturaSaldoUsd[]>();
    const sueltas: FacturaSaldoUsd[] = [];

    // Compras del proveedor exterior
    const comprasProv = compras.filter((c) => c.proveedorId === p.id);
    for (const c of comprasProv) {
      const pedidoId = pedidoPorCompra.get(c.id) ?? null;
      const embarqueRef = pedidoId !== null ? embarquePorPedido.get(pedidoId) : undefined;
      const embCodigo = embarqueRef?.codigo ?? null;
      const totalUsd = toDecimal(c.total);
      const pagadoUsd = pagadoUsdParaFactura(pagosProv, {
        origen: "compra",
        id: c.id,
        numero: c.numero,
        embarqueCodigo: embCodigo,
      });
      const saldoUsd = totalUsd.minus(pagadoUsd);
      if (saldoUsd.lte(0.005)) continue;
      const f: FacturaSaldoUsd = {
        origen: "compra",
        id: c.id,
        numero: c.numero,
        fecha: c.fecha.toISOString(),
        fechaVencimiento: c.fechaVencimiento?.toISOString() ?? null,
        tipoCambioOriginal: toDecimal(c.tipoCambio).toFixed(6),
        totalUsd: totalUsd.toFixed(2),
        pagadoUsd: pagadoUsd.toFixed(2),
        saldoUsd: saldoUsd.toFixed(2),
      };
      if (embarqueRef) {
        const arr = facturasPorEmbarque.get(embarqueRef.id) ?? [];
        arr.push(f);
        facturasPorEmbarque.set(embarqueRef.id, arr);
      } else {
        sueltas.push(f);
      }
    }

    // EmbarqueCostos del proveedor (gastos locales pagados al exterior — raro)
    const costosProv = costos.filter((c) => c.proveedorId === p.id);
    for (const c of costosProv) {
      const subtotalLineas = c.lineas.reduce(
        (acc, l) => acc.plus(toDecimal(l.subtotal)),
        toDecimal(0),
      );
      const totalUsd = subtotalLineas
        .plus(toDecimal(c.iva))
        .plus(toDecimal(c.iibb))
        .plus(toDecimal(c.otros));
      const facturaNumero = c.facturaNumero ?? `Factura #${c.id}`;
      const embCodigo = c.embarque.codigo;
      const pagadoUsd = pagadoUsdParaFactura(pagosProv, {
        origen: "embarqueCosto",
        id: String(c.id),
        numero: facturaNumero,
        embarqueCodigo: embCodigo,
      });
      const saldoUsd = totalUsd.minus(pagadoUsd);
      if (saldoUsd.lte(0.005)) continue;
      const f: FacturaSaldoUsd = {
        origen: "embarque",
        id: String(c.id),
        numero: facturaNumero,
        fecha: (c.fechaFactura ?? new Date()).toISOString(),
        fechaVencimiento: c.fechaVencimiento?.toISOString() ?? null,
        tipoCambioOriginal: toDecimal(c.tipoCambio).toFixed(6),
        totalUsd: totalUsd.toFixed(2),
        pagadoUsd: pagadoUsd.toFixed(2),
        saldoUsd: saldoUsd.toFixed(2),
      };
      const arr = facturasPorEmbarque.get(c.embarque.id) ?? [];
      arr.push(f);
      facturasPorEmbarque.set(c.embarque.id, arr);
    }

    // Embarques sin Compra ni EmbarqueCosto USD del proveedor exterior:
    // derivamos una factura VIRTUAL del propio Embarque + ItemEmbarque.
    // Match de pago: tokens del embarque.codigo en la descripción de la
    // línea DEBE (mismo algoritmo que las facturas reales).
    for (const emb of embarques.filter((e) => e.proveedorId === p.id)) {
      if (facturasPorEmbarque.has(emb.id)) continue; // ya cubierto por Compra/EmbarqueCosto
      if (emb.moneda !== Moneda.USD) continue; // FOB no-USD no aplica a la deuda USD del exterior
      const totalUsd = emb.items.reduce(
        (acc, i) => acc.plus(toDecimal(i.precioUnitarioFob).times(i.cantidad)),
        toDecimal(0),
      );
      if (totalUsd.lte(0.005)) continue;
      const pagadoUsd = pagadoUsdParaFactura(pagosProv, {
        origen: "embarqueFob",
        id: emb.id,
        numero: emb.codigo,
        embarqueCodigo: emb.codigo,
      });
      const saldoUsd = totalUsd.minus(pagadoUsd);
      if (saldoUsd.lte(0.005)) continue;
      facturasPorEmbarque.set(emb.id, [
        {
          origen: "embarqueFob",
          id: emb.id,
          numero: emb.codigo,
          fecha: emb.createdAt.toISOString(),
          fechaVencimiento: null,
          tipoCambioOriginal: toDecimal(emb.tipoCambio).toFixed(6),
          totalUsd: totalUsd.toFixed(2),
          pagadoUsd: pagadoUsd.toFixed(2),
          saldoUsd: saldoUsd.toFixed(2),
        },
      ]);
    }

    const embarquesOut: EmbarqueSaldoUsd[] = [];
    for (const emb of embarquesProv) {
      const facturas = facturasPorEmbarque.get(emb.id) ?? [];
      if (facturas.length === 0) continue;
      const saldoEmbarque = facturas.reduce(
        (acc, f) => acc.plus(toDecimal(f.saldoUsd)),
        toDecimal(0),
      );
      embarquesOut.push({
        embarqueId: emb.id,
        embarqueCodigo: emb.codigo,
        saldoUsd: saldoEmbarque.toFixed(2),
        facturas,
      });
    }

    const saldoSueltas = sueltas.reduce((acc, f) => acc.plus(toDecimal(f.saldoUsd)), toDecimal(0));
    const saldoEmbarques = embarquesOut.reduce(
      (acc, e) => acc.plus(toDecimal(e.saldoUsd)),
      toDecimal(0),
    );
    const saldoTotal = saldoEmbarques.plus(saldoSueltas);

    if (saldoTotal.lte(0.005)) continue;

    result.push({
      proveedorId: p.id,
      proveedorNombre: p.nombre,
      pais: p.pais,
      cuit: p.cuit,
      saldoUsd: saldoTotal.toFixed(2),
      embarques: embarquesOut.sort((a, b) => b.embarqueCodigo.localeCompare(a.embarqueCodigo)),
      facturasSueltas: sueltas,
    });
  }

  return result.sort((a, b) => toDecimal(b.saldoUsd).minus(toDecimal(a.saldoUsd)).toNumber());
}

// ============================================================
// Facturas pendientes indexadas por cuentaContableId del proveedor.
// Usado por el selector "Aplicar a facturas pendientes" en el
// formulario de Nuevo movimiento de tesorería. Devuelve solo
// proveedores con saldo > 0 y al menos una factura identificable.
// ============================================================

export async function getFacturasPendientesPorCuenta(): Promise<
  Record<number, FacturaPendiente[]>
> {
  const saldos = await getSaldosPorProveedorConAging();
  const out: Record<number, FacturaPendiente[]> = {};
  for (const p of saldos) {
    if (p.cuentaContableId === null) continue;
    if (p.facturas.length === 0) continue;
    out[p.cuentaContableId] = p.facturas;
  }
  return out;
}
