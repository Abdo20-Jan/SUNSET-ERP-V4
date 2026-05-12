"use client";

import { useRouter } from "next/navigation";
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";

import type { SimulacionRow } from "@/lib/actions/simulaciones-importacion";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function formatMoney(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return n.toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(value: string): string {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Argentina/Buenos_Aires",
  });
}

export function SimulacionesTable({ data }: { data: SimulacionRow[] }) {
  const router = useRouter();

  const columns: ColumnDef<SimulacionRow>[] = [
    {
      id: "codigo",
      header: "Código",
      cell: ({ row }) => (
        <div className="flex flex-col leading-tight">
          <span className="font-mono text-sm font-medium">{row.original.codigo}</span>
          {row.original.nombre && (
            <span className="text-xs text-muted-foreground">{row.original.nombre}</span>
          )}
        </div>
      ),
    },
    {
      id: "proveedor",
      header: "Proveedor",
      cell: ({ row }) => {
        const p = row.original.proveedor;
        if (!p) return <span className="text-xs text-muted-foreground">—</span>;
        return (
          <div className="flex flex-col leading-tight">
            <span className="text-sm">{p.nombre}</span>
            <span className="text-xs text-muted-foreground">{p.pais}</span>
          </div>
        );
      },
    },
    {
      id: "moneda",
      header: "Moneda",
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.moneda}
          {row.original.moneda === "USD" && (
            <span className="ml-1">@ {row.original.tipoCambio}</span>
          )}
        </span>
      ),
    },
    {
      id: "incoterm",
      header: "Incoterm",
      cell: ({ row }) =>
        row.original.incoterm ? (
          <span className="font-mono text-xs">{row.original.incoterm}</span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      id: "items",
      header: () => <span className="block text-right">Ítems</span>,
      cell: ({ row }) => (
        <span className="block text-right font-mono text-xs text-muted-foreground">
          {row.original.itemsCount}
        </span>
      ),
    },
    {
      id: "fobTotal",
      header: () => <span className="block text-right">FOB total</span>,
      cell: ({ row }) => (
        <span className="block text-right font-mono text-sm tabular-nums">
          {formatMoney(row.original.fobTotal)}
        </span>
      ),
    },
    {
      id: "costoTotalNacionalizado",
      header: () => <span className="block text-right">Costo nacionalizado (ARS)</span>,
      cell: ({ row }) => (
        <span className="block text-right font-mono text-sm font-semibold tabular-nums">
          {formatMoney(row.original.costoTotalNacionalizado)}
        </span>
      ),
    },
    {
      id: "createdAt",
      header: () => <span className="block text-right">Creada</span>,
      cell: ({ row }) => (
        <span className="block text-right font-mono text-xs text-muted-foreground">
          {formatDate(row.original.createdAt)}
        </span>
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
        {table.getRowModel().rows.length === 0 ? (
          <TableRow>
            <TableCell
              colSpan={columns.length}
              className="py-12 text-center text-sm text-muted-foreground"
            >
              No hay simulaciones registradas. Cree la primera para evaluar costos de importación
              sin generar asientos.
            </TableCell>
          </TableRow>
        ) : (
          table.getRowModel().rows.map((row) => (
            <TableRow
              key={row.id}
              className="cursor-pointer"
              onClick={() => router.push(`/comex/simulaciones/${row.original.id}`)}
            >
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
