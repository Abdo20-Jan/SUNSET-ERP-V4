"use client";

import type { RowData, Table } from "@tanstack/react-table";
import { HugeiconsIcon } from "@hugeicons/react";
import { ColumnsThreeCogIcon } from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Permite tipar `columnDef.meta.label` como string sin castear en cada call-site.
// La augmentación es global a `@tanstack/react-table` (es el patrón documentado).
declare module "@tanstack/react-table" {
  // Los type params deben coincidir con la firma original para fusionar; no se
  // usan en el miembro agregado (declaration merging) → falso positivo del linter.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    label?: string;
  }
}

/**
 * Toggle de visibilidad de columnas: lista solo las columnas que pueden
 * ocultarse (`getCanHide()`), mostrando el `meta.label` cuando existe o el
 * `id` como fallback. El estado vive en la instancia de la tabla (cliente).
 */
export function ColumnsToggle<TData>({ table }: { table: Table<TData> }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
        <HugeiconsIcon icon={ColumnsThreeCogIcon} strokeWidth={2} />
        Columnas
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {table
          .getAllColumns()
          .filter((col) => col.getCanHide())
          .map((col) => (
            <DropdownMenuCheckboxItem
              key={col.id}
              checked={col.getIsVisible()}
              onCheckedChange={(v) => col.toggleVisibility(!!v)}
            >
              {col.columnDef.meta?.label ?? col.id}
            </DropdownMenuCheckboxItem>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
