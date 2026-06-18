import "server-only";

import Decimal from "decimal.js";

import { db } from "@/lib/db";
import { toDecimal } from "@/lib/decimal";
import { calcularSaldosCuentasBancariasEnMonedaCuenta } from "@/lib/services/cuenta-bancaria";
import { getSaldosBancarios } from "@/lib/services/dashboard";
import { isContenedorDesconsolidacionEnabled } from "@/lib/features";
import {
  AsientoEstado,
  ChequeRecibidoEstado,
  CompraEstado,
  CuentaCategoria,
  CuentaTipo,
  DespachoEstado,
  EmbarqueEstado,
  GastoEstado,
  Moneda,
  MovimientoStockTipo,
  PedidoEstado,
  VentaEstado,
  type TipoCanal,
  type TipoCostoEmbarque,
} from "@/generated/prisma/client";

// =====================================================================
// Shared types & helpers
// =====================================================================

export type DateRange = {
  desde?: Date | null;
  hasta?: Date | null;
};

export type Money = number;
export type MoneySerie = { label: string; value: Money };
export type RankingRow = { label: string; value: Money };

const MESES_LABEL = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
];

function num(d: Decimal | string | number | null | undefined): number {
  if (d == null) return 0;
  return Number(toDecimal(d).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2));
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(d: Date): string {
  return `${MESES_LABEL[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(-2)}`;
}

function lastNMonths(n: number, ref: Date = new Date()): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - i, 1));
    out.push({ key: monthKey(d), label: monthLabel(d) });
  }
  return out;
}

function dateWhere(rng: DateRange) {
  const w: { gte?: Date; lte?: Date } = {};
  if (rng.desde) w.gte = rng.desde;
  if (rng.hasta) w.lte = rng.hasta;
  return Object.keys(w).length ? w : undefined;
}

function previousRange(rng: DateRange): DateRange {
  if (!rng.desde || !rng.hasta) return rng;
  // Current rng.hasta es end-of-day (T23:59:59.999Z). prev.hasta debe ser
  // end-of-day del día inmediatamente anterior a rng.desde para no perder
  // ~24h de comparación. prev.desde mantiene el mismo span temporal.
  const span = rng.hasta.getTime() - rng.desde.getTime();
  const prevHasta = new Date(rng.desde.getTime() - 1);
  return {
    desde: new Date(prevHasta.getTime() - span),
    hasta: prevHasta,
  };
}

function pct(a: number, b: number): number {
  if (!Number.isFinite(b) || b === 0) return 0;
  return (a - b) / Math.abs(b);
}

/** Suma de Venta.total (multi-moneda, normalizado a ARS por tipoCambio). */
async function sumarFacturacionARS(rng: DateRange, estado: VentaEstado = VentaEstado.EMITIDA) {
  const ventas = await db.venta.findMany({
    where: { estado, fecha: dateWhere(rng) },
    select: { total: true, tipoCambio: true, moneda: true },
  });
  let sum = new Decimal(0);
  for (const v of ventas) {
    const total = toDecimal(v.total);
    const tc = toDecimal(v.tipoCambio);
    sum = sum.plus(v.moneda === Moneda.USD ? total.times(tc) : total);
  }
  return { total: sum, count: ventas.length };
}

// =====================================================================
// 1. RESUMEN EJECUTIVO
// =====================================================================

export type ResumenEjecutivo = {
  kpis: {
    facturacionPeriodo: Money;
    facturacionAnterior: Money;
    facturacionDelta: number;
    margenBruto: Money;
    margenBrutoPct: number;
    resultadoEjercicio: Money;
    /**
     * Saldo de Caja + Bancos descompuesto por moneda NATIVA (ARS/USD). Deriva
     * de la MISMA fuente que el card del dashboard (`getSaldosBancarios`:
     * cuentas activas 1.1.1.01/02, saldo en moneda de la cuenta) para que el
     * KPI del BI reconcilie 1:1 con el dashboard. El USD nativo es invariante
     * al TC; la presentación lo convierte native-aware al TC de cierre.
     */
    saldoBancosCaja: { ars: Money; usd: Money };
    stockValorado: Money;
    cxc: Money;
    cxp: Money;
    embarquesActivos: number;
  };
  facturacionResultado12m: { label: string; facturacion: Money; resultado: Money }[];
  alertas: { id: string; nivel: "critical" | "warning"; titulo: string; detalle: string }[];
};

