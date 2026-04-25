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
import { format } from "date-fns";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";

import type {
  BalanceLinea,
  BalanceNode,
} from "@/lib/services/balance-sumas-saldos";
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

type Row = BalanceNode | BalanceLinea;

const fmt = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function fmtMoney(s: string) {
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n)) return s;
  return fmt.format(n);
}

function fmtCredito(s: string) {
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n) || n === 0) return fmt.format(0);
  return `(${fmt.format(n)})`;
}

function isCuenta(row: Row): row is BalanceNode {
  return row.kind === "cuenta";
}

const columns: ColumnDef<Row>[] = [
  {
    id: "codigo",
    header: "Código",
    cell: ({ row }) => {
      const canExpand = row.getCanExpand();
      const r = row.original;
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
          <span>
            {isCuenta(r) ? r.codigo : format(r.fecha, "yyyy-MM-dd")}
          </span>
        </div>
      );
    },
  },
  {
    id: "nombre",
    header: "Cuenta / Transacción",
    cell: ({ row }) => {
      const r = row.original;
      if (isCuenta(r)) {
        return (
          <span className={cn(r.tipo === "SINTETICA" && "font-semibold")}>
            {r.nombre}
          </span>
        );
      }
      return (
        <span className="text-xs italic text-muted-foreground">
          Transacción: {r.descripcion}
        </span>
      );
    },
  },
  {
    id: "tipo",
    header: "Tipo",
    cell: ({ row }) => {
      const r = row.original;
      if (isCuenta(r)) {
        return (
          <Badge variant={r.tipo === "SINTETICA" ? "secondary" : "outline"}>
            {r.tipo === "SINTETICA" ? "SINTÉTICO" : "ANALÍTICO"}
          </Badge>
        );
      }
      return (
        <Link
          href={`/contabilidad/asientos/${r.asientoId}`}
          className="font-mono text-xs text-primary underline-offset-2 hover:underline"
        >
          Asiento #{r.asientoNumero}
        </Link>
      );
    },
  },
  {
    id: "saldoInicial",
    header: () => <span className="block text-right">Saldo Inicial</span>,
    cell: ({ row }) => {
      const r = row.original;
      if (!isCuenta(r)) return null;
      return (
        <span className="block text-right font-mono text-xs tabular-nums">
          {fmtMoney(r.saldoInicial)}
        </span>
      );
    },
  },
  {
    id: "credito",
    header: () => <span className="block text-right">Crédito</span>,
    cell: ({ row }) => {
      const r = row.original;
      const value = isCuenta(r) ? r.haber : r.haber;
      return (
        <span className="block text-right font-mono text-xs tabular-nums text-rose-700 dark:text-rose-400">
          {fmtCredito(value)}
        </span>
      );
    },
  },
  {
    id: "debito",
    header: () => <span className="block text-right">Débito</span>,
    cell: ({ row }) => {
      const r = row.original;
      const value = isCuenta(r) ? r.debe : r.debe;
      return (
        <span className="block text-right font-mono text-xs tabular-nums">
          {fmtMoney(value)}
        </span>
      );
    },
  },
  {
    id: "saldoFinal",
    header: () => <span className="block text-right">Saldo Final</span>,
    cell: ({ row }) => {
      const r = row.original;
      const value = isCuenta(r) ? r.saldoFinal : r.saldoAcumulado;
      return (
        <span
          className={cn(
            "block text-right font-mono text-xs tabular-nums",
            isCuenta(r) && r.tipo === "SINTETICA" && "font-semibold",
          )}
        >
          {fmtMoney(value)}
        </span>
      );
    },
  },
];

function getSubRows(row: Row): Row[] | undefined {
  if (!isCuenta(row)) return undefined;
  if (row.tipo === "SINTETICA") return row.children as Row[] | undefined;
  return row.lineas as Row[] | undefined;
}

export function BalanceTreeTable({ root }: { root: BalanceNode[] }) {
  // Expande apenas o primeiro nível (raízes) por padrão.
  const [expanded, setExpanded] = useState<ExpandedState>(() => {
    const init: Record<string, boolean> = {};
    root.forEach((_, i) => {
      init[String(i)] = true;
    });
    return init;
  });

  const table = useReactTable<Row>({
    data: root as Row[],
    columns,
    state: { expanded },
    onExpandedChange: setExpanded,
    getSubRows,
    getRowCanExpand: (row) => {
      const r = row.original;
      if (!isCuenta(r)) return false;
      if (r.tipo === "SINTETICA") return (r.children?.length ?? 0) > 0;
      return (r.lineas?.length ?? 0) > 0;
    },
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
            <TableRow
              key={row.id}
              className={cn(
                !isCuenta(row.original) && "bg-muted/30",
              )}
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
