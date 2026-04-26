import "server-only";

import { db } from "@/lib/db";
import { Decimal, sumMoney, toDecimal } from "@/lib/decimal";
import {
  AsientoEstado,
  type CuentaCategoria,
  type CuentaTipo,
  type Moneda,
} from "@/generated/prisma/client";

export type LineaContabilizada = {
  id: number;
  cuentaId: number;
  debe: Decimal;
  haber: Decimal;
  descripcion: string | null;
  asiento: {
    id: string;
    numero: number;
    fecha: Date;
    descripcion: string;
    moneda: Moneda;
    tipoCambio: Decimal;
  };
};

export type FetchLineasInput = {
  periodoId?: number;
  cuentaId?: number;
  cuentaIds?: number[];
  fechaDesde?: Date;
  fechaHasta?: Date;
};

export async function fetchLineasContabilizadas(
  input: FetchLineasInput,
): Promise<LineaContabilizada[]> {
  const rows = await db.lineaAsiento.findMany({
    where: {
      cuentaId: input.cuentaId
        ? input.cuentaId
        : input.cuentaIds
          ? { in: input.cuentaIds }
          : undefined,
      asiento: {
        estado: AsientoEstado.CONTABILIZADO,
        periodoId: input.periodoId,
        fecha:
          input.fechaDesde || input.fechaHasta
            ? {
                gte: input.fechaDesde,
                lte: input.fechaHasta,
              }
            : undefined,
      },
    },
    orderBy: [
      { asiento: { fecha: "asc" } },
      { asiento: { numero: "asc" } },
      { id: "asc" },
    ],
    select: {
      id: true,
      cuentaId: true,
      debe: true,
      haber: true,
      descripcion: true,
      asiento: {
        select: {
          id: true,
          numero: true,
          fecha: true,
          descripcion: true,
          moneda: true,
          tipoCambio: true,
        },
      },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    cuentaId: r.cuentaId,
    debe: toDecimal(r.debe),
    haber: toDecimal(r.haber),
    descripcion: r.descripcion,
    asiento: {
      id: r.asiento.id,
      numero: r.asiento.numero,
      fecha: r.asiento.fecha,
      descripcion: r.asiento.descripcion,
      moneda: r.asiento.moneda,
      tipoCambio: toDecimal(r.asiento.tipoCambio),
    },
  }));
}

// Sinal natural: valor positivo representa o saldo na natureza da conta.
// ACTIVO/EGRESO → saldo devedor (debe - haber).
// PASIVO/PATRIMONIO/INGRESO → saldo credor (haber - debe).
export function saldoPorCategoria(
  debe: Decimal,
  haber: Decimal,
  categoria: CuentaCategoria,
): Decimal {
  if (categoria === "ACTIVO" || categoria === "EGRESO") {
    return debe.minus(haber);
  }
  return haber.minus(debe);
}