export async function getResumenEjecutivo(rng: DateRange): Promise<ResumenEjecutivo> {
  const prev = previousRange(rng);

  // CMV aprox: suma del costo unitario de ItemEntrega de entregas CONFIRMADAS del rango.
  // Si la entrega no está confirmada en el rango la venta queda sin CMV.
  const entregasConfirmadas = await db.entregaVenta.findMany({
    where: { estado: "CONFIRMADA", fecha: dateWhere(rng) },
    select: {
      items: { select: { cantidad: true, costoUnitario: true } },
    },
  });
  let cmv = new Decimal(0);
  for (const e of entregasConfirmadas) {
    for (const it of e.items) {
      cmv = cmv.plus(toDecimal(it.costoUnitario).times(it.cantidad));
    }
  }

  const [
    factPeriodo,
    factPrevio,
    saldosBancarios,
    resultado,
    stockSnap,
    cxc,
    cxp,
    embarquesActivos,
    facturacion12m,
    resultado12m,
    alertasRaw,
  ] = await Promise.all([
    sumarFacturacionARS(rng),
    sumarFacturacionARS(prev),
    // Misma fuente que el card del dashboard (`getSaldosBancarios`: cuentas
    // activas 1.1.1.01/02, saldo en moneda nativa) para que el KPI del BI
    // reconcilie con el dashboard. Excluye 1.1.1.03 (cheques), 1.1.2.*
    // (inversiones) y cuentas inactivas, a diferencia del agregado anterior.
    getSaldosBancarios(),
    db.lineaAsiento.aggregate({
      where: {
        asiento: {
          estado: AsientoEstado.CONTABILIZADO,
          fecha: dateWhere(rng),
        },
        cuenta: {
          tipo: CuentaTipo.ANALITICA,
          categoria: { in: [CuentaCategoria.INGRESO, CuentaCategoria.EGRESO] },
        },
      },
      _sum: { debe: true, haber: true },
    }),
    db.stockPorDeposito.findMany({
      select: { cantidadFisica: true, costoPromedio: true },
    }),
    // CxC: saldo deudor cuentas 1.1.3.* (créditos por ventas)
    db.lineaAsiento.aggregate({
      where: {
        asiento: { estado: AsientoEstado.CONTABILIZADO },
        cuenta: {
          tipo: CuentaTipo.ANALITICA,
          codigo: { startsWith: "1.1.3." },
        },
      },
      _sum: { debe: true, haber: true },
    }),
    // CxP: pasivo (cuentas 2.x.*)
    db.lineaAsiento.aggregate({
      where: {
        asiento: { estado: AsientoEstado.CONTABILIZADO },
        cuenta: {
          tipo: CuentaTipo.ANALITICA,
          categoria: CuentaCategoria.PASIVO,
        },
      },
      _sum: { debe: true, haber: true },
    }),
    db.embarque.count({
      where: { estado: { notIn: [EmbarqueEstado.CERRADO, EmbarqueEstado.DESPACHADO] } },
    }),
    db.venta.findMany({
      where: {
        estado: VentaEstado.EMITIDA,
        fecha: {
          gte: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 11, 1)),
        },
      },
      select: { fecha: true, total: true, moneda: true, tipoCambio: true },
    }),
    db.lineaAsiento.findMany({
      where: {
        asiento: {
          estado: AsientoEstado.CONTABILIZADO,
          fecha: {
            gte: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 11, 1)),
          },
        },
        cuenta: { categoria: { in: [CuentaCategoria.INGRESO, CuentaCategoria.EGRESO] } },
      },
      select: {
        debe: true,
        haber: true,
        asiento: { select: { fecha: true } },
        cuenta: { select: { categoria: true } },
      },
    }),
    db.$queryRaw<{ id: string; descuadrados: bigint }[]>`
      SELECT '1' as id, COUNT(*)::bigint AS descuadrados
      FROM "Asiento"
      WHERE estado = 'CONTABILIZADO' AND "totalDebe" <> "totalHaber"
    `,
  ]);

  // Descompone el saldo del card por moneda nativa (ARS/USD). La presentación
  // convierte cada parte native-aware al TC de cierre; el USD es invariante.
  const bancos = saldosBancarios.reduce(
    (acc, s) => {
      if (s.moneda === Moneda.USD) acc.usd = acc.usd.plus(s.saldo);
      else acc.ars = acc.ars.plus(s.saldo);
      return acc;
    },
    { ars: new Decimal(0), usd: new Decimal(0) },
  );
  const totalIngresos = toDecimal(resultado._sum.haber ?? 0).minus(
    toDecimal(resultado._sum.debe ?? 0),
  );
  // Para Ingreso: haber - debe. Para Egreso: debe - haber. Como agrupamos los dos,
  // resultado neto = ingresos_neto - egresos_neto, pero la suma directa lo da:
  // signo ingreso (haber-debe) + signo egreso (debe-haber) negado.
  // Mejor calcular separado:
  const [ingresosAgg, egresosAgg] = await Promise.all([
    db.lineaAsiento.aggregate({
      where: {
        asiento: { estado: AsientoEstado.CONTABILIZADO, fecha: dateWhere(rng) },
        cuenta: { tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.INGRESO },
      },
      _sum: { debe: true, haber: true },
    }),
    db.lineaAsiento.aggregate({
      where: {
        asiento: { estado: AsientoEstado.CONTABILIZADO, fecha: dateWhere(rng) },
        cuenta: { tipo: CuentaTipo.ANALITICA, categoria: CuentaCategoria.EGRESO },
      },
      _sum: { debe: true, haber: true },
    }),
  ]);
  const ingresosNeto = toDecimal(ingresosAgg._sum.haber ?? 0).minus(
    toDecimal(ingresosAgg._sum.debe ?? 0),
  );
  const egresosNeto = toDecimal(egresosAgg._sum.debe ?? 0).minus(
    toDecimal(egresosAgg._sum.haber ?? 0),
  );
  const resultadoNeto = ingresosNeto.minus(egresosNeto);

  const stockValorado = stockSnap.reduce(
    (acc, s) => acc.plus(toDecimal(s.costoPromedio).times(s.cantidadFisica)),
    new Decimal(0),
  );

  const cxcSaldo = toDecimal(cxc._sum.debe ?? 0).minus(toDecimal(cxc._sum.haber ?? 0));
  const cxpSaldo = toDecimal(cxp._sum.haber ?? 0).minus(toDecimal(cxp._sum.debe ?? 0));

  // Serie 12 meses facturación + resultado
  const meses = lastNMonths(12);
  const factPorMes = new Map<string, Decimal>();
  for (const m of meses) factPorMes.set(m.key, new Decimal(0));
  for (const v of facturacion12m) {
    const k = monthKey(v.fecha);
    const total = toDecimal(v.total);
    const ars = v.moneda === Moneda.USD ? total.times(toDecimal(v.tipoCambio)) : total;
    factPorMes.set(k, (factPorMes.get(k) ?? new Decimal(0)).plus(ars));
  }
  const resultadoPorMes = new Map<string, Decimal>();
  for (const m of meses) resultadoPorMes.set(m.key, new Decimal(0));
  for (const l of resultado12m) {
    const k = monthKey(l.asiento.fecha);
    const debe = toDecimal(l.debe);
    const haber = toDecimal(l.haber);
    const cur = resultadoPorMes.get(k) ?? new Decimal(0);
    if (l.cuenta.categoria === CuentaCategoria.INGRESO) {
      resultadoPorMes.set(k, cur.plus(haber).minus(debe));
    } else {
      resultadoPorMes.set(k, cur.minus(debe).plus(haber));
    }
  }

  // Alertas
  const alertas: ResumenEjecutivo["alertas"] = [];
  const descuadrados = Number(alertasRaw[0]?.descuadrados ?? 0);
  if (descuadrados > 0) {
    alertas.push({
      id: "asientos-descuadrados",
      nivel: "critical",
      titulo: "Asientos descuadrados",
      detalle: `${descuadrados} asiento(s) con totalDebe ≠ totalHaber.`,
    });
  }
  const [stockCritico, chequesRechazados] = await Promise.all([
    db.stockPorDeposito.count({
      where: {
        producto: { stockMinimo: { gt: 0 } },
        cantidadFisica: { lt: 1 },
      },
    }),
    db.chequeRecibido.count({
      where: {
        estado: ChequeRecibidoEstado.RECHAZADO,
        updatedAt: { gte: new Date(Date.now() - 30 * 86_400_000) },
      },
    }),
  ]);
  if (stockCritico > 0) {
    alertas.push({
      id: "stock-critico",
      nivel: "warning",
      titulo: "Stock crítico",
      detalle: `${stockCritico} SKU(s) sin stock físico con mínimo definido.`,
    });
  }
  if (chequesRechazados > 0) {
    alertas.push({
      id: "cheques-rechazados",
      nivel: "warning",
      titulo: "Cheques rechazados (30d)",
      detalle: `${chequesRechazados} cheque(s) rechazado(s) en los últimos 30 días.`,
    });
  }

  return {
    kpis: {
      facturacionPeriodo: num(factPeriodo.total),
      facturacionAnterior: num(factPrevio.total),
      facturacionDelta: pct(num(factPeriodo.total), num(factPrevio.total)),
      margenBruto: num(factPeriodo.total.minus(cmv)),
      margenBrutoPct: factPeriodo.total.gt(0)
        ? Number(factPeriodo.total.minus(cmv).div(factPeriodo.total).toFixed(4))
        : 0,
      resultadoEjercicio: num(resultadoNeto),
      saldoBancosCaja: { ars: num(bancos.ars), usd: num(bancos.usd) },
      stockValorado: num(stockValorado),
      cxc: num(cxcSaldo),
      cxp: num(cxpSaldo),
      embarquesActivos,
    },
    facturacionResultado12m: meses.map((m) => ({
      label: m.label,
      facturacion: num(factPorMes.get(m.key) ?? 0),
      resultado: num(resultadoPorMes.get(m.key) ?? 0),
    })),
    alertas,
  };
}

// =====================================================================
// 2. VENTAS
// =====================================================================

const CANAL_LABEL: Record<TipoCanal, string> = {
  MAYORISTA: "Mayorista",
  MINORISTA: "Minorista",
  REVENDEDOR_GOMERIA: "Gomería / Revendedor",
  TRANSPORTISTA: "Transportista",
  GRANDE_CUENTA: "Grande cuenta",
  EXTERIOR: "Exterior",
  CONSUMIDOR_FINAL: "Consumidor final",
};

export type AnalisisVentas = {
  kpis: {
    facturacion: Money;
    facturas: number;
    ticketPromedio: Money;
    delta: number;
  };
  facturacionMensal: MoneySerie[];
  topClientes: RankingRow[];
  topProductosUnidades: RankingRow[];
  topProductosFacturacion: RankingRow[];
  porCanal: RankingRow[];
  porProvincia: RankingRow[];
  porMarca: RankingRow[];
  porMedida: RankingRow[];
  pedidosPorEstado: { estado: PedidoEstado; cantidad: number }[];
};

