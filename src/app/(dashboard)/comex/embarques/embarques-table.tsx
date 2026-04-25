"use client";

import { useRouter } from "next/navigation";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";

import type { EmbarqueEstado } from "@/generated/prisma/client";
import type { EmbarqueRow } from "@/lib/actions/embarques";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const ESTADO_LABELS: Record<EmbarqueEstado, string> = {
  BORRADOR: "Borrador",
  EN_TRANSITO: "En tránsito",
  EN_PUERTO: "En puerto",
  EN_ADUANA: "En aduana",
  DESPACHADO: "Despachado",
  EN_DEPOSITO: "En depósito",
  CERRADO: "Cerrado",
};

function estadoVariant(
  estado: EmbarqueEstado,
): "default" | "outline" | "secondary" {
  switch (estado) {
    case "BORRADOR":
      return "outline";
    case "CERRADO":
      return "default";
    default:
      return "secondary";
  }
}

function formatMoney(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return n.toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatCosto(value: string): string | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return null;
  return n.toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function EmbarquesTable({ data }: { data: EmbarqueRow[] }) {
  const router = useRouter();

  const columns: ColumnDef<EmbarqueRow>[] = [
    {
      id: "codigo",
      header: "Código",
      cell: ({ row }) => (
        <span className="font-mono text-sm font-medium">
          {row.original.codigo}
        </span>
      ),
    },
    {
      id: "proveedor",
      header: "Proveedor",
      cell: ({ row }) => (
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-medium">
            {row.original.proveedor.nombre}
          </span>
          <span className="text-xs text-muted-foreground">
            {row.original.proveedor.pais}
          </span>
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
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.moneda}
        </span>
      ),
    },
    {
      id: "fobTotal",
      header: () => <span className="block text-right">FOB Total</span>,
      cell: ({ row }) => (
        <span className="block text-right font-mono text-sm tabular-nums">
          {formatMoney(row.original.fobTotal)}
        </span>
      ),
    },
    {
      id: "cifTotal",
      header: () => <span className="block text-right">CIF Total</span>,
      cell: ({ row }) => (
        <span className="block text-right font-mono text-sm tabular-nums">
          {formatMoney(row.original.cifTotal)}
        </span>
      ),
    },
    {
      id: "costoTotal",
      header: () => <span className="block text-right">Costo Total</span>,
      cell: ({ row }) => {
        const costo = formatCosto(row.original.costoTotal);
        if (!costo) {
          return (
            <span className="block text-right text-xs text-muted-foreground">
              —
            </span>
          );
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
              Todavía no hay embarques registrados.
            </TableCell>
          </TableRow>
        ) : (
          table.getRowModel().rows.map((row) => (
            <TableRow
              key={row.id}
              className="cursor-pointer"
              onClick={() =>
                router.push(`/comex/embarques/${row.original.id}`)
              }
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
