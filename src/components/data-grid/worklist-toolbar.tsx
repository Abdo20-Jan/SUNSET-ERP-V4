"use client";

/**
 * WorklistToolbar (PR-003) — faixa superior: título, busca rápida (~50%),
 * controle de colunas, ação primária (texto completo — G-03) e a **superfície
 * de export desabilitada** (export auditado + permissão → PR-005).
 */

import type * as React from "react";
import type { Table } from "@tanstack/react-table";
import { HugeiconsIcon } from "@hugeicons/react";
import { Download04Icon, SearchIcon } from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ColumnVisibility } from "./column-visibility";

export function WorklistToolbar<T>({
  table,
  title,
  primaryAction,
  searchPlaceholder,
  showSearch,
  searchValue,
  onSearchChange,
  exportSurface,
}: {
  table: Table<T>;
  title?: React.ReactNode;
  primaryAction?: React.ReactNode;
  showSearch?: boolean;
  searchPlaceholder?: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  exportSurface?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 border-b border-border/60 p-3 sm:flex-row sm:items-center">
      {title ? <div className="text-sm font-semibold sm:mr-1">{title}</div> : null}
      {showSearch ? (
        <div className="relative w-full sm:max-w-md sm:flex-1">
          <HugeiconsIcon
            icon={SearchIcon}
            strokeWidth={2}
            className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            placeholder={searchPlaceholder ?? "Buscar en esta lista…"}
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-8 pl-9"
          />
        </div>
      ) : null}
      <div className="flex items-center gap-2 sm:ml-auto">
        {exportSurface ? (
          <span title="Exportar Excel — disponible en PR-005 (export auditado + permiso)">
            <Button variant="outline" size="sm" disabled>
              <HugeiconsIcon icon={Download04Icon} strokeWidth={2} />
              Exportar
            </Button>
          </span>
        ) : null}
        <ColumnVisibility table={table} />
        {primaryAction}
      </div>
    </div>
  );
}