export async function getAnalisisVentas(rng: DateRange): Promise<AnalisisVentas> {
  const prev = previousRange(rng);

  const [periodo, anterior, ventas12m, pedidosEstados] = await Promise.all([
    sumarFacturacionARS(rng),
    sumarFacturacionARS(prev),
    db.venta.findMany({
      where: {
        estado: VentaEstado.EMITIDA,
        fecha: {
          gte: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 11, 1)),
        },
      },
      select: { fecha: true, total: true, moneda: true, tipoCambio: true },
    }),
    db.pedidoVenta.groupBy({
      by: ["estado"],
      _count: { _all: true },
    }),
  ]);

  // Series 12m
  const meses = lastNMonths(12);
  const factPorMes = new Map<string, Decimal>();
  for (const m of meses) factPorMes.set(m.key, new Decimal(0));
  for (const v of ventas12m) {
    const k = monthKey(v.fecha);
    const total = toDecimal(v.total);
    const ars = v.moneda === Moneda.USD ? total.times(toDecimal(v.tipoCambio)) : total;
    factPorMes.set(k, (factPorMes.get(k) ?? new Decimal(0)).plus(ars));
  }

  // Ventas del rango con detalles para corte dimensional
  const ventasRng = await db.venta.findMany({
    where: { estado: VentaEstado.EMITIDA, fecha: dateWhere(rng) },
    select: {
      total: true,
      moneda: true,
      tipoCambio: true,
      cliente: {
        select: {
          id: true,
          nombre: true,
          tipoCanal: true,
          provincia: { select: { nombre: true } },
        },
      },
      items: {
        select: {
          cantidad: true,
          subtotal: true,
          producto: { select: { id: true, nombre: true, marca: true, medida: true } },
        },
      },
    },
  });

  const porCliente = new Map<string, { label: string; v: Decimal }>();
  const porProductoUnidades = new Map<string, { label: string; v: Decimal }>();
  const porProductoFact = new Map<string, { label: string; v: Decimal }>();
  const porCanal = new Map<TipoCanal, Decimal>();
  const porProvincia = new Map<string, Decimal>();
  const porMarca = new Map<string, Decimal>();
  const porMedida = new Map<string, Decimal>();

  for (const v of ventasRng) {
    const tc = toDecimal(v.tipoCambio);
    const total = toDecimal(v.total);
    const totalArs = v.moneda === Moneda.USD ? total.times(tc) : total;

    // por cliente
    const c = v.cliente;
    const curC = porCliente.get(c.id) ?? { label: c.nombre, v: new Decimal(0) };
    porCliente.set(c.id, { label: c.nombre, v: curC.v.plus(totalArs) });
    // por canal
    porCanal.set(c.tipoCanal, (porCanal.get(c.tipoCanal) ?? new Decimal(0)).plus(totalArs));
    // por provincia
    if (c.provincia) {
      porProvincia.set(
        c.provincia.nombre,
        (porProvincia.get(c.provincia.nombre) ?? new Decimal(0)).plus(totalArs),
      );
    }
    // por producto / marca / medida (a partir de items)
    for (const it of v.items) {
      const p = it.producto;
      const subAr =
        v.moneda === Moneda.USD ? toDecimal(it.subtotal).times(tc) : toDecimal(it.subtotal);
      const curU = porProductoUnidades.get(p.id) ?? { label: p.nombre, v: new Decimal(0) };
      porProductoUnidades.set(p.id, { label: p.nombre, v: curU.v.plus(it.cantidad) });
      const curF = porProductoFact.get(p.id) ?? { label: p.nombre, v: new Decimal(0) };
      porProductoFact.set(p.id, { label: p.nombre, v: curF.v.plus(subAr) });
      if (p.marca) porMarca.set(p.marca, (porMarca.get(p.marca) ?? new Decimal(0)).plus(subAr));
      if (p.medida)
        porMedida.set(p.medida, (porMedida.get(p.medida) ?? new Decimal(0)).plus(subAr));
    }
  }

  const top = <T extends { v: Decimal }>(map: Map<string, T & { label: string }>, n = 10) =>
    Array.from(map.values())
      .sort((a, b) => b.v.cmp(a.v))
      .slice(0, n)
      .map((r) => ({ label: r.label, value: num(r.v) }));

  return {
    kpis: {
      facturacion: num(periodo.total),
      facturas: periodo.count,
      ticketPromedio: periodo.count > 0 ? num(periodo.total.div(periodo.count)) : 0,
      delta: pct(num(periodo.total), num(anterior.total)),
    },
    facturacionMensal: meses.map((m) => ({
      label: m.label,
      value: num(factPorMes.get(m.key) ?? 0),
    })),
    topClientes: top(porCliente),
    topProductosUnidades: Array.from(porProductoUnidades.values())
      .sort((a, b) => b.v.cmp(a.v))
      .slice(0, 10)
      .map((r) => ({ label: r.label, value: Number(r.v.toFixed(0)) })),
    topProductosFacturacion: top(porProductoFact),
    porCanal: Array.from(porCanal.entries())
      .sort((a, b) => b[1].cmp(a[1]))
      .map(([k, v]) => ({ label: CANAL_LABEL[k], value: num(v) })),
    porProvincia: Array.from(porProvincia.entries())
      .sort((a, b) => b[1].cmp(a[1]))
      .slice(0, 10)
      .map(([k, v]) => ({ label: k, value: num(v) })),
    porMarca: Array.from(porMarca.entries())
      .sort((a, b) => b[1].cmp(a[1]))
      .slice(0, 10)
      .map(([k, v]) => ({ label: k, value: num(v) })),
    porMedida: Array.from(porMedida.entries())
      .sort((a, b) => b[1].cmp(a[1]))
      .slice(0, 10)
      .map(([k, v]) => ({ label: k, value: num(v) })),
    pedidosPorEstado: pedidosEstados.map((p) => ({
      estado: p.estado,
      cantidad: p._count._all,
    })),
  };
}

// =====================================================================
// 3. COMPRAS & IMPORTACIÓN
// =====================================================================

const TIPO_COSTO_LABEL: Record<TipoCostoEmbarque, string> = {
  FLETE_INTERNACIONAL: "Flete intl.",
  FLETE_NACIONAL: "Flete nac.",
  SEGURO_MARITIMO: "Seguro",
  GASTOS_PORTUARIOS: "Gtos. portuarios",
  HONORARIOS_DESPACHANTE: "Despachante",
  OPERADOR_LOGISTICO: "Operador logístico",
  ALMACENAJE: "Almacenaje",
  DEVOLUCION_CONTENEDOR: "Dev. contenedor",
  AGENTE_DE_CARGAS: "Agente de cargas",
  GASTOS_LOCALES: "Gtos. locales",
  GASTOS_EXTRAS: "Gtos. extras",
};

export type AnalisisCompras = {
  kpis: {
    importadoUsd: Money;
    costoNacionalizadoPct: number;
    cicloPromedioDias: number;
    embarquesActivos: number;
  };
  embarquesPorEstado: { estado: EmbarqueEstado; cantidad: number }[];
  importacionUsdMensal: MoneySerie[];
  topProveedoresExterior: RankingRow[];
  distribucionCostos: RankingRow[];
  tributosPorEmbarque: {
    label: string;
    die: number;
    arancel: number;
    iva: number;
    ivaAdicional: number;
    ganancias: number;
    iibb: number;
  }[];
  pedidosCompraPorEstado: { estado: PedidoEstado; cantidad: number }[];
  embarquesEnTransito: {
    codigo: string;
    proveedor: string;
    estado: EmbarqueEstado;
    fechaLlegada: Date | null;
  }[];
  despachosSinContabilizar: { codigo: string; embarque: string; fecha: Date }[];
};

