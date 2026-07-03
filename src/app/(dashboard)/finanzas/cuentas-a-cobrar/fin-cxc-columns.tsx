"use client";

/**
 * Modelo de columnas (data-driven) de la worklist de gestión de cuentas a
 * cobrar (FIN-01 · PR-026). Espejo estructural de
 * `cuentas-a-cobrar-columns.tsx` (PR-025c): cada celda no trivial es un
 * renderer nombrado de módulo (CCN baja — gate Codacy) y el pinning va por
 * `meta.pinned` (canon OD-06: cliente + factura + estado congelados).
 *
 * Read-only: los displays son native-first (`fmtMontoPres` sobre
 * `montoNativo` — lección #262/#263); "Estado" es DERIVADO del bucket del
 * motor (los 9 estados de la spec no tienen backing model — FIN-03).
 * El expand REUSA la `VentasPendientesTable` de 025c con el padre completo
 * anidado en la fila. El único CTA es el Link "Cobrar" al flujo EXISTENTE
 * (`cobrarHref` VERBATIM de 025c — por cliente, saldo contable total).
 *
 * Deuda heredada documentada (025b/c): el sort-key de la columna monetaria es
 * el agregado ARS del servicio (`Number(monto)`, TC de emisión) mientras el
 * display es native-first al TC de cierre — en multimoneda el orden puede
 * divergir del exhibido (corregir junto con las páginas 025, no acá).
 */

import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";

import { fmtMontoPres } from "@/lib/format";
import { buttonVariants } from "@/components/ui/button";
import { DateBadge } from "@/components/ui/date-badge";
import { EntityLink } from "@/components/data-grid/entity-link";

import { cobrarHref } from "../../tesoreria/cuentas-a-cobrar/cuentas-a-cobrar-presentacion";
import { VentasPendientesTable } from "../../tesoreria/cuentas-a-cobrar/cuentas-a-cobrar-columns";
import {
  BUCKET_CLASS,
  BUCKET_LABEL,
  type VentaPendienteFlatRow,
  type VentaPendienteRow,
} from "./fin-cxc-presentacion";
import type { Moneda } from "../../reportes/_components/moneda-toggle";

export type { VentaPendienteFlatRow };

const DASH = "—";

// Orden semántico del bucket para el sort de la columna Estado (no alfabético).
const BUCKET_RANK: Record<VentaPendienteRow["bucket"], number> = {
  vencida: 0,
  proxima: 1,
  al_dia: 2,
  sin_fecha: 3,
};

function ClienteCell({ f }: { f: VentaPendienteFlatRow }) {
  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex items-center gap-2">
        <EntityLink
          label={f.clienteNombre}
          href={`/maestros/clientes/${f.cliente.clienteId}`}
          tabLabel={f.clienteNombre}
        />
        {f.cliente.cuentaCodigo && (
          <span className="font-mono text-[11px] text-muted-foreground">
            {f.cliente.cuentaCodigo}
          </span>
        )}
      </div>
      {f.cuit && <span className="text-xs text-muted-foreground">CUIT {f.cuit}</span>}
    </div>
  );
}

function FacturaCell({ f }: { f: VentaPendienteFlatRow }) {
  return <EntityLink label={f.numero} href={`/ventas/${f.id}`} tabLabel={f.numero} />;
}

