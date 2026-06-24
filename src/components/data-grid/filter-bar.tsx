"use client";

/**
 * FilterBar (PR-003) — chips de filtro simples (um `Select` por `QuickFilter`),
 * em AND com a busca rápida. O botão "Más filtros" é uma **superfície
 * desabilitada** (FloatingWorkWindow → PR-004). Sem persistência aqui.
 */

import { HugeiconsIcon } from "@hugeicons/react";
import { FilterIcon } from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { QuickFilter } from "./data-grid-helpers";

/** Sentinela p/ "todos" (o `Select` exige um value não-vazio por item). */
const ALL = "__all__";

export function FilterBar({
  filters,
  active,
  onChange,
  onClear,
}: {
  filters: QuickFilter[];
  active: Record<string, string>;
  onChange: (columnId: string, value: string) => void;
  onClear: () => void;
}) {
  if (filters.length === 0) return null;
  const hasActive = Object.values(active).some((v) => v.length > 0);

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <HugeiconsIcon icon={FilterIcon} strokeWidth={2} className="size-3.5" />
        Filtros
      </span>
      {filters.map((f) => (
        <Select
          key={f.columnId}
          value={active[f.columnId] || ALL}
          onValueChange={(v) => onChange(f.columnId, !v || v === ALL ? "" : v)}
        >
          <SelectTrigger size="sm" className="w-auto min-w-40 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{f.label}: todos</SelectItem>
            {f.options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ))}
      {hasActive ? (
        <Button variant="ghost" size="xs" onClick={onClear}>
          Limpiar
        </Button>
      ) : null}
      <span
        className="ml-auto"
        title="Filtros avanzados en FloatingWorkWindow — disponible en PR-004"
      >
        <Button variant="outline" size="sm" disabled>
          Más filtros
        </Button>
      </span>
    </div>
  );
}
