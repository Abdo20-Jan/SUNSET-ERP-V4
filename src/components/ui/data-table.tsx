"use client";

import { flexRender, type Table as TanstackTable } from "@tanstack/react-table";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

type DataTableProps<T> = {
  table: TanstackTable<T>;
  emptyMessage?: string;
  emptyFilteredMessage?: string;
  isFiltered?: boolean;
  /**
   * Densidade da tabela (PR-001 Design Foundation). `comfortable` (default)
   * preserva o comportamento atual; `dense` aplica a altura tokenizada
   * (linha 32px / cabeçalho 34px) preparando worklists para ~28-30 linhas/1080p.
   */
  density?: "comfortable" | "dense";
  /** Zebra sutil opt-in nas linhas pares do corpo. */
  zebra?: boolean;
};

export function DataTable<T>({
  table,
  emptyMessage = "Sin registros.",
  emptyFilteredMessage,
  isFiltered = false,
  density = "comfortable",
  zebra = false,
}: DataTableProps<T>) {
  const rows = table.getRowModel().rows;
  const columnCount = table.getAllLeafColumns().length;
  const showEmpty = rows.length === 0;
  const filteredMsg = emptyFilteredMessage ?? emptyMessage;

  return (
    <Table className={cn(density === "dense" && "table-dense", zebra && "table-zebra")}>
      <TableHeader>
        {table.getHeaderGroups().map((headerGroup) => (
          <TableRow key={headerGroup.id}>
            {headerGroup.headers.map((header) => (
              <TableHead key={header.id}>
                {flexRender(header.column.columnDef.header, header.getContext())}
              </TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {showEmpty ? (
          <TableRow>
            <TableCell
              colSpan={columnCount}
              className="py-12 text-center text-sm text-muted-foreground"
            >
              {isFiltered ? filteredMsg : emptyMessage}
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row) => (
            <TableRow key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
