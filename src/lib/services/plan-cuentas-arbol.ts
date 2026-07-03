import "server-only";

import { db } from "@/lib/db";
import type { CuentaCategoria, CuentaTipo, Naturaleza } from "@/generated/prisma/client";
import { naturalezaEfectiva } from "@/lib/services/cuenta-naturaleza";
import { type BalanceNode, getBalanceSumasYSaldos } from "@/lib/services/balance-sumas-saldos";

/**
 * Proyección compartida del Plan de Cuentas con saldo (CONT-02 · PR-028) —
 * la page y el export auditado re-leen la MISMA proyección.
 *
 * ADITIVA y read-only: el armado del árbol por `padreCodigo` se movió VERBATIM
 * de `cuentas/page.tsx`; el saldo por cuenta sale de `getBalanceSumasYSaldos`
 * (reuso — roll-up de sintéticas YA calculado por el servicio, JAMÁS se
 * recomputa acá) sin `fechaDesde` (saldo acumulado histórico), sin `tcParaUsd`
 * (display ARS-only) y SIN `pruneBalanceSinSaldo` (el plan muestra todas las
 * cuentas). La naturaleza mostrada es la EFECTIVA (`naturalezaEfectiva`,
 * reuso de cuenta-naturaleza).
 *
 * Nota de paridad (documentada, NO corregida — restricción PR-028): el
 * balance signa por `naturaleza` efectiva; `getLibroMayor` signa por
 * categoría (`saldoPorCategoria`). Para cuentas REGULARIZADORAS el saldo de
 * esta columna y el `saldoFinal` de la FWW del Libro Mayor pueden divergir
 * de signo — divergencia PRE-existente entre los dos servicios del motor.
 */

export type CuentaArbolRow = {
  id: number;
  codigo: string;
  nombre: string;
  /** Rótulo UI "Tipo" (ACTIVO/PASIVO/PATRIMONIO/INGRESO/EGRESO). */
  categoria: CuentaCategoria;
  /** Rótulo UI "Categoría" (SINTETICA/ANALITICA). */
  tipo: CuentaTipo;
  nivel: number;
  padreCodigo: string | null;
  activa: boolean;
  /** Naturaleza EFECTIVA (explícita, o default de la categoría). */
  naturaleza: Naturaleza;
  /** saldoFinal ARS del nodo del balance ("0.00" si la cuenta no movió). */
  saldo: string;
  children?: CuentaArbolRow[];
};

export type PlanDeCuentasConSaldo = {
  roots: CuentaArbolRow[];
  /** Lista plana en orden de código (para el export). */
  flat: CuentaArbolRow[];
  /** Fecha de corte del saldo (ISO) — va a los filtros del evento de export. */
  fechaCorte: string;
};

/** Walk recursivo BalanceNode[] → Map codigo → saldoFinal (roll-up incluido). */
export function mapSaldosPorCodigo(nodes: BalanceNode[]): Map<string, string> {
  const map = new Map<string, string>();
  const walk = (node: BalanceNode) => {
    map.set(node.codigo, node.saldoFinal);
    for (const child of node.children ?? []) walk(child);
  };
  for (const node of nodes) walk(node);
  return map;
}

export async function getPlanDeCuentasConSaldo(): Promise<PlanDeCuentasConSaldo> {
  const fechaCorte = new Date();

  const [cuentas, balance] = await Promise.all([
    db.cuentaContable.findMany({ orderBy: { codigo: "asc" } }),
    getBalanceSumasYSaldos({ fechaHasta: fechaCorte }),
  ]);

  const saldos = mapSaldosPorCodigo(balance.root);

  const flat: CuentaArbolRow[] = cuentas.map((c) => ({
    id: c.id,
    codigo: c.codigo,
    nombre: c.nombre,
    categoria: c.categoria,
    tipo: c.tipo,
    nivel: c.nivel,
    padreCodigo: c.padreCodigo,
    activa: c.activa,
    naturaleza: naturalezaEfectiva(c.naturaleza, c.categoria),
    saldo: saldos.get(c.codigo) ?? "0.00",
  }));

  // Armado del árbol por padreCodigo — VERBATIM de la page legada.
  const byCodigo = new Map<string, CuentaArbolRow>();
  for (const c of flat) {
    byCodigo.set(c.codigo, { ...c, children: [] });
  }

  const roots: CuentaArbolRow[] = [];
  for (const c of flat) {
    const node = byCodigo.get(c.codigo);
    if (!node) continue;
    if (c.padreCodigo) {
      const parent = byCodigo.get(c.padreCodigo);
      if (parent) parent.children?.push(node);
      else roots.push(node);
    } else {
      roots.push(node);
    }
  }

  const stripEmptyChildren = (node: CuentaArbolRow) => {
    if (!node.children) return;
    if (node.children.length === 0) {
      node.children = undefined;
      return;
    }
    node.children.forEach(stripEmptyChildren);
  };
  roots.forEach(stripEmptyChildren);

  return { roots, flat, fechaCorte: fechaCorte.toISOString() };
}
