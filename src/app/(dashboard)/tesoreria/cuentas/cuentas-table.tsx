"use client";

import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";

import type {
  CuentaBancariaRow,
  CuentaContableOption,
} from "@/lib/actions/cuentas-bancarias";
import type { Moneda, TipoCuentaBancaria } from "@/generated/prisma/client";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { NuevaCuentaButton } from "./nueva-cuenta-sheet";

const TIPO_LABEL: Record<TipoCuentaBancaria, string> = {
  CUENTA_CORRIENTE: "Cuenta Corriente",
  CAJA_AHORRO: "Caja de Ahorro",
  CAJA_CHICA: "Caja Chica",
};

function formatMoney(value: string, moneda: Moneda): string {
  const num = Number(value);
  const formatted = new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
  return `${formatted} ${moneda}`;
}

export function CuentasBancariasTable({
  data,
  cuentasContables,
}: {
  data: CuentaBancariaRow[];
  cuentasContables: CuentaContableOption[];
}) {
  const columns: ColumnDef<CuentaBancariaRow>[] = [
    {
      id: "banco",
      header: "Banco",
      cell: ({ row }) => (
        <span className="text-sm font-medium">{row.original.banco}</span>
      ),
    },
    {
      id: "tipo",
      header: "Tipo",
      cell: ({ row }) => (
        <Badge variant="outline" className="text-xs">
          {TIPO_LABEL[row.original.tipo]}
        </Badge>
      ),
    },
    {
      id: "moneda",
      header: "Moneda",
      cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.moneda}</span>
      ),
    },
    {
      id: "numero",
      header: "Número",
      cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.numero}</span>
      ),
    },
    {
      id: "cbuAlias",
      header: "CBU / Alias",
      cell: ({ row }) => {
        const { cbu, alias } = row.original;
        if (!cbu && !alias) {
          return <span className="text-xs text-muted-foreground">—</span>;
        }
        return (
          <div className="flex flex-col text-xs">
            {cbu && <span className="font-mono">{cbu}</span>}
            {alias && (
              <span className="font-mono text-muted-foreground">{alias}</span>
            )}
          </div>
        );
      },
    },
    {
      id: "cuentaContable",
      header: "Cuenta contable",
      cell: ({ row }) => (
        <div className="flex flex-col text-xs">
          <span className="font-mono">{row.original.cuentaContableCodigo}</span>
          <span className="text-muted-foreground">
            {row.original.cuentaContableNombre}
          </span>
        </div>
      ),
    },
    {
      id: "saldo",
      header: () => <span className="block text-right">Saldo</span>,
      cell: ({ row }) => (
        <span className="block text-right font-mono text-sm tabular-nums">
          {formatMoney(row.original.saldo, row.original.moneda)}
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
    <>
      <div className="flex items-center justify-between px-6 pt-6">
        <h2 className="text-base font-medium">Listado</h2>
        <NuevaCuentaButton cuentasContables={cuentasContables} />
      </div>
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
                No hay cuentas bancarias cargadas.
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
    </>
  );
}
