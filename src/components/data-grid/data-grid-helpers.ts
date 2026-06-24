/**
 * Tipos e utilitários puros do EnterpriseDataGrid (PR-003 — Worklist Infra).
 *
 * Sem JSX/efeitos: só a augmentação de `ColumnMeta` do TanStack, os tipos da
 * configuração de worklist e funções puras de filtragem (busca rápida + chips).
 * A montagem do grid vive em `enterprise-data-grid.tsx`.
 */

import type { ColumnDef, RowData } from "@tanstack/react-table";

// Augmenta o `ColumnMeta` do TanStack com metadados de apresentação do grid.
// (Declaração global — basta existir uma vez no bundle.)
declare module "@tanstack/react-table" {
  // `TData`/`TValue` precisam casar exatamente os type params do `ColumnMeta`
  // original (TS exige declarações idênticas p/ merge), embora não usados aqui.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Alinhamento horizontal da célula/cabeçalho. */
    align?: "left" | "right" | "center";
    /** Largura fixa em px (foundation de resize/fixed-width; obrigatória p/ pin). */
    width?: number;
    /** Fixar a coluna à esquerda (freeze). PR-003 entrega left-pin funcional. */
    pinned?: "left";
    /** Rótulo legível p/ o menu de visibilidade (default = header string). */
    label?: string;
  }
}

/** Visão salva — foundation local/in-memory (sem persistência nesta PR). */
export type SavedView<T> = {
  id: string;
  label: string;
  /** Predicado client-side aplicado às linhas. Ausente = "todos". */
  predicate?: (row: T) => boolean;
};

export type QuickFilterOption = { value: string; label: string };

/** Filtro simples (chip = `Select`) ligado a um campo do objeto da linha. */
export type QuickFilter = {
  /** Chave do objeto da linha cujo valor é comparado por igualdade. */
  columnId: string;
  label: string;
  options: QuickFilterOption[];
};

export type QuickSearchConfig<T> = {
  placeholder?: string;
  /** Campos do objeto da linha usados no filtro textual (OR entre eles). */
  keys: (keyof T)[];
};

/** Densidade do grid (consome os utilitários `.table-dense` do PR-001). */
export type DataGridDensity = "comfortable" | "dense";

/** Converte um campo arbitrário da linha em string comparável (lowercase). */
export function fieldToSearchString(value: unknown): string {
  if (value == null) return "";
  return String(value).toLowerCase();
}

/** Casa o termo de busca contra qualquer um dos `keys` (OR). */
export function matchesQuickSearch<T>(row: T, keys: (keyof T)[], query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return keys.some((k) =>
    fieldToSearchString((row as Record<string, unknown>)[k as string]).includes(q),
  );
}

/** Casa todos os filtros de chip ativos (AND); valores vazios são ignorados. */
export function matchesActiveFilters<T>(row: T, active: Record<string, string>): boolean {
  for (const [columnId, value] of Object.entries(active)) {
    if (!value) continue;
    const cell = (row as Record<string, unknown>)[columnId];
    if (cell == null || String(cell) !== value) return false;
  }
  return true;
}

/** Resolve o id de uma `ColumnDef` (explícito ou derivado de `accessorKey`). */
export function columnDefId<T>(col: ColumnDef<T, unknown>): string | undefined {
  if (col.id) return col.id;
  const accessorKey = (col as { accessorKey?: string | number }).accessorKey;
  return accessorKey != null ? String(accessorKey) : undefined;
}