export async function getAnalisisCompras(rng: DateRange): Promise<AnalisisCompras> {
  const [
    estadosCount,
    embarques12m,
    embarquesRng,
    pedidosCount,
    enTransito,
    despachosBorrador,
    activos,
  ] = await Promise.all([
    db.embarque.groupBy({ by: ["estado"], _count: { _all: true } }),
    db.embarque.findMany({
      where: {
        createdAt: {
          gte: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 11, 1)),
        },
      },
      select: { createdAt: true, fobTotal: true },
    }),
    db.embarque.findMany({
      where: { createdAt: dateWhere(rng) },
      select: {
        id: true,
        codigo: true,
        fobTotal: true,
        cifTotal: true,
        die: true,
        tasaEstadistica: true,
        arancelSim: true,
        iva: true,
        ivaAdicional: true,
        ganancias: true,
        iibb: true,
        costoTotal: true,
        fechaEmpaque: true,
        fechaCierre: true,
        proveedor: { select: { nombre: true } },
        costos: {
          where: { estado: { not: "ANULADA" } },
          select: {
            lineas: { select: { tipo: true, subtotal: true } },
          },
        },
      },
    }),
    db.pedidoCompra.groupBy({ by: ["estado"], _count: { _all: true } }),
    db.embarque.findMany({
      where: {
        estado: {
          in: [
            EmbarqueEstado.EN_TRANSITO,
            EmbarqueEstado.EN_PUERTO,
            EmbarqueEstado.EN_ZONA_PRIMARIA,
            EmbarqueEstado.EN_ADUANA,
          ],
        },
      },
      orderBy: { fechaLlegada: "asc" },
      take: 15,
      select: {
        codigo: true,
        estado: true,
        fechaLlegada: true,
        proveedor: { select: { nombre: true } },
      },
    }),
    db.despacho.findMany({
      where: { estado: DespachoEstado.BORRADOR },
      orderBy: { fecha: "desc" },
      take: 15,
      select: {
        codigo: true,
        fecha: true,
        embarque: { select: { codigo: true } },
      },
    }),
    db.embarque.count({
      where: { estado: { notIn: [EmbarqueEstado.CERRADO, EmbarqueEstado.DESPACHADO] } },
    }),
  ]);

  // KPIs
  let importadoUsd = new Decimal(0);
  let costoTotal = new Decimal(0);
  let fobTotal = new Decimal(0);
  let cicloDiasSum = 0;
  let cicloDiasCount = 0;
  const porProveedor = new Map<string, Decimal>();
  const tributosPorEmbarque: AnalisisCompras["tributosPorEmbarque"] = [];
  const porTipoCosto = new Map<TipoCostoEmbarque, Decimal>();

  for (const e of embarquesRng) {
    const fob = toDecimal(e.fobTotal);
    fobTotal = fobTotal.plus(fob);
    importadoUsd = importadoUsd.plus(fob);
    costoTotal = costoTotal.plus(toDecimal(e.costoTotal));
    porProveedor.set(
      e.proveedor.nombre,
      (porProveedor.get(e.proveedor.nombre) ?? new Decimal(0)).plus(fob),
    );
    if (e.fechaEmpaque && e.fechaCierre) {
      const dias = Math.round((e.fechaCierre.getTime() - e.fechaEmpaque.getTime()) / 86_400_000);
      if (dias >= 0 && dias < 365) {
        cicloDiasSum += dias;
        cicloDiasCount += 1;
      }
    }
    tributosPorEmbarque.push({
      label: e.codigo,
      die: num(e.die),
      arancel: num(e.arancelSim),
      iva: num(e.iva),
      ivaAdicional: num(e.ivaAdicional),
      ganancias: num(e.ganancias),
      iibb: num(e.iibb),
    });
    for (const c of e.costos) {
      for (const l of c.lineas) {
        porTipoCosto.set(
          l.tipo,
          (porTipoCosto.get(l.tipo) ?? new Decimal(0)).plus(toDecimal(l.subtotal)),
        );
      }
    }
  }

  // Importación USD 12m
  const meses = lastNMonths(12);
  const impPorMes = new Map<string, Decimal>();
  for (const m of meses) impPorMes.set(m.key, new Decimal(0));
  for (const e of embarques12m) {
    const k = monthKey(e.createdAt);
    impPorMes.set(k, (impPorMes.get(k) ?? new Decimal(0)).plus(toDecimal(e.fobTotal)));
  }

  return {
    kpis: {
      importadoUsd: num(importadoUsd),
      costoNacionalizadoPct: fobTotal.gt(0) ? Number(costoTotal.div(fobTotal).toFixed(4)) : 0,
      cicloPromedioDias: cicloDiasCount > 0 ? Math.round(cicloDiasSum / cicloDiasCount) : 0,
      embarquesActivos: activos,
    },
    embarquesPorEstado: estadosCount.map((r) => ({ estado: r.estado, cantidad: r._count._all })),
    importacionUsdMensal: meses.map((m) => ({
      label: m.label,
      value: num(impPorMes.get(m.key) ?? 0),
    })),
    topProveedoresExterior: Array.from(porProveedor.entries())
      .sort((a, b) => b[1].cmp(a[1]))
      .slice(0, 10)
      .map(([k, v]) => ({ label: k, value: num(v) })),
    distribucionCostos: Array.from(porTipoCosto.entries())
      .sort((a, b) => b[1].cmp(a[1]))
      .map(([k, v]) => ({ label: TIPO_COSTO_LABEL[k], value: num(v) })),
    tributosPorEmbarque: tributosPorEmbarque.slice(-12),
    pedidosCompraPorEstado: pedidosCount.map((r) => ({
      estado: r.estado,
      cantidad: r._count._all,
    })),
    embarquesEnTransito: enTransito.map((e) => ({
      codigo: e.codigo,
      proveedor: e.proveedor.nombre,
      estado: e.estado,
      fechaLlegada: e.fechaLlegada,
    })),
    despachosSinContabilizar: despachosBorrador.map((d) => ({
      codigo: d.codigo,
      embarque: d.embarque.codigo,
      fecha: d.fecha,
    })),
  };
}

// =====================================================================
// 4. STOCK & LOGÍSTICA
// =====================================================================

export type AnalisisStock = {
  kpis: {
    valorado: Money;
    unidades: number;
    skusConStock: number;
    slowMovers: number;
  };
  porDeposito: RankingRow[];
  topProductosValor: RankingRow[];
  stockCritico: {
    producto: string;
    codigo: string;
    cantidad: number;
    minimo: number;
    deposito: string;
  }[];
  slowMovers: {
    producto: string;
    deposito: string;
    cantidad: number;
    valor: Money;
    diasSinMov: number;
  }[];
  disponibleVsReservado: { deposito: string; disponible: number; reservado: number }[];
  ultimasTransferencias: {
    numero: string;
    producto: string;
    origen: string;
    destino: string;
    cantidad: number;
    fecha: Date;
  }[];
};

export async function getAnalisisStock(): Promise<AnalisisStock> {
  const [stock, transferencias] = await Promise.all([
    db.stockPorDeposito.findMany({
      select: {
        cantidadFisica: true,
        cantidadReservada: true,
        costoPromedio: true,
        ultimoMovimiento: true,
        producto: {
          select: {
            id: true,
            codigo: true,
            nombre: true,
            stockMinimo: true,
            movimientosStock: {
              select: { tipo: true },
              where: { tipo: MovimientoStockTipo.INGRESO },
              take: 1,
            },
          },
        },
        deposito: { select: { id: true, nombre: true } },
      },
    }),
    db.transferencia.findMany({
      take: 20,
      orderBy: { fecha: "desc" },
      select: {
        numero: true,
        cantidad: true,
        fecha: true,
        producto: { select: { nombre: true } },
        origen: { select: { nombre: true } },
        destino: { select: { nombre: true } },
      },
    }),
  ]);

  let valorado = new Decimal(0);
  let unidades = 0;
  let skusConStock = 0;
  const porDeposito = new Map<string, Decimal>();
  const porProducto = new Map<string, { label: string; valor: Decimal }>();
  const porDepoAR = new Map<string, { disponible: number; reservado: number }>();
  const stockCritico: AnalisisStock["stockCritico"] = [];
  const slowMoversRaw: AnalisisStock["slowMovers"] = [];
  const noventaDiasAtras = new Date(Date.now() - 90 * 86_400_000);

  for (const s of stock) {
    const cant = s.cantidadFisica;

    // Filtro inteligente: excluir SKUs que não têm stock E nunca tiveram entrada
    const hadIngresoMovement =
      s.producto.movimientosStock && s.producto.movimientosStock.length > 0;
    if (cant === 0 && !hadIngresoMovement) {
      continue; // Skip SKUs nunca entrados
    }

    const valor = toDecimal(s.costoPromedio).times(cant);
    valorado = valorado.plus(valor);
    unidades += cant;
    if (cant > 0) skusConStock += 1;
    porDeposito.set(
      s.deposito.nombre,
      (porDeposito.get(s.deposito.nombre) ?? new Decimal(0)).plus(valor),
    );
    const cur = porProducto.get(s.producto.id) ?? {
      label: s.producto.nombre,
      valor: new Decimal(0),
    };
    porProducto.set(s.producto.id, { label: s.producto.nombre, valor: cur.valor.plus(valor) });

    const dpa = porDepoAR.get(s.deposito.nombre) ?? { disponible: 0, reservado: 0 };
    dpa.disponible += Math.max(cant - s.cantidadReservada, 0);
    dpa.reservado += s.cantidadReservada;
    porDepoAR.set(s.deposito.nombre, dpa);

    if (s.producto.stockMinimo > 0 && cant < s.producto.stockMinimo) {
      stockCritico.push({
        producto: s.producto.nombre,
        codigo: s.producto.codigo,
        cantidad: cant,
        minimo: s.producto.stockMinimo,
        deposito: s.deposito.nombre,
      });
    }
    if (cant > 0 && s.ultimoMovimiento < noventaDiasAtras) {
      const dias = Math.round((Date.now() - s.ultimoMovimiento.getTime()) / 86_400_000);
      slowMoversRaw.push({
        producto: s.producto.nombre,
        deposito: s.deposito.nombre,
        cantidad: cant,
        valor: num(valor),
        diasSinMov: dias,
      });
    }
  }

  slowMoversRaw.sort((a, b) => b.diasSinMov - a.diasSinMov);

  return {
    kpis: {
      valorado: num(valorado),
      unidades,
      skusConStock,
      slowMovers: slowMoversRaw.length,
    },
    porDeposito: Array.from(porDeposito.entries())
      .sort((a, b) => b[1].cmp(a[1]))
      .map(([k, v]) => ({ label: k, value: num(v) })),
    topProductosValor: Array.from(porProducto.values())
      .sort((a, b) => b.valor.cmp(a.valor))
      .slice(0, 10)
      .map((p) => ({ label: p.label, value: num(p.valor) })),
    stockCritico: stockCritico.slice(0, 20),
    slowMovers: slowMoversRaw.slice(0, 20),
    disponibleVsReservado: Array.from(porDepoAR.entries()).map(([k, v]) => ({
      deposito: k,
      disponible: v.disponible,
      reservado: v.reservado,
    })),
    ultimasTransferencias: transferencias.map((t) => ({
      numero: t.numero,
      producto: t.producto.nombre,
      origen: t.origen.nombre,
      destino: t.destino.nombre,
      cantidad: t.cantidad,
      fecha: t.fecha,
    })),
  };
}

