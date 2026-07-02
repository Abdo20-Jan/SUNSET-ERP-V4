"use client";

/**
 * Modelo de columnas (data-driven) de la worklist de cuentas a cobrar
 * (TES-03 · PR-025c). Espejo estructural de `saldos-proveedores-columns.tsx`
 * (PR-025b): cada celda no trivial es un renderer nombrado de módulo para
 * mantener `buildCuentasACobrarColumns` en complejidad ciclomática baja.
 *
 * Los DISPLAYS replican 1:1 el rendering legado de `page.tsx` (ClienteCard/
 * VentaRow): la agregación por bucket usa `fmtBucketPres` (transcripción
 * client-safe de `sumarBucketsNativos`+`convertirBucket`, paridad trabada por
 * test) y el saldo usa `pickSaldoNativo`+`fmtMontoPres` — mismas llamadas que
 * la página hacía. Sin columna de selección: CxC no tiene batch (read-only;
 * el único CTA es el Link "Cobrar" al flujo EXISTENTE de movimientos).
 *
 * Gate: TODA la superficie llega pre-gateada del server (`VER_SALDO` — la
 * page ni siquiera lee el aging sin permiso; proyección no-call).
 */

import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";

import { fmtMontoPres, pickSaldoNativo } from "@/lib/format";
import { buttonVariants } from "@/components/ui/button";
import { DateBadge } from "@/components/ui/date-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  cobrarHref,
  fmtBucketPres,
  mayorAtrasoDias,
  type SaldoClienteAgingRow,
  type VentaPendienteRow,
} from "./cuentas-a-cobrar-presentacion";
import type { Moneda } from "../../reportes/_components/moneda-toggle";

export type { SaldoClienteAgingRow, VentaPendienteRow };

const DASH = "—";

function ClienteCell({ c }: { c: SaldoClienteAgingRow }) {
  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex items-center gap-2">
        <span className="truncate font-medium">{c.clienteNombre}</span>
        {c.cuentaCodigo && (
          <span className="font-mono text-[11px] text-muted-foreground">{c.cuentaCodigo}</span>
        )}
      </div>
      {c.cuit && <span className="text-xs text-muted-foreground">CUIT {c.cuit}</span>}
    </div>
  );
}

function VencidoCell({
  c,
  moneda,
  tc,
}: {
  c: SaldoClienteAgingRow;
  moneda: Moneda;
  tc: string | null;
}) {
  if (Number(c.vencido) <= 0)
    return <span className="block text-right text-muted-foreground">{DASH}</span>;
  return (
    <span className="block text-right font-mono font-semibold tabular-nums text-red-700 dark:text-red-300">
      {fmtBucketPres(c.ventas, "vencida", moneda, tc)}
    </span>
  );
}

function ProximoCell({
  c,
  moneda,
  tc,
}: {
  c: SaldoClienteAgingRow;
  moneda: Moneda;
  tc: string | null;
}) {
  if (Number(c.proximo) <= 0)
    return <span className="block text-right text-muted-foreground">{DASH}</span>;
  return (
    <span className="block text-right font-mono tabular-nums text-amber-700 dark:text-amber-300">
      {fmtBucketPres(c.ventas, "proxima", moneda, tc)}
    </span>
  );
}

function AlDiaCell({
  c,
  moneda,
  tc,
}: {
  c: SaldoClienteAgingRow;
  moneda: Moneda;
  tc: string | null;
}) {
  if (Number(c.alDia) <= 0)
    return <span className="block text-right text-muted-foreground">{DASH}</span>;
  return (
    <span className="block text-right font-mono tabular-nums">
      {fmtBucketPres(c.ventas, "al_dia", moneda, tc)}
    </span>
  );
}

function MayorAtrasoCell({ c }: { c: SaldoClienteAgingRow }) {
  const atraso = mayorAtrasoDias(c.ventas);
  if (atraso === null)
    return <span className="block text-right text-muted-foreground">{DASH}</span>;
  return (
    <span className="block text-right font-mono tabular-nums text-red-700 dark:text-red-300">
      {atraso} {atraso === 1 ? "día" : "días"}
    </span>
  );
}

function SaldoContableCell({
  c,
  moneda,
  tc,
}: {
  c: SaldoClienteAgingRow;
  moneda: Moneda;
  tc: string | null;
}) {
  const saldoPick = pickSaldoNativo(c.saldoTotal, c.saldoTotalUsd);
  return (
    <span className="block text-right font-mono font-semibold tabular-nums">
      {fmtMontoPres(saldoPick.valor, saldoPick.monedaNativa, moneda, tc)}
    </span>
  );
}

function CobrarCell({ c }: { c: SaldoClienteAgingRow }) {
  return (
    <span className="flex justify-end">
      <Link href={cobrarHref(c)} className={buttonVariants({ variant: "outline", size: "sm" })}>
        <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} className="size-3.5" />
        Cobrar
      </Link>
    </span>
  );
}

// Mapas de presentación del bucket — verbatim del `VentaRow` legado.
const BUCKET_LABEL: Record<VentaPendienteRow["bucket"], string> = {
  vencida: "Vencida",
  proxima: "Próxima",
  al_dia: "Al día",
  sin_fecha: "—",
};

