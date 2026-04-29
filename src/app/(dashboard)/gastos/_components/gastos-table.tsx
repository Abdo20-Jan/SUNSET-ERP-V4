"use client";

import Link from "next/link";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";

import type { GastoRow } from "@/lib/actions/gastos";
import { fmtDate, fmtMoney } from "@/lib/format";
import { DateBadge } from "@/components/ui/date-badge";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

function estadoVariant(
  estado: GastoRow["estado"],
): "default" | "outline" | "secondary" | "destructive" {
  switch (estado) {
    case "BORRADOR":
      return "outline";
    case "CONTABILIZADO":
      return "default";
    case "ANULADO":
      return "destructive";
  }
}

export function GastosTable({ data }: { data: GastoRow[] }) {
  const columns: ColumnDef<GastoRow>[] = [
    {
      id: "numero",
      header: "Número",
      cell: ({ row }) => (
        <Link
          href={`/gastos/${row.original.id}`}
          className="font-mono text-sm hover:underline"
        >
          {row.original.numero}
        </Link>
      ),
    },
    {
      id: "fecha",
      header: "Fecha",
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">
          {fmtDate(new Date(row.original.fecha))}
        </span>
      ),
    },
    {
      id: "proveedor",
      header: "Proveedor",
      cell: ({ row }) => (
        <span className="text-sm">{row.original.proveedor.nombre}</span>
      ),
    },
    {
      id: "factura",
      header: "Factura",
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.facturaNumero ?? "—"}
        </span>
      ),
    },
    {
      id: "vencimiento",
      header: "Vencimiento",
      cell: ({ row }) => {
        if (row.original.estado !== "CONTABILIZADO")
          return <span className="text-xs text-muted-foreground">—</span>;
        return <DateBadge fecha={row.original.fechaVencimiento} relative />;
      },
    },
    {
      id: "total",
      header: () => <span className="block text-right">Total</span>,
      cell: ({ row }) => (
        <span
          className={cn(
            "block text-right font-mono text-sm tabular-nums",
            row.original.estado === "ANULADO" && "line-through opacity-60",
          )}
        >
          {fmtMoney(row.original.total)} {row.original.moneda}
        </span>
      ),
    },
    {
      id: "estado",
      header: "Estado",
      cell: ({ row }) => (
        <Badge variant={estadoVariant(row.original.estado)}>
          {row.original.estado}
        </Badge>
      ),
    },
  ];

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <Table>
      <caption className="sr-only">Gastos locales</caption>
      <TableHeader>
        {table.getHeaderGroups().map((headerGroup) => (
          <TableRow key={headerGroup.id}>
            {headerGroup.headers.map((header) => (
              <TableHead key={header.id}>
                {flexRender(
                  header.column.columnDef.header,
                  header.getContext(),
                )}
              </TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.length === 0 ? (
          <TableRow>
            <TableCell
              colSpan={columns.length}
              className="py-12 text-center text-sm text-muted-foreground"
            >
              No hay gastos registrados todavía.
            </TableCell>
          </TableRow>
        ) : (
          table.getRowModel().rows.map((row) => (
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