// =====================================================================
// 4-bis. STOCK BONDED (depósito fiscal) — comex ZPA (PR 5.3)
// =====================================================================

export type AnalisisBonded = {
  kpis: {
    /** Σ cantidadDisponible × costoFCUnitario (FC del embarque, típicamente USD). */
    valorUsd: Money;
    unidadesDisponibles: number;
    skus: number;
    contenedores: number;
  };
  /** Días en depósito fiscal de los contenedores con saldo vivo (percentiles). */
  aging: { p50: number; p90: number; max: number };
  porSku: {
    codigo: string;
    producto: string;
    disponible: number;
    enDespacho: number;
    valorUsd: Money;
  }[];
  despachosAbiertos: { codigo: string; producto: string; unidades: number; valorUsd: Money }[];
};

// Estados en los que la mercadería está físicamente en depósito fiscal con
// saldo vivo posible (alineado con FASE_POR_ESTADO "EN_DF" de inventario).
const ESTADOS_DF_BONDED = [
  "EN_DEPOSITO_FISCAL",
  "AGUARDANDO_INVESTIGACAO",
  "DESCONSOLIDADO",
  "PARCIALMENTE_DESPACHADO",
] as const;

/** Percentil (método del rango más cercano, base 1) sobre un array ya ordenado asc. */
function percentil(ordenAsc: number[], p: number): number {
  if (ordenAsc.length === 0) return 0;
  const idx = Math.ceil((p / 100) * ordenAsc.length) - 1;
  return ordenAsc[Math.min(Math.max(idx, 0), ordenAsc.length - 1)] ?? 0;
}

/**
 * BI del stock bonded (depósito fiscal): valor USD inmovilizado, antigüedad
 * (aging) de los contenedores y despachos abiertos por SKU. Se basa en los
 * counters de ItemContenedor + costoFCUnitario + las fechas del ciclo aduanero
 * del Contenedor. Devuelve `null` con la flag de desconsolidación apagada
 * (la pestaña Stock no muestra la sección). Detrás de la flag (PR 5.3).
 */
export async function getAnalisisBonded(): Promise<AnalisisBonded | null> {
  if (!isContenedorDesconsolidacionEnabled()) return null;

  const items = await db.itemContenedor.findMany({
    where: {
      contenedor: { estado: { in: [...ESTADOS_DF_BONDED] } },
      OR: [{ cantidadDisponible: { gt: 0 } }, { cantidadEnDespacho: { gt: 0 } }],
    },
    select: {
      cantidadDisponible: true,
      cantidadEnDespacho: true,
      costoFCUnitario: true,
      producto: { select: { codigo: true, nombre: true } },
      contenedor: {
        select: {
          id: true,
          fechaDesconsolidacion: true,
          fechaTrasladoDF: true,
          fechaIngresoZpa: true,
          createdAt: true,
        },
      },
    },
  });

  const ahora = Date.now();
  let valorUsd = new Decimal(0);
  let unidadesDisponibles = 0;
  const skus = new Set<string>();
  const agingPorContenedor = new Map<string, number>();
  const porSku = new Map<
    string,
    { codigo: string; producto: string; disponible: number; enDespacho: number; valor: Decimal }
  >();
  const despachos = new Map<
    string,
    { codigo: string; producto: string; unidades: number; valor: Decimal }
  >();

  for (const it of items) {
    const fc = toDecimal(it.costoFCUnitario ?? 0);
    const valorLinea = fc.times(it.cantidadDisponible);
    valorUsd = valorUsd.plus(valorLinea);
    unidadesDisponibles += it.cantidadDisponible;
    if (it.cantidadDisponible > 0) skus.add(it.producto.codigo);

    if (!agingPorContenedor.has(it.contenedor.id)) {
      const ref =
        it.contenedor.fechaDesconsolidacion ??
        it.contenedor.fechaTrasladoDF ??
        it.contenedor.fechaIngresoZpa ??
        it.contenedor.createdAt;
      agingPorContenedor.set(
        it.contenedor.id,
        Math.max(Math.floor((ahora - ref.getTime()) / 86_400_000), 0),
      );
    }

    const sku = porSku.get(it.producto.codigo) ?? {
      codigo: it.producto.codigo,
      producto: it.producto.nombre,
      disponible: 0,
      enDespacho: 0,
      valor: new Decimal(0),
    };
    sku.disponible += it.cantidadDisponible;
    sku.enDespacho += it.cantidadEnDespacho;
    sku.valor = sku.valor.plus(valorLinea);
    porSku.set(it.producto.codigo, sku);

    if (it.cantidadEnDespacho > 0) {
      const d = despachos.get(it.producto.codigo) ?? {
        codigo: it.producto.codigo,
        producto: it.producto.nombre,
        unidades: 0,
        valor: new Decimal(0),
      };
      d.unidades += it.cantidadEnDespacho;
      d.valor = d.valor.plus(fc.times(it.cantidadEnDespacho));
      despachos.set(it.producto.codigo, d);
    }
  }

  const edades = [...agingPorContenedor.values()].sort((a, b) => a - b);

  return {
    kpis: {
      valorUsd: num(valorUsd),
      unidadesDisponibles,
      skus: skus.size,
      contenedores: agingPorContenedor.size,
    },
    aging: {
      p50: percentil(edades, 50),
      p90: percentil(edades, 90),
      max: edades.at(-1) ?? 0,
    },
    porSku: [...porSku.values()]
      .sort((a, b) => b.valor.cmp(a.valor))
      .slice(0, 20)
      .map((s) => ({
        codigo: s.codigo,
        producto: s.producto,
        disponible: s.disponible,
        enDespacho: s.enDespacho,
        valorUsd: num(s.valor),
      })),
    despachosAbiertos: [...despachos.values()]
      .sort((a, b) => b.unidades - a.unidades)
      .map((d) => ({
        codigo: d.codigo,
        producto: d.producto,
        unidades: d.unidades,
        valorUsd: num(d.valor),
      })),
  };
}

// =====================================================================
// 5. TESORERÍA & CxC / CxP
// =====================================================================

export type AnalisisTesoreria = {
  kpis: {
    bancosCaja: Money;
    cxc: Money;
    cxp: Money;
    chequesCartera: Money;
  };
  saldosPorBanco: { banco: string; moneda: Moneda; saldo: Money }[];
  chequesPorEstado: { estado: ChequeRecibidoEstado; cantidad: number; importe: Money }[];
  agingCxc: { rango: string; importe: Money }[];
  agingCxp: { rango: string; importe: Money }[];
  topDeudores: RankingRow[];
  topAcreedores: RankingRow[];
  chequesProximos: { semana: string; cantidad: number; importe: Money }[];
  pagosPeriodoPorBanco: RankingRow[];
};

