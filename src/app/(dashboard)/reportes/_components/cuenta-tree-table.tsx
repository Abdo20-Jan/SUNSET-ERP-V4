"use client";

import Link from "next/link";
import { useState } from "react";
import {
  type ColumnDef,
  type ExpandedState,
  type Row,
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
import { convertirAUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

import { fmtMoney } from "./money";
import type { SerializedTreeNode } from "./cuenta-tree-node";

export type { SerializedTreeNode } from "./cuenta-tree-node";

type Props = {
  data: SerializedTreeNode[];
  totalLabel?: string;
  totalValue?: string;
  totalSaldoInicial?: string;
  showSaldoInicial?: boolean;
  tcParaUsd?: string | null;
};

// Format con paréntesis y signo coloreado para saldos.
function renderSigned(value: string, tc: string | null | undefined) {
  const converted = convertirAUsd(value, tc);
  const num = Number(converted);
  if (!Number.isFinite(num) || num === 0) {
    return <span className="text-muted-foreground">{fmtMoney(converted)}</span>;
  }
  const abs = fmtMoney(Math.abs(num).toFixed(2));
  if (num < 0) {
    return <span className="text-rose-600 dark:text-rose-400">({abs})</span>;
  }
  return <span className="text-emerald-700 dark:text-emerald-400">{abs}</span>;
}

function fmt(value: string, tc: string | null | undefined): string {
  return fmtMoney(convertirAUsd(value, tc));
}

// Niveles → estilo de fila. Profundidad 0 = raíz (sintética máxima).
function rowClasses(row: Row<SerializedTreeNode>): string {
  const r = row.original;
  const depth = row.depth;
  if (r.tipo === "SINTETICA" && depth === 0) {
    return "bg-slate-900 text-slate-50 hover:bg-slate-900 dark:bg-slate-800";
  }
  if (r.tipo === "SINTETICA" && depth === 1) {
    return "bg-muted/60 hover:bg-muted/70 font-semibold";
  }
  if (r.tipo === "SINTETICA") {
    return "bg-muted/30 hover:bg-muted/40";
  }
  // Analítica con zebra suave (alterna por índice de fila)
  return row.index % 2 === 0
    ? "hover:bg-muted/40"
    : "bg-muted/10 hover:bg-muted/40";
}

const colCodigo: ColumnDef<SerializedTreeNode> = {
  id: "codigo",
  header: "Código",
  cell: ({ row }) => {
    const canExpand = row.getCanExpand();
    const r = row.original;
    return (
      <div
        className={cn(
          "flex items-center gap-1 font-mono text-xs",
          row.depth === 0 && r.tipo === "SINTETICA" && "text-sm font-bold",
        )}
        style={{ paddingLeft: `${row.depth * 18}px` }}
      >
        {canExpand ? (
          <button
            type="button"
            onClick={row.getToggleExpandedHandler()}
            className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-background/30"
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
  cell: ({ row }) => {
    const r = row.original;
    const isRoot = row.depth === 0 && r.tipo === "SINTETICA";
    if (r.tipo === "ANALITICA") {
      return (
        <Link
          href={`/reportes/libro-mayor?cuentaId=${r.id}`}
          className="text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {r.nombre}
        </Link>
      );
    }
    return (
      <span
        className={cn(
          "font-medium",
          isRoot ? "text-sm font-bold uppercase tracking-wide" : "",
          r.tipo === "SINTETICA" && row.depth >= 1 ? "font-semibold" : "",
        )}
      >
        {r.nombre}
      </span>
    );
  },
};

function makeColSaldoInicial(
  tc: string | null | undefined,
): ColumnDef<SerializedTreeNode> {
  return {
    id: "saldoInicial",
    header: () => <span className="block text-right">Saldo Inicial</span>,
    cell: ({ row }) => (
      <span
        className={cn(
          "block text-right font-mono text-xs tabular-nums",
          row.original.tipo === "SINTETICA" && "font-semibold",
        )}
      >
        {renderSigned(row.original.saldoInicial, tc)}
      </span>
    ),
  };
}

function makeColDebe(
  tc: string | null | undefined,
): ColumnDef<SerializedTreeNode> {
  return {
    id: "debe",
    header: () => <span className="block text-right">Debe</span>,
    cell: ({ row }) => (
      <span className="block text-right font-mono text-xs tabular-nums text-muted-foreground">
        {fmt(row.original.debe, tc)}
      </span>
    ),
  };
}

function makeColHaber(
  tc: string | null | undefined,
): ColumnDef<SerializedTreeNode> {
  return {
    id: "haber",
    header: () => <span className="block text-right">Haber</span>,
    cell: ({ row }) => (
      <span className="block text-right font-mono text-xs tabular-nums text-muted-foreground">
        {fmt(row.original.haber, tc)}
      </span>
    ),
  };
}

function makeColSaldo(
  tc: string | null | undefined,
): ColumnDef<SerializedTreeNode> {
  return {
    id: "saldo",
    header: () => <span className="block text-right">Saldo</span>,
    cell: ({ row }) => (
      <span
        className={cn(
          "block text-right font-mono text-xs tabular-nums",
          row.original.tipo === "SINTETICA" && "font-semibold",
          row.depth === 0 && row.original.tipo === "SINTETICA" && "text-sm",
        )}
      >
        {renderSigned(row.original.saldo, tc)}
      </span>
    ),
  };
}

export function CuentaTreeTable({
  data,
  totalLabel,
  totalValue,
  totalSaldoInicial,
  showSaldoInicial = false,
  tcParaUsd,
}: Props) {
  const colSaldoInicial = makeColSaldoInicial(tcParaUsd);
  const colDebe = makeColDebe(tcParaUsd);
  const colHaber = makeColHaber(tcParaUsd);
  const colSaldo = makeColSaldo(tcParaUsd);
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
  });

  return (
    <Table>
      <TableHeader>
        {table.getHeaderGroups().map((headerGroup) => (
          <TableRow key={headerGroup.id} className="border-b-2">
            {headerGroup.headers.map((header) => (
              <TableHead
                key={header.id}
                className="text-xs font-semibold uppercase tracking-wide"
              >
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
            <TableRow key={row.id} className={rowClasses(row)}>
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id} className="py-1.5">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))
        )}
        {totalLabel && totalValue != null ? (
          <TableRow className="border-t-4 border-double bg-slate-900 text-slate-50 hover:bg-slate-900 dark:bg-slate-800">
            <TableCell colSpan={2} className="py-3 text-sm font-bold uppercase tracking-wide">
              {totalLabel}
            </TableCell>
            {showSaldoInicial ? (
              <TableCell className="py-3 text-right font-mono text-sm font-bold tabular-nums">
                {totalSaldoInicial != null
                  ? renderSigned(totalSaldoInicial, tcParaUsd)
                  : ""}
              </TableCell>
            ) : null}
            <TableCell colSpan={2} />
            <TableCell className="py-3 text-right font-mono text-sm font-bold tabular-nums">
              {renderSigned(totalValue, tcParaUsd)}
            </TableCell>
          </TableRow>
        ) : null}
      </TableBody>
    </Table>
  );
}
