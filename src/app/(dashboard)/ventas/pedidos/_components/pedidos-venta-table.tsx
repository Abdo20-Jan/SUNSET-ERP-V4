"use client";

import Link from "next/link";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";

import type { PedidoVentaRow } from "@/lib/actions/pedidos-venta";
import { fmtDate, fmtMoney } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function estadoVariant(
  estado: PedidoVentaRow["estado"],
): "default" | "outline" | "secondary" | "destructive" {
  switch (estado) {
    case "BORRADOR":
      return "outline";
    case "ENVIADO":
    case "CONFIRMADO":
      return "default";
    case "PARCIAL":
    case "COMPLETADO":
      return "secondary";
    case "CANCELADO":
      return "destructive";
  }
}

export function PedidosVentaTable({ data }: { data: PedidoVentaRow[] }) {
  const columns: ColumnDef<PedidoVentaRow>[] = [
    {
      id: "numero",
      header: "Número",
      cell: ({ row }) => (
        <Link
          href={`/ventas/pedidos/${row.original.id}`}
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
      id: "cliente",
      header: "Cliente",
      cell: ({ row }) => (
        <span className="text-sm">{row.original.cliente.nombre}</span>
      ),
    },
    {
      id: "fechaPrevista",
      header: "Prevista",
      cell: ({ row }) =>
        row.original.fechaPrevista ? (
          <span className="text-sm tabular-nums">
            {fmtDate(new Date(row.original.fechaPrevista))}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      id: "items",
      header: () => <span className="block text-right">Ítems</span>,
      cell: ({ row }) => (
        <span className="block text-right text-sm tabular-nums">
          {row.original.itemsCount}
        </span>
      ),
    },
    {
      id: "total",
      header: () => <span className="block text-right">Total est.</span>,
      cell: ({ row }) => (
        <span className="block text-right font-mono text-sm tabular-nums">
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
      <caption className="sr-only">Pedidos de venta (OV) registrados</caption>
      <TableHeader>
        {table.getHeaderGroups().map((hg) => (
          <TableRow key={hg.id}>
            {hg.headers.map((h) => (
              <TableHead key={h.id}>
                {flexRender(h.column.columnDef.header, h.getContext())}
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
              No hay pedidos de venta registrados todavía.
            </TableCell>
          </TableRow>
        ) : (
          table.getRowModel().rows.map((r) => (
            <TableRow key={r.id}>
              {r.getVisibleCells().map((c) => (
                <TableCell key={c.id}>
                  {flexRender(c.column.columnDef.cell, c.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
