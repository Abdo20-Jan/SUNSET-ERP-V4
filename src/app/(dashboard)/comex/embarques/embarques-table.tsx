"use client";

import { useRouter } from "next/navigation";
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";

import type { EmbarqueEstado } from "@/generated/prisma/client";
import type { EmbarqueRow } from "@/lib/actions/embarques";
import { convertirMonto, fmtMontoPres } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import type { Moneda } from "../../reportes/_components/moneda-toggle";

const ESTADO_LABELS: Record<EmbarqueEstado, string> = {
  BORRADOR: "Borrador",
  EN_TRANSITO: "En tránsito",
  EN_PUERTO: "En puerto",
  EN_ZONA_PRIMARIA: "En zona primaria",
  EN_ADUANA: "En aduana",
  DESPACHADO: "Despachado",
  EN_DEPOSITO: "En depósito",
  CERRADO: "Cerrado",
};

function estadoVariant(estado: EmbarqueEstado): "default" | "outline" | "secondary" {
  switch (estado) {
    case "BORRADOR":
      return "outline";
    case "CERRADO":
      return "default";
    default:
      return "secondary";
  }
}

function formatCosto(value: string): string | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return null;
  return n.toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function EmbarquesTable({
  data,
  pres,
  tc,
}: {
  data: EmbarqueRow[];
  pres: Moneda;
  tc: string | null;
}) {
  const router = useRouter();

  const columns: ColumnDef<EmbarqueRow>[] = [
    {
      id: "codigo",
      header: "Código",
      cell: ({ row }) => (
        <span className="font-mono text-sm font-medium">{row.original.codigo}</span>
      ),
    },
    {
      id: "proveedor",
      header: "Proveedor",
      cell: ({ row }) => (
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-medium">{row.original.proveedor.nombre}</span>
          <span className="text-xs text-muted-foreground">{row.original.proveedor.pais}</span>
        </div>
      ),
    },
    {
      id: "estado",
      header: "Estado",
      cell: ({ row }) => (
        <Badge variant={estadoVariant(row.original.estado)}>
          {ESTADO_LABELS[row.original.estado]}
        </Badge>
      ),
    },
    {
      id: "moneda",
      header: "Moneda",
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">{row.original.moneda}</span>
      ),
    },
    {
      id: "incoterm",
      header: "Incoterm",
      cell: ({ row }) => {
        const inc = row.original.incoterm;
        if (!inc) return <span className="text-xs text-muted-foreground">—</span>;
        return (
          <span className="font-mono text-xs">
            {inc}
            {row.original.lugarIncoterm && (
              <span className="ml-1 text-muted-foreground">· {row.original.lugarIncoterm}</span>
            )}
          </span>
        );
      },
    },
    {
      id: "fobTotal",
      // FOB es nativo en la moneda del embarque → conversión native-aware.
      header: () => <span className="block text-right">FOB Total ({pres})</span>,
      cell: ({ row }) => (
        <span className="block text-right font-mono text-sm tabular-nums">
          {fmtMontoPres(row.original.fobTotal, row.original.moneda, pres, tc)}
        </span>
      ),
    },
    {
      id: "cifTotal",
      // CIF y Costo ya vienen consolidados en ARS (cada parcela × su TC) →
      // se tratan como ARS-nativos y se convierten al TC de cierre.
      header: () => <span className="block text-right">CIF Total ({pres})</span>,
      cell: ({ row }) => (
        <span className="block text-right font-mono text-sm tabular-nums">
          {fmtMontoPres(row.original.cifTotal, "ARS", pres, tc)}
        </span>
      ),
    },
    {
      id: "costoTotal",
      header: () => <span className="block text-right">Costo Total ({pres})</span>,
      cell: ({ row }) => {
        const costo = formatCosto(convertirMonto(row.original.costoTotal, "ARS", pres, tc));
        if (!costo) {
          return <span className="block text-right text-xs text-muted-foreground">—</span>;
        }
        return (
          <span className="block text-right font-mono text-sm font-semibold tabular-nums">
            {costo}
          </span>
        );
      },
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
              Todavía no hay embarques registrados.
            </TableCell>
          </TableRow>
        ) : (
          table.getRowModel().rows.map((row) => (
            <TableRow
              key={row.id}
              className="cursor-pointer"
              onClick={() => router.push(`/comex/embarques/${row.original.id}`)}
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
