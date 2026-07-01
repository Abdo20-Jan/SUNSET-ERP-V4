"use client";

/**
 * Modelo de columnas (data-driven) de la worklist de cuentas bancarias
 * (TES-01 · PR-025a). Cada celda no trivial es un renderer nombrado de módulo
 * para mantener `buildCuentasColumns` en complejidad ciclomática baja. La
 * columna **Saldo** se incluye SÓLO si `verSaldo` (gate `VER_SALDO`) — omitida
 * por completo (ni "—") en caso contrario; el server ya envía `saldo: null`.
 */

import type { ColumnDef } from "@tanstack/react-table";

import type { Moneda, TipoCuentaBancaria } from "@/generated/prisma/client";
import { fmtMontoPres } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import type { CuentaBancariaWorklistRow } from "@/lib/services/cuenta-bancaria-worklist";

const DASH = "—";

const TIPO_LABEL: Record<TipoCuentaBancaria, string> = {
  CUENTA_CORRIENTE: "Cuenta Corriente",
  CAJA_AHORRO: "Caja de Ahorro",
  CAJA_CHICA: "Caja Chica",
};

function BancoCell({ row }: { row: CuentaBancariaWorklistRow }) {
  return <span className="text-sm font-medium">{row.banco}</span>;
}

function TipoCell({ row }: { row: CuentaBancariaWorklistRow }) {
  return (
    <Badge variant="outline" className="text-xs">
      {TIPO_LABEL[row.tipo]}
    </Badge>
  );
}

function CbuAliasCell({ row }: { row: CuentaBancariaWorklistRow }) {
  const { cbu, alias } = row;
  if (!cbu && !alias) return <span className="text-xs text-muted-foreground">{DASH}</span>;
  return (
    <div className="flex flex-col text-xs">
      {cbu ? <span className="font-mono">{cbu}</span> : null}
      {alias ? <span className="font-mono text-muted-foreground">{alias}</span> : null}
    </div>
  );
}

function CuentaContableCell({ row }: { row: CuentaBancariaWorklistRow }) {
  return (
    <div className="flex flex-col text-xs">
      <span className="font-mono">{row.cuentaContableCodigo}</span>
      <span className="text-muted-foreground">{row.cuentaContableNombre}</span>
    </div>
  );
}

function SaldoCell({
  row,
  moneda,
  tc,
}: {
  row: CuentaBancariaWorklistRow;
  moneda: Moneda;
  tc: string | null;
}) {
  if (row.saldo == null)
    return <span className="block text-right text-xs text-muted-foreground">{DASH}</span>;
  return (
    <span className="block text-right font-mono text-sm tabular-nums">
      {fmtMontoPres(row.saldo, row.moneda, moneda, tc)}{" "}
      <span className="text-xs text-muted-foreground">{moneda}</span>
    </span>
  );
}

export function buildCuentasColumns({
  verSaldo,
  moneda,
  tc,
}: {
  verSaldo: boolean;
  moneda: Moneda;
  tc: string | null;
}): ColumnDef<CuentaBancariaWorklistRow, unknown>[] {
  const base: ColumnDef<CuentaBancariaWorklistRow, unknown>[] = [
    {
      accessorKey: "banco",
      header: "Banco",
      meta: { pinned: "left", width: 200, label: "Banco" },
      cell: ({ row }) => <BancoCell row={row.original} />,
    },
    {
      accessorKey: "tipo",
      header: "Tipo",
      meta: { width: 150, label: "Tipo" },
      cell: ({ row }) => <TipoCell row={row.original} />,
    },
    {
      accessorKey: "moneda",
      header: "Moneda",
      meta: { width: 90, label: "Moneda" },
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.moneda}</span>,
    },
    {
      accessorKey: "numero",
      header: "Número",
      meta: { label: "Número" },
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.numero ?? DASH}</span>,
    },
    {
      id: "cbuAlias",
      header: "CBU / Alias",
      enableSorting: false,
      meta: { label: "CBU / Alias" },
      cell: ({ row }) => <CbuAliasCell row={row.original} />,
    },
    {
      id: "cuentaContable",
      accessorFn: (r) => r.cuentaContableCodigo,
      header: "Cuenta contable",
      meta: { width: 200, label: "Cuenta contable" },
      cell: ({ row }) => <CuentaContableCell row={row.original} />,
    },
  ];

  const saldo: ColumnDef<CuentaBancariaWorklistRow, unknown> = {
    id: "saldo",
    accessorFn: (r) => Number(r.saldo ?? 0),
    header: () => <span className="block text-right">Saldo</span>,
    meta: { align: "right", width: 150, label: "Saldo" },
    cell: ({ row }) => <SaldoCell row={row.original} moneda={moneda} tc={tc} />,
  };

  return verSaldo ? [...base, saldo] : base;
}