const BUCKET_CLASS: Record<VentaPendienteRow["bucket"], string> = {
  vencida:
    "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200",
  proxima:
    "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  al_dia:
    "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
  sin_fecha: "border-muted bg-muted/50 text-muted-foreground",
};

function VentaPendienteRowView({
  venta,
  moneda,
  tc,
}: {
  venta: VentaPendienteRow;
  moneda: Moneda;
  tc: string | null;
}) {
  const fechaVenc = venta.fechaVencimiento ? new Date(venta.fechaVencimiento) : null;
  const fecha = new Date(venta.fecha);

  return (
    <TableRow>
      <TableCell className="font-mono text-xs">
        <Link
          href={`/ventas/${venta.id}`}
          className="underline underline-offset-2 hover:text-foreground"
        >
          {venta.numero}
        </Link>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {fecha.toLocaleDateString("es-AR", { timeZone: "UTC" })}
      </TableCell>
      <TableCell>
        <DateBadge fecha={fechaVenc} />
      </TableCell>
      <TableCell>
        <span
          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${BUCKET_CLASS[venta.bucket]}`}
        >
          {BUCKET_LABEL[venta.bucket]}
        </span>
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums">
        {fmtMontoPres(venta.montoNativo, venta.moneda as Moneda, moneda, tc)}
      </TableCell>
    </TableRow>
  );
}

/**
 * Drill-down `renderExpanded` del grid: sub-tabla de ventas pendientes del
 * cliente, columnas VERBATIM del `VentaRow` legado (antes siempre visible;
 * ahora se expande por chevron — delta de UX espejo del de 025b).
 */
export function VentasPendientesTable({
  c,
  moneda,
  tc,
}: {
  c: SaldoClienteAgingRow;
  moneda: Moneda;
  tc: string | null;
}) {
  if (c.ventas.length === 0) {
    return <span className="px-2 text-xs text-muted-foreground">Sin ventas pendientes.</span>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-44">Venta</TableHead>
          <TableHead className="w-32">Fecha</TableHead>
          <TableHead className="w-32">Vencimiento</TableHead>
          <TableHead className="w-20">Estado</TableHead>
          <TableHead className="text-right">Pendiente</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {c.ventas.map((v) => (
          <VentaPendienteRowView key={v.id} venta={v} moneda={moneda} tc={tc} />
        ))}
      </TableBody>
    </Table>
  );
}

export function buildCuentasACobrarColumns({
  moneda,
  tc,
}: {
  moneda: Moneda;
  tc: string | null;
}): ColumnDef<SaldoClienteAgingRow, unknown>[] {
  return [
    {
      id: "cliente",
      accessorFn: (r) => r.clienteNombre,
      header: "Cliente",
      meta: { pinned: "left", width: 220, label: "Cliente" },
      cell: ({ row }) => <ClienteCell c={row.original} />,
    },
    {
      id: "vencido",
      accessorFn: (r) => Number(r.vencido),
      header: () => <span className="block text-right">Vencido</span>,
      meta: { align: "right", width: 130, label: "Vencido" },
      cell: ({ row }) => <VencidoCell c={row.original} moneda={moneda} tc={tc} />,
    },
    {
      id: "proximo",
      accessorFn: (r) => Number(r.proximo),
      header: () => <span className="block text-right">A vencer 7d</span>,
      meta: { align: "right", width: 130, label: "A vencer 7d" },
      cell: ({ row }) => <ProximoCell c={row.original} moneda={moneda} tc={tc} />,
    },
    {
      id: "alDia",
      accessorFn: (r) => Number(r.alDia),
      header: () => <span className="block text-right">Al día</span>,
      meta: { align: "right", width: 130, label: "Al día" },
      cell: ({ row }) => <AlDiaCell c={row.original} moneda={moneda} tc={tc} />,
    },
    {
      id: "mayorAtraso",
      accessorFn: (r) => mayorAtrasoDias(r.ventas) ?? 0,
      header: () => <span className="block text-right">Mayor atraso</span>,
      meta: { align: "right", width: 110, label: "Mayor atraso" },
      cell: ({ row }) => <MayorAtrasoCell c={row.original} />,
    },
    {
      id: "facturas",
      accessorFn: (r) => r.ventas.length,
      header: () => <span className="block text-right">Facturas</span>,
      meta: { align: "right", width: 90, label: "Facturas" },
      cell: ({ row }) => (
        <span className="block text-right font-mono tabular-nums">
          {row.original.ventas.length}
        </span>
      ),
    },
    {
      id: "saldoContable",
      accessorFn: (r) => Number(r.saldoTotal),
      header: () => <span className="block text-right">Saldo contable ({moneda})</span>,
      meta: { align: "right", width: 160, label: "Saldo contable" },
      cell: ({ row }) => <SaldoContableCell c={row.original} moneda={moneda} tc={tc} />,
    },
    {
      id: "acciones",
      enableSorting: false,
      header: () => <span className="sr-only">Acciones</span>,
      meta: { align: "right", width: 110, label: "Acciones" },
      cell: ({ row }) => <CobrarCell c={row.original} />,
    },
  ];
}