const AGING_RANGES = [
  { label: "0-30 días", min: 0, max: 30 },
  { label: "30-60 días", min: 31, max: 60 },
  { label: "60-90 días", min: 61, max: 90 },
  { label: "90+ días", min: 91, max: Number.POSITIVE_INFINITY },
];

export async function getAnalisisTesoreria(rng: DateRange): Promise<AnalisisTesoreria> {
  const ahora = new Date();
  const [cuentasBanco, chequesAll, ventasAbiertas, comprasAbiertas, movimientosRng] =
    await Promise.all([
      db.cuentaBancaria.findMany({
        select: {
          banco: true,
          moneda: true,
          cuentaContableId: true,
        },
      }),
      db.chequeRecibido.findMany({
        where: {
          estado: {
            in: [
              ChequeRecibidoEstado.EN_CARTERA,
              ChequeRecibidoEstado.DEPOSITADO,
              ChequeRecibidoEstado.ACREDITADO,
              ChequeRecibidoEstado.RECHAZADO,
            ],
          },
        },
        select: { estado: true, importe: true, fechaPago: true },
      }),
      db.venta.findMany({
        where: { estado: VentaEstado.EMITIDA },
        select: {
          total: true,
          moneda: true,
          tipoCambio: true,
          fecha: true,
          fechaVencimiento: true,
          cliente: { select: { id: true, nombre: true, cuentaContableId: true } },
        },
      }),
      db.compra.findMany({
        where: { estado: { in: [CompraEstado.EMITIDA, CompraEstado.RECIBIDA] } },
        select: {
          total: true,
          moneda: true,
          tipoCambio: true,
          fecha: true,
          fechaVencimiento: true,
          proveedor: { select: { id: true, nombre: true } },
        },
      }),
      db.movimientoTesoreria.findMany({
        where: {
          tipo: "PAGO",
          fecha: dateWhere(rng),
        },
        select: {
          monto: true,
          moneda: true,
          tipoCambio: true,
          cuentaBancaria: { select: { banco: true } },
        },
      }),
    ]);

  // Saldos bancarios — en la moneda de cada cuenta (USD vía metadata de línea).
  const porCuenta = new Map(cuentasBanco.map((c) => [c.cuentaContableId, c.moneda]));
  const saldoPorCuenta = await calcularSaldosCuentasBancariasEnMonedaCuenta(
    Array.from(porCuenta, ([cuentaContableId, moneda]) => ({ cuentaContableId, moneda })),
  );
  const saldosPorBanco = cuentasBanco.map((c) => ({
    banco: c.banco,
    moneda: c.moneda,
    saldo: num(saldoPorCuenta.get(c.cuentaContableId) ?? 0),
  }));

  const bancosCajaTotal = saldosPorBanco.reduce((acc, s) => acc + s.saldo, 0);

  // Aging CxC / CxP basado en fechaVencimiento (default 30 días si null).
  function diasAtraso(fechaEmision: Date, fechaVenc: Date | null) {
    const venc = fechaVenc ?? new Date(fechaEmision.getTime() + 30 * 86_400_000);
    return Math.round((ahora.getTime() - venc.getTime()) / 86_400_000);
  }
  function rangoLabel(d: number) {
    if (d <= 0) return "0-30 días";
    return AGING_RANGES.find((r) => d >= r.min && d <= r.max)?.label ?? "0-30 días";
  }

  const agingCxc = new Map(AGING_RANGES.map((r) => [r.label, new Decimal(0)]));
  const porCliente = new Map<string, { label: string; v: Decimal }>();
  let cxcTotal = new Decimal(0);
  for (const v of ventasAbiertas) {
    const tc = toDecimal(v.tipoCambio);
    const ars = v.moneda === Moneda.USD ? toDecimal(v.total).times(tc) : toDecimal(v.total);
    cxcTotal = cxcTotal.plus(ars);
    const lbl = rangoLabel(diasAtraso(v.fecha, v.fechaVencimiento));
    agingCxc.set(lbl, (agingCxc.get(lbl) ?? new Decimal(0)).plus(ars));
    const cur = porCliente.get(v.cliente.id) ?? { label: v.cliente.nombre, v: new Decimal(0) };
    porCliente.set(v.cliente.id, { label: v.cliente.nombre, v: cur.v.plus(ars) });
  }

  const agingCxp = new Map(AGING_RANGES.map((r) => [r.label, new Decimal(0)]));
  const porProveedor = new Map<string, { label: string; v: Decimal }>();
  let cxpTotal = new Decimal(0);
  for (const c of comprasAbiertas) {
    const tc = toDecimal(c.tipoCambio);
    const ars = c.moneda === Moneda.USD ? toDecimal(c.total).times(tc) : toDecimal(c.total);
    cxpTotal = cxpTotal.plus(ars);
    const lbl = rangoLabel(diasAtraso(c.fecha, c.fechaVencimiento));
    agingCxp.set(lbl, (agingCxp.get(lbl) ?? new Decimal(0)).plus(ars));
    const cur = porProveedor.get(c.proveedor.id) ?? {
      label: c.proveedor.nombre,
      v: new Decimal(0),
    };
    porProveedor.set(c.proveedor.id, { label: c.proveedor.nombre, v: cur.v.plus(ars) });
  }

  // Cheques
  const chequesPorEstado = new Map<ChequeRecibidoEstado, { cantidad: number; importe: Decimal }>();
  let chequesCartera = new Decimal(0);
  // Próximos 60 días por semana
  const finVentana = new Date(ahora.getTime() + 60 * 86_400_000);
  const chequesProximos = new Map<string, { cantidad: number; importe: Decimal }>();
  for (const ch of chequesAll) {
    const importe = toDecimal(ch.importe);
    const cur = chequesPorEstado.get(ch.estado) ?? { cantidad: 0, importe: new Decimal(0) };
    chequesPorEstado.set(ch.estado, {
      cantidad: cur.cantidad + 1,
      importe: cur.importe.plus(importe),
    });
    if (ch.estado === ChequeRecibidoEstado.EN_CARTERA) {
      chequesCartera = chequesCartera.plus(importe);
    }
    if (
      ch.fechaPago >= ahora &&
      ch.fechaPago <= finVentana &&
      ch.estado === ChequeRecibidoEstado.EN_CARTERA
    ) {
      // Semana del año
      const wkStart = new Date(ch.fechaPago);
      const day = wkStart.getUTCDay();
      const diff = wkStart.getUTCDate() - day + (day === 0 ? -6 : 1);
      wkStart.setUTCDate(diff);
      const k = `${wkStart.getUTCFullYear()}-${String(wkStart.getUTCMonth() + 1).padStart(2, "0")}-${String(wkStart.getUTCDate()).padStart(2, "0")}`;
      const cw = chequesProximos.get(k) ?? { cantidad: 0, importe: new Decimal(0) };
      chequesProximos.set(k, { cantidad: cw.cantidad + 1, importe: cw.importe.plus(importe) });
    }
  }

  // Pagos del rango por banco
  const pagosBanco = new Map<string, Decimal>();
  for (const mv of movimientosRng) {
    const monto = toDecimal(mv.monto);
    const ars = mv.moneda === Moneda.USD ? monto.times(toDecimal(mv.tipoCambio)) : monto;
    pagosBanco.set(
      mv.cuentaBancaria.banco,
      (pagosBanco.get(mv.cuentaBancaria.banco) ?? new Decimal(0)).plus(ars),
    );
  }

  return {
    kpis: {
      bancosCaja: bancosCajaTotal,
      cxc: num(cxcTotal),
      cxp: num(cxpTotal),
      chequesCartera: num(chequesCartera),
    },
    saldosPorBanco: saldosPorBanco.sort((a, b) => Math.abs(b.saldo) - Math.abs(a.saldo)),
    chequesPorEstado: Array.from(chequesPorEstado.entries()).map(([k, v]) => ({
      estado: k,
      cantidad: v.cantidad,
      importe: num(v.importe),
    })),
    agingCxc: Array.from(agingCxc.entries()).map(([rango, v]) => ({ rango, importe: num(v) })),
    agingCxp: Array.from(agingCxp.entries()).map(([rango, v]) => ({ rango, importe: num(v) })),
    topDeudores: Array.from(porCliente.values())
      .sort((a, b) => b.v.cmp(a.v))
      .slice(0, 10)
      .map((r) => ({ label: r.label, value: num(r.v) })),
    topAcreedores: Array.from(porProveedor.values())
      .sort((a, b) => b.v.cmp(a.v))
      .slice(0, 10)
      .map((r) => ({ label: r.label, value: num(r.v) })),
    chequesProximos: Array.from(chequesProximos.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, v]) => ({ semana: k, cantidad: v.cantidad, importe: num(v.importe) })),
    pagosPeriodoPorBanco: Array.from(pagosBanco.entries())
      .sort((a, b) => b[1].cmp(a[1]))
      .map(([k, v]) => ({ label: k, value: num(v) })),
  };
}

