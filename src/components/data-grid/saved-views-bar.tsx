"use client";

/**
 * SavedViewsBar (PR-003) — **fundação local/in-memory** das visões salvas
 * (PAGE-STD-01). Cada visão aplica um `predicate` client-side (refilter sem
 * reload). NÃO há persistência/URL/visões pessoais nesta PR — isso é declarado
 * como futuro (evita "fingir" persistência). Se não houver visões, não renderiza.
 */

import { cn } from "@/lib/utils";
import type { SavedView } from "./data-grid-helpers";

export function SavedViewsBar<T>({
  views,
  activeId,
  onSelect,
}: {
  views: SavedView<T>[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  if (views.length === 0) return null;

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-border/60 px-3 scrollbar-thin">
      <span className="mr-1 shrink-0 text-xs text-muted-foreground">Vistas:</span>
      {views.map((v) => {
        const isActive = v.id === activeId;
        return (
          <button
            key={v.id}
            type="button"
            onClick={() => onSelect(v.id)}
            aria-current={isActive ? "true" : undefined}
            className={cn(
              "shrink-0 border-b-2 px-2.5 py-1.5 text-xs transition-colors",
              isActive
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {v.label}
          </button>
        );
      })}
    </div>
  );
}
