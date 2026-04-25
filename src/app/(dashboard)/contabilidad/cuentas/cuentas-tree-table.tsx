"use client";

import { useState } from "react";
import {
  type ColumnDef,
  type ExpandedState,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";

import type { CuentaContable } from "@/generated/prisma/client";
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

// Rótulos da UI vs schema:
//   Coluna "Tipo"      = schema.categoria (ACTIVO/PASIVO/PATRIMONIO/INGRESO/EGRESO)
//   Coluna "Categoría" = schema.tipo      (SINTETICA/ANALITICA)
export type CuentaNode = CuentaContable & { children?: CuentaNode[] };

const columns: ColumnDef<CuentaNode>[] = [
  {
    id: "codigo",
    header: "Código",
    cell: ({ row }) => {
      const canExpand = row.getCanExpand();
      return (
        <div
          className="flex items-center gap-1 font-mono text-xs"
          style={{ paddingLeft: `${row.depth * 20}px` }}
        >
          {canExpand ? (
            <button
              type="button"
              onClick={row.getToggleExpandedHandler()}
              className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-muted"
              aria-label={row.getIsExpanded() ? "Recolher" : "Expandir"}
            >
              <HugeiconsIcon
                icon={row.getIsExpanded() ? ArrowDown01Icon : ArrowRight01Icon}
                className="size-4"
              />
            </button>
          ) : (
            <span className="inline-block size-5 shrink-0" />
          )}
          <span>{row.original.codigo}</span>
        </div>
      );
    },
  },
  {
    id: "nombre",
    header: "Nombre",
    cell: ({ row }) => (
      <span
        className={cn(row.original.tipo === "SINTETICA" && "font-semibold")}
      >
        {row.original.nombre}
      </span>
    ),
  },
  {
    id: "tipo",
    header: "Tipo",
    cell: ({ row }) => (
      <Badge variant="secondary">{row.original.categoria}</Badge>
    ),
  },
  {
    id: "categoria",
    header: "Categoría",
    cell: ({ row }) => <Badge variant="outline">{row.original.tipo}</Badge>,
  },
  {
    id: "estado",
    header: "Estado",
    cell: ({ row }) => (
      <Badge variant={row.original.activa ? "default" : "destructive"}>
        {row.original.activa ? "ACTIVA" : "INACTIVA"}
      </Badge>
    ),
  },
];

export function CuentasTreeTable({ data }: { data: CuentaNode[] }) {
  const [expanded, setExpanded] = useState<ExpandedState>({
    "0": true,
    "1": true,
    "2": true,
    "3": true,
    "4": true,
  });

  const table = useReactTable({
    data,
    columns,
    state: { expanded },
    onExpandedChange: setExpanded,
    getSubRows: (row) => row.children,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
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
        {table.getRowModel().rows.map((row) => (
          <TableRow key={row.id}>
            {row.getVisibleCells().map((cell) => (
              <TableCell key={cell.id}>
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