// =====================================================================
// 6. RENTABILIDAD
// =====================================================================

export type AnalisisRentabilidad = {
  kpis: {
    margenBruto: Money;
    margenBrutoPct: number;
    margenNetoPct: number;
    productoTop: string | null;
    productoBottom: string | null;
  };
  margenPorCanal: RankingRow[];
  margenPorMarca: RankingRow[];
  precioVsCosto: { producto: string; precio: Money; costo: Money }[];
  margenBrutoMensal: MoneySerie[];
  topProductosMargen: { producto: string; margen: Money; pct: number }[];
  vendidosBajoCosto: { producto: string; precio: Money; costo: Money }[];
};

export async function getAnalisisRentabilidad(rng: DateRange): Promise<AnalisisRentabilidad> {
  const [ventas, productos] = await Promise.all([
    db.venta.findMany({
      where: { estado: VentaEstado.EMITIDA, fecha: dateWhere(rng) },
      select: {
        total: true,
        subtotal: true,
        moneda: true,
        tipoCambio: true,
        cliente: { select: { tipoCanal: true } },
        items: {
          select: {
            cantidad: true,
            subtotal: true,
            precioUnitario: true,
            producto: {
              select: {
                id: true,
                nombre: true,
                marca: true,
                costoPromedio: true,
                precioVenta: true,
              },
            },
          },
        },
      },
    }),
    db.producto.findMany({
      where: { activo: true },
      select: {
        id: true,
        nombre: true,
        precioVenta: true,
        costoPromedio: true,
      },
      take: 200,
    }),
  ]);

  // Margen por canal y por marca (sobre items vendidos en el rango)
  const margenCanal = new Map<TipoCanal, { ingresos: Decimal; costo: Decimal }>();
  const margenMarca = new Map<string, { ingresos: Decimal; costo: Decimal }>();
  const margenProd = new Map<string, { label: string; ingresos: Decimal; costo: Decimal }>();
  const vendidosBajoCosto: AnalisisRentabilidad["vendidosBajoCosto"] = [];

  for (const v of ventas) {
    const tc = toDecimal(v.tipoCambio);
    const canal = v.cliente.tipoCanal;
    for (const it of v.items) {
      const sub = toDecimal(it.subtotal);
      const subArs = v.moneda === Moneda.USD ? sub.times(tc) : sub;
      const costoUnit = toDecimal(it.producto.costoPromedio);
      const costoTotal = costoUnit.times(it.cantidad);

      const cc = margenCanal.get(canal) ?? { ingresos: new Decimal(0), costo: new Decimal(0) };
      cc.ingresos = cc.ingresos.plus(subArs);
      cc.costo = cc.costo.plus(costoTotal);
      margenCanal.set(canal, cc);

      if (it.producto.marca) {
        const mm = margenMarca.get(it.producto.marca) ?? {
          ingresos: new Decimal(0),
          costo: new Decimal(0),
        };
        mm.ingresos = mm.ingresos.plus(subArs);
        mm.costo = mm.costo.plus(costoTotal);
        margenMarca.set(it.producto.marca, mm);
      }

      const mp = margenProd.get(it.producto.id) ?? {
        label: it.producto.nombre,
        ingresos: new Decimal(0),
        costo: new Decimal(0),
      };
      mp.ingresos = mp.ingresos.plus(subArs);
      mp.costo = mp.costo.plus(costoTotal);
      margenProd.set(it.producto.id, mp);

      const precioUnit = toDecimal(it.precioUnitario);
      const precioUnitArs = v.moneda === Moneda.USD ? precioUnit.times(tc) : precioUnit;
      if (precioUnitArs.lt(costoUnit) && costoUnit.gt(0)) {
        vendidosBajoCosto.push({
          producto: it.producto.nombre,
          precio: num(precioUnitArs),
          costo: num(costoUnit),
        });
      }
    }
  }

  const ingresosTotal = Array.from(margenProd.values()).reduce(
    (a, m) => a.plus(m.ingresos),
    new Decimal(0),
  );
  const costoTotal = Array.from(margenProd.values()).reduce(
    (a, m) => a.plus(m.costo),
    new Decimal(0),
  );
  const margenBruto = ingresosTotal.minus(costoTotal);

  // Margen mensual 12m
  const meses = lastNMonths(12);
  const ventas12m = await db.venta.findMany({
    where: {
      estado: VentaEstado.EMITIDA,
      fecha: {
        gte: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 11, 1)),
      },
    },
    select: {
      fecha: true,
      moneda: true,
      tipoCambio: true,
      items: {
        select: {
          cantidad: true,
          subtotal: true,
          producto: { select: { costoPromedio: true } },
        },
      },
    },
  });
  const mPorMes = new Map<string, Decimal>();
  for (const m of meses) mPorMes.set(m.key, new Decimal(0));
  for (const v of ventas12m) {
    const k = monthKey(v.fecha);
    const tc = toDecimal(v.tipoCambio);
    let m = mPorMes.get(k) ?? new Decimal(0);
    for (const it of v.items) {
      const sub = toDecimal(it.subtotal);
      const subArs = v.moneda === Moneda.USD ? sub.times(tc) : sub;
      const costo = toDecimal(it.producto.costoPromedio).times(it.cantidad);
      m = m.plus(subArs.minus(costo));
    }
    mPorMes.set(k, m);
  }

  // Top / Bottom producto (margen absoluto)
  const margenSorted = Array.from(margenProd.values())
    .map((m) => ({
      producto: m.label,
      margen: m.ingresos.minus(m.costo),
      pct: m.ingresos.gt(0) ? Number(m.ingresos.minus(m.costo).div(m.ingresos).toFixed(4)) : 0,
    }))
    .sort((a, b) => b.margen.cmp(a.margen));

  // precioVsCosto top productos por valor de venta
  const precioVsCosto = productos.slice(0, 10).map((p) => ({
    producto: p.nombre,
    precio: num(p.precioVenta),
    costo: num(p.costoPromedio),
  }));

  return {
    kpis: {
      margenBruto: num(margenBruto),
      margenBrutoPct: ingresosTotal.gt(0) ? Number(margenBruto.div(ingresosTotal).toFixed(4)) : 0,
      margenNetoPct: ingresosTotal.gt(0) ? Number(margenBruto.div(ingresosTotal).toFixed(4)) : 0,
      productoTop: margenSorted[0]?.producto ?? null,
      productoBottom: margenSorted[margenSorted.length - 1]?.producto ?? null,
    },
    margenPorCanal: Array.from(margenCanal.entries())
      .filter(([, m]) => m.ingresos.gt(0))
      .sort((a, b) => {
        const pa = a[1].ingresos.minus(a[1].costo).div(a[1].ingresos);
        const pb = b[1].ingresos.minus(b[1].costo).div(b[1].ingresos);
        return pb.cmp(pa);
      })
      .map(([k, m]) => ({
        label: CANAL_LABEL[k],
        value: Number(m.ingresos.minus(m.costo).div(m.ingresos).toFixed(4)),
      })),
    margenPorMarca: Array.from(margenMarca.entries())
      .filter(([, m]) => m.ingresos.gt(0))
      .sort((a, b) => {
        const pa = a[1].ingresos.minus(a[1].costo).div(a[1].ingresos);
        const pb = b[1].ingresos.minus(b[1].costo).div(b[1].ingresos);
        return pb.cmp(pa);
      })
      .slice(0, 10)
      .map(([k, m]) => ({
        label: k,
        value: Number(m.ingresos.minus(m.costo).div(m.ingresos).toFixed(4)),
      })),
    precioVsCosto,
    margenBrutoMensal: meses.map((m) => ({
      label: m.label,
      value: num(mPorMes.get(m.key) ?? 0),
    })),
    topProductosMargen: margenSorted.slice(0, 10).map((m) => ({
      producto: m.producto,
      margen: num(m.margen),
      pct: m.pct,
    })),
    vendidosBajoCosto: vendidosBajoCosto.slice(0, 20),
  };
}

