"use client";

import { useRouter } from "next/navigation";
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";

import type { SimulacionRow } from "@/lib/actions/simulaciones-importacion";
import { fmtDate, fmtMontoPres } from "@/lib/format";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import type { Moneda } from "../../reportes/_components/moneda-toggle";

function formatDate(value: string): string {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "—";
  // Delega en fmtDate (timeZone UTC) para que SSR (UTC) y cliente (UTC-3)
  // rendericen el mismo string y evitar hydration mismatch (React #418).
  return fmtDate(d);
}

export function SimulacionesTable({
  data,
  pres,
  tc,
}: {
  data: SimulacionRow[];
  pres: Moneda;
  tc: string | null;
}) {
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
      // FOB es nativo en la moneda de la simulación → conversión native-aware.
      header: () => <span className="block text-right">FOB total ({pres})</span>,
      cell: ({ row }) => (
        <span className="block text-right font-mono text-sm tabular-nums">
          {fmtMontoPres(row.original.fobTotal, row.original.moneda, pres, tc)}
        </span>
      ),
    },
    {
      id: "costoTotalNacionalizado",
      // Costo nacionalizado ya viene consolidado en ARS (cada parcela × su TC)
      // → se trata como ARS-nativo y se convierte al TC de cierre.
      header: () => <span className="block text-right">Costo nacionalizado ({pres})</span>,
      cell: ({ row }) => (
        <span className="block text-right font-mono text-sm font-semibold tabular-nums">
          {fmtMontoPres(row.original.costoTotalNacionalizado, "ARS", pres, tc)}
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