// Chave YYYY-MM usada em todas as agregações mensais.
export function mesKey(fecha: Date): string {
  const y = fecha.getUTCFullYear();
  const m = String(fecha.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

// Converte um valor da moneda de origem para uma moneda alvo usando tipoCambio.
// tipoCambio é definido como "ARS por USD" (ex: 1000 = 1 USD custa 1000 ARS).
export function convertirMoneda(
  valor: Decimal,
  monedaOrigen: Moneda,
  tipoCambio: Decimal,
  monedaDestino: Moneda,
): Decimal {
  if (monedaOrigen === monedaDestino) return valor;
  if (monedaOrigen === "USD" && monedaDestino === "ARS") {
    return valor.times(tipoCambio);
  }
  // ARS → USD
  if (tipoCambio.isZero()) return new Decimal(0);
  return valor.dividedBy(tipoCambio);
}

// Gera lista ordenada de chaves YYYY-MM entre duas datas (inclusive).
export function listarMeses(desde: Date, hasta: Date): string[] {
  const out: string[] = [];
  const cursor = new Date(
    Date.UTC(desde.getUTCFullYear(), desde.getUTCMonth(), 1),
  );
  const fim = new Date(
    Date.UTC(hasta.getUTCFullYear(), hasta.getUTCMonth(), 1),
  );
  while (cursor.getTime() <= fim.getTime()) {
    out.push(mesKey(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return out;
}

// Nó de árvore usado por Balance General e Estado de Resultados.
export type CuentaTreeNode = {
  id: number;
  codigo: string;
  nombre: string;
  tipo: CuentaTipo;
  categoria: CuentaCategoria;
  nivel: number;
  debe: Decimal;
  haber: Decimal;
  saldo: Decimal;
  children: CuentaTreeNode[];
};

export type BuildTreeResult = {
  roots: CuentaTreeNode[];
  porCategoria: Map<CuentaCategoria, CuentaTreeNode[]>;
  totalPorCategoria: Map<CuentaCategoria, Decimal>;
};

/**
 * Filtro temporal: por `periodoId` (un mes contable) o por rango de
 * fechas (desde/hasta). Para Balance General típicamente se usa fecha
 * `hasta` sola (saldo acumulado al cierre del día). Para movimientos
 * dentro de un período se usa `desde`+`hasta`.
 */
export type ReporteFilter =
  | { periodoId: number }
  | { fechaDesde?: Date; fechaHasta?: Date };

/**
 * Carrega todas as contas do plano filtradas por `categorias` e agrega os totais
 * debe/haber vindos de `lineaAsiento` onde `asiento.estado = CONTABILIZADO`.
 * Aceita filtro por período contable ou por rango de fechas. Monta a árvore
 * com `padreCodigo` e faz roll-up bottom-up em contas SINTETICAS.
 */
export async function buildCuentaTree(
  categorias: CuentaCategoria[],
  filter: ReporteFilter,
): Promise<BuildTreeResult> {
  const asientoWhere =
    "periodoId" in filter
      ? {
          estado: AsientoEstado.CONTABILIZADO,
          periodoId: filter.periodoId,
        }
      : {
          estado: AsientoEstado.CONTABILIZADO,
          ...(filter.fechaDesde || filter.fechaHasta
            ? {
                fecha: {
                  ...(filter.fechaDesde && { gte: filter.fechaDesde }),
                  ...(filter.fechaHasta && { lte: filter.fechaHasta }),
                },
              }
            : {}),
        };

  const [cuentas, agregados] = await Promise.all([
    db.cuentaContable.findMany({
      where: { categoria: { in: categorias } },
      orderBy: { codigo: "asc" },
      select: {
        id: true,
        codigo: true,
        nombre: true,
        tipo: true,
        categoria: true,
        nivel: true,
        padreCodigo: true,
      },
    }),
    db.lineaAsiento.groupBy({
      by: ["cuentaId"],
      where: {
        asiento: asientoWhere,
        cuenta: { categoria: { in: categorias } },
      },
      _sum: { debe: true, haber: true },
    }),
  ]);

  const agregadoPorCuenta = new Map<number, { debe: Decimal; haber: Decimal }>();
  for (const a of agregados) {
    agregadoPorCuenta.set(a.cuentaId, {
      debe: toDecimal(a._sum.debe ?? 0),
      haber: toDecimal(a._sum.haber ?? 0),
    });
  }

  const byCodigo = new Map<string, CuentaTreeNode>();
  const padreByCodigo = new Map<string, string | null>();
  for (const c of cuentas) {
    const agg = agregadoPorCuenta.get(c.id);
    const debe = agg?.debe ?? new Decimal(0);
    const haber = agg?.haber ?? new Decimal(0);
    byCodigo.set(c.codigo, {
      id: c.id,
      codigo: c.codigo,
      nombre: c.nombre,
      tipo: c.tipo,
      categoria: c.categoria,
      nivel: c.nivel,
      debe,
      haber,
      saldo:
        c.tipo === "ANALITICA"
          ? saldoPorCategoria(debe, haber, c.categoria)
          : new Decimal(0),
      children: [],
    });
    padreByCodigo.set(c.codigo, c.padreCodigo ?? null);
  }

  const roots: CuentaTreeNode[] = [];
  for (const c of cuentas) {
    const node = byCodigo.get(c.codigo);
    if (!node) continue;
    const padre = padreByCodigo.get(c.codigo);
    if (padre) {
      const parent = byCodigo.get(padre);
      if (parent) {
        parent.children.push(node);
        continue;
      }
    }
    roots.push(node);
  }

  // Roll-up bottom-up em contas sintéticas.
  const rollUp = (node: CuentaTreeNode): void => {
    if (node.tipo === "SINTETICA" && node.children.length > 0) {
      for (const ch of node.children) rollUp(ch);
      node.debe = sumMoney(node.children.map((ch) => ch.debe));
      node.haber = sumMoney(node.children.map((ch) => ch.haber));
      node.saldo = sumMoney(node.children.map((ch) => ch.saldo));
    } else {
      node.saldo = node.saldo.toDecimalPlaces(2);
      node.debe = node.debe.toDecimalPlaces(2);
      node.haber = node.haber.toDecimalPlaces(2);
    }
  };
  for (const r of roots) rollUp(r);

  const porCategoria = new Map<CuentaCategoria, CuentaTreeNode[]>();
  const totalPorCategoria = new Map<CuentaCategoria, Decimal>();
  for (const r of roots) {
    const arr = porCategoria.get(r.categoria) ?? [];
    arr.push(r);
    porCategoria.set(r.categoria, arr);
  }
  for (const cat of categorias) {
    const nodes = porCategoria.get(cat) ?? [];
    totalPorCategoria.set(
      cat,
      sumMoney(nodes.map((n) => n.saldo)),
    );
  }

  return { roots, porCategoria, totalPorCategoria };
}