function EstadoCell({ f }: { f: Pick<VentaPendienteRow, "bucket"> }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${BUCKET_CLASS[f.bucket]}`}
    >
      {BUCKET_LABEL[f.bucket]}
    </span>
  );
}

// Días de atraso (canon OD-06: ámbar 1–15, rojo > 15). Sólo presentación —
// `diasParaVencer` viene clasificado del motor (negativo = vencida hace N).
function DiasAtrasoCell({ f }: { f: Pick<VentaPendienteRow, "diasParaVencer"> }) {
  if (f.diasParaVencer === null || f.diasParaVencer >= 0) {
    return <span className="block text-right text-muted-foreground">{DASH}</span>;
  }
  const atraso = -f.diasParaVencer;
  const tone =
    atraso > 15 ? "text-red-700 dark:text-red-300" : "text-amber-700 dark:text-amber-300";
  return (
    <span className={`block text-right font-mono tabular-nums ${tone}`}>
      {atraso} {atraso === 1 ? "día" : "días"}
    </span>
  );
}

function SaldoCell({
  f,
  moneda,
  tc,
}: {
  f: VentaPendienteFlatRow;
  moneda: Moneda;
  tc: string | null;
}) {
  return (
    <span className="block text-right font-mono font-semibold tabular-nums">
      {fmtMontoPres(f.montoNativo, f.moneda as Moneda, moneda, tc)}
    </span>
  );
}

function CobrarCell({ f }: { f: VentaPendienteFlatRow }) {
  return (
    <span className="flex justify-end">
      <Link
        href={cobrarHref(f.cliente)}
        className={buttonVariants({ variant: "outline", size: "sm" })}
      >
        <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} className="size-3.5" />
        Cobrar
      </Link>
    </span>
  );
}

/**
 * Drill-down `renderExpanded` del grid: TODOS los pendientes del MISMO
 * cliente via la `VentasPendientesTable` REUSADA de 025c (el padre viaja
 * anidado en la fila — cero queries nuevas). Los recibos parciales del canon
 * NO están en el DTO (el motor los reconstruye internamente) — FIN-03, no se
 * fabrican.
 */
export function VentasClienteExpand({
  f,
  moneda,
  tc,
}: {
  f: VentaPendienteFlatRow;
  moneda: Moneda;
  tc: string | null;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="px-2 text-xs text-muted-foreground">
        Pendientes de {f.clienteNombre} ({f.cliente.ventas.length})
      </span>
      <VentasPendientesTable c={f.cliente} moneda={moneda} tc={tc} />
    </div>
  );
}

export function buildFinCxcColumns({
  moneda,
  tc,
}: {
  moneda: Moneda;
  tc: string | null;
}): ColumnDef<VentaPendienteFlatRow, unknown>[] {
  return [
    {
      id: "cliente",
      accessorFn: (r) => r.clienteNombre,
      header: "Cliente",
      meta: { pinned: "left", width: 200, label: "Cliente" },
      cell: ({ row }) => <ClienteCell f={row.original} />,
    },
    {
      id: "factura",
      accessorFn: (r) => r.numero,
      header: "Factura",
      meta: { pinned: "left", width: 140, label: "Factura" },
      cell: ({ row }) => <FacturaCell f={row.original} />,
    },
    {
      id: "estado",
      accessorFn: (r) => BUCKET_RANK[r.bucket],
      header: "Estado",
      meta: { pinned: "left", width: 100, label: "Estado" },
      cell: ({ row }) => <EstadoCell f={row.original} />,
    },
    {
      id: "vencimiento",
      // `undefined` + sortUndefined:"last" fija sin-fecha AL FINAL en asc y
      // desc (convención de porUrgencia; "" ordenaría antes de todo ISO).
      accessorFn: (r) => r.fechaVencimiento ?? undefined,
      sortUndefined: "last",
      header: "Vencimiento",
      meta: { width: 120, label: "Vencimiento" },
      cell: ({ row }) => (
        <DateBadge
          fecha={row.original.fechaVencimiento ? new Date(row.original.fechaVencimiento) : null}
        />
      ),
    },
    {
      id: "diasAtraso",
      accessorFn: (r) =>
        r.diasParaVencer !== null && r.diasParaVencer < 0 ? -r.diasParaVencer : 0,
      header: () => <span className="block text-right">Días atraso</span>,
      meta: { align: "right", width: 100, label: "Días atraso" },
      cell: ({ row }) => <DiasAtrasoCell f={row.original} />,
    },
    {
      id: "moneda",
      accessorFn: (r) => r.moneda,
      header: "Moneda",
      meta: { width: 80, label: "Moneda" },
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.moneda}</span>,
    },
    {
      id: "saldo",
      accessorFn: (r) => Number(r.monto),
      header: () => <span className="block text-right">Saldo ({moneda})</span>,
      meta: { align: "right", width: 140, label: "Saldo" },
      cell: ({ row }) => <SaldoCell f={row.original} moneda={moneda} tc={tc} />,
    },
    {
      id: "acciones",
      enableSorting: false,
      header: () => <span className="sr-only">Acciones</span>,
      meta: { align: "right", width: 110, label: "Acciones" },
      cell: ({ row }) => <CobrarCell f={row.original} />,
    },
  ];
}
