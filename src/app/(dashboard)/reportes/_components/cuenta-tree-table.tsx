"use client";

import Link from "next/link";
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

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { fmtMoney } from "./money";
import type { SerializedTreeNode } from "./cuenta-tree-node";

export type { SerializedTreeNode } from "./cuenta-tree-node";

type Props = {
  data: SerializedTreeNode[];
  /** Si está presente, cuentas analíticas linkan a /reportes/libro-mayor?cuentaId=X&periodoId=N */
  periodoIdForLibroMayor?: number;
  /** Etiqueta del total final ("Total Activo", "Total Ingresos", etc.) */
  totalLabel?: string;
  /** Total precalculado (suma de los roots en el nivel superior) */
  totalValue?: string;
  /** Total de saldo inicial (suma de los roots) — para la fila total */
  totalSaldoInicial?: string;
  /** Mostrar columna "Saldo Inicial" antes de Debe (para Balance General con rango) */
  showSaldoInicial?: boolean;
};

const colCodigo: ColumnDef<SerializedTreeNode> = {
  id: "codigo",
  header: "Código",
  cell: ({ row }) => {
    const canExpand = row.getCanExpand();
    const r = row.original;
    return (
      <div
        className="flex items-center gap-1 font-mono text-xs"
        style={{ paddingLeft: `${row.depth * 16}px` }}
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
        <span>{r.codigo}</span>
      </div>
    );
  },
};

const colNombre: ColumnDef<SerializedTreeNode> = {
  id: "nombre",
  header: "Cuenta",
  cell: ({ row, table }) => {
    const r = row.original;
    const opts = table.options.meta as
      | { periodoIdForLibroMayor?: number }
      | undefined;
    const periodoId = opts?.periodoIdForLibroMayor;
    if (r.tipo === "ANALITICA" && periodoId != null) {
      return (
        <Link
          href={`/reportes/libro-mayor?cuentaId=${r.id}&periodoId=${periodoId}`}
          className="text-primary underline-offset-2 hover:underline"
        >
          {r.nombre}
        </Link>
      );
    }
    return (
      <span className={cn(r.tipo === "SINTETICA" && "font-semibold")}>
        {r.nombre}
      </span>
    );
  },
};

const colSaldoInicial: ColumnDef<SerializedTreeNode> = {
  id: "saldoInicial",
  header: () => <span className="block text-right">Saldo Inicial</span>,
  cell: ({ row }) => (
    <span
      className={cn(
        "block text-right font-mono text-xs tabular-nums",
        row.original.tipo === "SINTETICA" && "font-semibold",
      )}
    >
      {fmtMoney(row.original.saldoInicial)}
    </span>
  ),
};

const colDebe: ColumnDef<SerializedTreeNode> = {
  id: "debe",
  header: () => <span className="block text-right">Debe</span>,
  cell: ({ row }) => (
    <span className="block text-right font-mono text-xs tabular-nums">
      {fmtMoney(row.original.debe)}
    </span>
  ),
};

const colHaber: ColumnDef<SerializedTreeNode> = {
  id: "haber",
  header: () => <span className="block text-right">Haber</span>,
  cell: ({ row }) => (
    <span className="block text-right font-mono text-xs tabular-nums">
      {fmtMoney(row.original.haber)}
    </span>
  ),
};

const colSaldo: ColumnDef<SerializedTreeNode> = {
  id: "saldo",
  header: () => <span className="block text-right">Saldo</span>,
  cell: ({ row }) => (
    <span
      className={cn(
        "block text-right font-mono text-xs tabular-nums",
        row.original.tipo === "SINTETICA" && "font-semibold",
      )}
    >
      {fmtMoney(row.original.saldo)}
    </span>
  ),
};

export function CuentaTreeTable({
  data,
  periodoIdForLibroMayor,
  totalLabel,
  totalValue,
  totalSaldoInicial,
  showSaldoInicial = false,
}: Props) {
  const columns = showSaldoInicial
    ? [colCodigo, colNombre, colSaldoInicial, colDebe, colHaber, colSaldo]
    : [colCodigo, colNombre, colDebe, colHaber, colSaldo];
  const [expanded, setExpanded] = useState<ExpandedState>(() => {
    const init: Record<string, boolean> = {};
    data.forEach((_, i) => {
      init[String(i)] = true;
    });
    return init;
  });

  const table = useReactTable<SerializedTreeNode>({
    data,
    columns,
    state: { expanded },
    onExpandedChange: setExpanded,
    getSubRows: (row) => (row.children.length > 0 ? row.children : undefined),
    getRowCanExpand: (row) => row.original.children.length > 0,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    meta: { periodoIdForLibroMayor },
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
              Sin cuentas para mostrar.
            </TableCell>
          </TableRow>
        ) : (
          table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id} className="py-2">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))
        )}
        {totalLabel && totalValue != null ? (
          <TableRow className="border-t-2 bg-muted/50 hover:bg-muted/50">
            <TableCell colSpan={2} className="py-3 font-semibold">
              {totalLabel}
            </TableCell>
            {showSaldoInicial ? (
              <TableCell className="py-3 text-right font-mono text-sm font-bold tabular-nums">
                {totalSaldoInicial != null ? fmtMoney(totalSaldoInicial) : ""}
              </TableCell>
            ) : null}
            <TableCell colSpan={2} />
            <TableCell className="py-3 text-right font-mono text-sm font-bold tabular-nums">
              {fmtMoney(totalValue)}
            </TableCell>
          </TableRow>
        ) : null}
      </TableBody>
    </Table>
  );
}