// =====================================================================
// 7. FISCAL
// =====================================================================

export type AnalisisFiscal = {
  kpis: {
    ivaSaldo: Money;
    iibbTotalPropio: Money;
    percepcionesCobradas: Money;
    provisionGanancias: Money;
  };
  ivaMensal: { label: string; debito: Money; credito: Money }[];
  iibbPorJurisdiccion: RankingRow[];
  percepcionesMensales: MoneySerie[];
  retenciones: { label: string; sufridas: Money; cobradas: Money }[];
  ivaSaldoMensal: { mes: string; debito: Money; credito: Money; saldo: Money }[];
};

export async function getAnalisisFiscal(rng: DateRange): Promise<AnalisisFiscal> {
  const ahora = new Date();
  const desde12m = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth() - 11, 1));

  const [ventasRng, ventasIIBB, ventasPercepcion12m, lineasFiscales, provisionAcc] =
    await Promise.all([
      db.venta.findMany({
        where: { estado: VentaEstado.EMITIDA, fecha: dateWhere(rng) },
        select: { iva: true, iibb: true, percepcionIIBB: true, moneda: true, tipoCambio: true },
      }),
      db.venta.findMany({
        where: {
          estado: VentaEstado.EMITIDA,
          fecha: dateWhere(rng),
          percepcionIIBBJurisdiccionId: { not: null },
        },
        select: {
          percepcionIIBB: true,
          moneda: true,
          tipoCambio: true,
          percepcionIIBBJurisdiccion: { select: { nombre: true } },
        },
      }),
      db.venta.findMany({
        where: { estado: VentaEstado.EMITIDA, fecha: { gte: desde12m } },
        select: {
          fecha: true,
          iva: true,
          percepcionIIBB: true,
          moneda: true,
          tipoCambio: true,
        },
      }),
      db.lineaAsiento.findMany({
        where: {
          asiento: {
            estado: AsientoEstado.CONTABILIZADO,
            fecha: { gte: desde12m },
          },
          cuenta: { codigo: { startsWith: "1.1.4." } },
        },
        select: {
          debe: true,
          haber: true,
          asiento: { select: { fecha: true } },
          cuenta: { select: { codigo: true, nombre: true } },
        },
      }),
      db.lineaAsiento.aggregate({
        where: {
          asiento: { estado: AsientoEstado.CONTABILIZADO },
          cuenta: { codigo: { startsWith: "5.5.99" } },
        },
        _sum: { debe: true, haber: true },
      }),
    ]);

  // KPIs IVA / IIBB / Percepciones
  let ivaTotal = new Decimal(0);
  let iibbTotal = new Decimal(0);
  let percepcionesTotal = new Decimal(0);
  for (const v of ventasRng) {
    const tc = toDecimal(v.tipoCambio);
    const conv = (d: Decimal) => (v.moneda === Moneda.USD ? d.times(tc) : d);
    ivaTotal = ivaTotal.plus(conv(toDecimal(v.iva)));
    iibbTotal = iibbTotal.plus(conv(toDecimal(v.iibb)));
    percepcionesTotal = percepcionesTotal.plus(conv(toDecimal(v.percepcionIIBB)));
  }

  // IIBB por jurisdicción
  const porJuri = new Map<string, Decimal>();
  for (const v of ventasIIBB) {
    if (!v.percepcionIIBBJurisdiccion) continue;
    const tc = toDecimal(v.tipoCambio);
    const ars =
      v.moneda === Moneda.USD ? toDecimal(v.percepcionIIBB).times(tc) : toDecimal(v.percepcionIIBB);
    porJuri.set(
      v.percepcionIIBBJurisdiccion.nombre,
      (porJuri.get(v.percepcionIIBBJurisdiccion.nombre) ?? new Decimal(0)).plus(ars),
    );
  }

  // Series 12m
  const meses = lastNMonths(12);
  const ivaDebMes = new Map<string, Decimal>();
  const ivaCredMes = new Map<string, Decimal>();
  const percMes = new Map<string, Decimal>();
  for (const m of meses) {
    ivaDebMes.set(m.key, new Decimal(0));
    ivaCredMes.set(m.key, new Decimal(0));
    percMes.set(m.key, new Decimal(0));
  }
  for (const v of ventasPercepcion12m) {
    const k = monthKey(v.fecha);
    const tc = toDecimal(v.tipoCambio);
    const conv = (d: Decimal) => (v.moneda === Moneda.USD ? d.times(tc) : d);
    ivaDebMes.set(k, (ivaDebMes.get(k) ?? new Decimal(0)).plus(conv(toDecimal(v.iva))));
    percMes.set(k, (percMes.get(k) ?? new Decimal(0)).plus(conv(toDecimal(v.percepcionIIBB))));
  }
  // IVA crédito desde líneas asiento (cuenta 1.1.4.01 / 1.1.4.05 — IVA crédito fiscal)
  let retSufridas = new Decimal(0);
  let retCobradas = new Decimal(0);
  for (const l of lineasFiscales) {
    const k = monthKey(l.asiento.fecha);
    const debe = toDecimal(l.debe);
    const haber = toDecimal(l.haber);
    if (
      l.cuenta.codigo.startsWith("1.1.4.1.01") ||
      l.cuenta.codigo.startsWith("1.1.4.1.04") ||
      l.cuenta.codigo.startsWith("1.1.4.2.03")
    ) {
      // IVA crédito (sumamos saldo deudor)
      ivaCredMes.set(k, (ivaCredMes.get(k) ?? new Decimal(0)).plus(debe).minus(haber));
    }
    // Retenciones sufridas (1.1.4.30 / 1.1.4.31) vs cobradas como agente
    if (l.cuenta.nombre.toLowerCase().includes("retenc")) {
      if (debe.gt(haber)) retSufridas = retSufridas.plus(debe.minus(haber));
      else retCobradas = retCobradas.plus(haber.minus(debe));
    }
  }

  const provisionGanancias = toDecimal(provisionAcc._sum.debe ?? 0).minus(
    toDecimal(provisionAcc._sum.haber ?? 0),
  );

  return {
    kpis: {
      ivaSaldo: num(ivaTotal),
      iibbTotalPropio: num(iibbTotal),
      percepcionesCobradas: num(percepcionesTotal),
      provisionGanancias: num(provisionGanancias),
    },
    ivaMensal: meses.map((m) => ({
      label: m.label,
      debito: num(ivaDebMes.get(m.key) ?? 0),
      credito: num(ivaCredMes.get(m.key) ?? 0),
    })),
    iibbPorJurisdiccion: Array.from(porJuri.entries())
      .sort((a, b) => b[1].cmp(a[1]))
      .map(([k, v]) => ({ label: k, value: num(v) })),
    percepcionesMensales: meses.map((m) => ({
      label: m.label,
      value: num(percMes.get(m.key) ?? 0),
    })),
    retenciones: [
      { label: "Retenciones sufridas", sufridas: num(retSufridas), cobradas: 0 },
      { label: "Retenciones cobradas", sufridas: 0, cobradas: num(retCobradas) },
    ],
    ivaSaldoMensal: meses.map((m) => {
      const deb = ivaDebMes.get(m.key) ?? new Decimal(0);
      const cred = ivaCredMes.get(m.key) ?? new Decimal(0);
      return {
        mes: m.label,
        debito: num(deb),
        credito: num(cred),
        saldo: num(deb.minus(cred)),
      };
    }),
  };
}

// Re-export para uso en componentes de tab
export const TAB_IDS = [
  "resumen",
  "ventas",
  "compras",
  "stock",
  "tesoreria",
  "rentabilidad",
  "fiscal",
] as const;
export type TabId = (typeof TAB_IDS)[number];

// Suppress unused-import warning for GastoEstado (kept for potential future use)
export const _ENUM_HINTS = { GastoEstado, MovimientoStockTipo };
