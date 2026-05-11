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

type DataTableProps<T> = {
  table: TanstackTable<T>;
  emptyMessage?: string;
  emptyFilteredMessage?: string;
  isFiltered?: boolean;
};

export function DataTable<T>({
  table,
  emptyMessage = "Sin registros.",
  emptyFilteredMessage,
  isFiltered = false,
}: DataTableProps<T>) {
  const rows = table.getRowModel().rows;
  const columnCount = table.getAllLeafColumns().length;
  const showEmpty = rows.length === 0;
  const filteredMsg = emptyFilteredMessage ?? emptyMessage;

  return (
    <Table>
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
