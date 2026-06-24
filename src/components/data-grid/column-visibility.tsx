"use client";

/**
 * Controle de visibilidade de colunas (PR-003). Lista as colunas `hideable`
 * (via `column.getCanHide()`) num `DropdownMenu` de checkboxes ligado ao estado
 * `columnVisibility` do TanStack.
 */

import type { Table } from "@tanstack/react-table";
import { HugeiconsIcon } from "@hugeicons/react";
import { LayoutTable01Icon } from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ColumnVisibility<T>({ table }: { table: Table<T> }) {
  const columns = table.getAllLeafColumns().filter((c) => c.getCanHide());
  if (columns.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
        <HugeiconsIcon icon={LayoutTable01Icon} strokeWidth={2} />
        Columnas
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuLabel>Mostrar columnas</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {columns.map((column) => {
          const meta = column.columnDef.meta;
          const label =
            meta?.label ??
            (typeof column.columnDef.header === "string" ? column.columnDef.header : column.id);
          return (
            <DropdownMenuCheckboxItem
              key={column.id}
              checked={column.getIsVisible()}
              onCheckedChange={(value) => column.toggleVisibility(!!value)}
            >
              {label}
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
