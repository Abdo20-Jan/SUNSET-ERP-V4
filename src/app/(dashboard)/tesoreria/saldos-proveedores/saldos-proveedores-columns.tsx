"use client";

/**
 * Modelo de columnas (data-driven) de la worklist de saldos por proveedor
 * (TES-02 · PR-025b). Cada celda no trivial es un renderer nombrado de módulo
 * para mantener `buildSaldosProveedoresColumns` en complejidad ciclomática baja.
 *
 * Selección/override viajan por `BatchPagoContext` (NO por deps de la factory):
 * las columnas se memoizan sólo con `[moneda, tc]` — meter `selected`/
 * `montosOverride` en las deps remonta la celda en cada tecla y el Input de
 * "A pagar" pierde el foco (verificado contra flexRender/TanStack 8.21).
 *
 * Gate: TODA la superficie llega pre-gateada del server (`VER_SALDO` — la page
 * ni siquiera lee el aging sin permiso). Los displays replican 1:1 el rendering
 * de `saldos-batch-pago.tsx` (mantida en árbol, no importada — rollback).
 */

import { createContext, useContext } from "react";
import type { ColumnDef, Table as TanstackTable } from "@tanstack/react-table";
import Link from "next/link";
import Decimal from "decimal.js";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight02Icon } from "@hugeicons/core-free-icons";

import { convertirMonto, fmtMoney, fmtMontoPres, pickSaldoNativo } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DateBadge } from "@/components/ui/date-badge";
import { Input } from "@/components/ui/input";
import type { Moneda } from "../../reportes/_components/moneda-toggle";

export type FacturaPendiente = {
  origen: "compra" | "embarque" | "gasto";
  id: string;
  numero: string;
  fecha: string;
  fechaVencimiento: string | null;
  diasParaVencer: number | null;
  bucket: "vencida" | "proxima" | "al_dia" | "sin_fecha";
  monto: string; // ARS — usado en la lógica de pago (no presentación)
  montoNativo: string; // pendiente en moneda nativa — para displays de lectura
  moneda: string;
};

export type SaldoProveedorAging = {
  proveedorId: string;
  proveedorNombre: string;
  cuit: string | null;
  pais: string;
  cuentaContableId: number | null;
  saldoTotal: string; // ARS contable — usado en la lógica de pago
  saldoTotalUsd?: string; // USD nativo via monedaOrigen — para displays
  vencido: string;
  proximo: string;
  alDia: string;
  facturas: FacturaPendiente[];
};

export type ProveedorIntermediario = {
  proveedorId: string;
  proveedorNombre: string;
  cuentaContableId: number | null;
};

// Suma los pendientes de un bucket POR MONEDA NATIVA y los convierte a la
// moneda de presentación (lección #262/#263) — versión client-safe (Decimal +
// convertirMonto puros; no usa @/lib/aging-presentacion, que arrastra Prisma).
export function fmtBucketPres(
  facturas: FacturaPendiente[],
  bucket: FacturaPendiente["bucket"],
  moneda: Moneda,
  tc: string | null,
): string {
  let total = new Decimal(0);
  for (const f of facturas) {
    // sin_fecha colapsa en al_dia (paridad con el servicio legado).
    const fb = f.bucket === "sin_fecha" ? "al_dia" : f.bucket;
    if (fb !== bucket) continue;
    total = total.plus(convertirMonto(f.montoNativo, f.moneda as Moneda, moneda, tc));
  }
  return fmtMoney(total.toFixed(2));
}

/**
 * Estado vivo del batch (selección + overrides) — via Context para que las
 * columnas queden estables (deps sólo `[moneda, tc]`).
 */
export type BatchPagoContextValue = {
  selected: ReadonlySet<string>;
  montosOverride: Readonly<Record<string, string>>;
  toggle: (proveedorId: string) => void;
  setMonto: (proveedorId: string, valor: string) => void;
  /** Reemplaza la selección entera (select-all / limpiar — semántica legada). */
  replaceSelection: (proveedorIds: string[]) => void;
};

export const BatchPagoContext = createContext<BatchPagoContextValue | null>(null);

function useBatchPago(): BatchPagoContextValue {
  const ctx = useContext(BatchPagoContext);
  if (!ctx) throw new Error("BatchPagoContext ausente — envolver con el provider de la worklist.");
  return ctx;
}

const DASH = "—";

function SelectAllHeader({ table }: { table: TanstackTable<SaldoProveedorAging> }) {
  const { selected, replaceSelection } = useBatchPago();
  // Filas VISIBLES (búsqueda/chips aplicados) de todas las páginas, sólo las
  // seleccionables (con cuenta contable) — evolución filter-aware del
  // `allSelectableIds` legado.
  const selectableIds = table
    .getPrePaginationRowModel()
    .rows.filter((r) => r.original.cuentaContableId !== null)
    .map((r) => r.original.proveedorId);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const someSelected = selectableIds.some((id) => selected.has(id));
  return (
    <Checkbox
      checked={allSelected}
      indeterminate={someSelected && !allSelected}
      onCheckedChange={() => replaceSelection(allSelected ? [] : selectableIds)}
      aria-label="Seleccionar todos"
    />
  );
}

function SeleccionCell({ p }: { p: SaldoProveedorAging }) {
  const { selected, toggle } = useBatchPago();
  return (
    <Checkbox
      checked={selected.has(p.proveedorId)}
      onCheckedChange={() => toggle(p.proveedorId)}
      disabled={!p.cuentaContableId}
      aria-label={`Seleccionar ${p.proveedorNombre}`}
    />
  );
}

function ProveedorCell({ p }: { p: SaldoProveedorAging }) {
  return (
    <div className="flex flex-col">
      <span className="font-medium">{p.proveedorNombre}</span>
      <span className="font-mono text-xs text-muted-foreground">
        {p.cuit ?? DASH} · {p.pais}
      </span>
    </div>
  );
}

function VencidoCell({
  p,
  moneda,
  tc,
}: {
  p: SaldoProveedorAging;
  moneda: Moneda;
  tc: string | null;
}) {
  if (Number(p.vencido) <= 0)
    return <span className="block text-right text-muted-foreground">{DASH}</span>;
  return (
    <span className="block text-right font-mono font-semibold tabular-nums text-red-700 dark:text-red-300">
      {fmtBucketPres(p.facturas, "vencida", moneda, tc)}
    </span>
  );
}

function ProximoCell({
  p,
  moneda,
  tc,
}: {
  p: SaldoProveedorAging;
  moneda: Moneda;
  tc: string | null;
}) {
  if (Number(p.proximo) <= 0)
    return <span className="block text-right text-muted-foreground">{DASH}</span>;
  return (
    <span className="block text-right font-mono tabular-nums text-amber-700 dark:text-amber-300">
      {fmtBucketPres(p.facturas, "proxima", moneda, tc)}
    </span>
  );
}

function AlDiaCell({
  p,
  moneda,
  tc,
}: {
  p: SaldoProveedorAging;
  moneda: Moneda;
  tc: string | null;
}) {
  if (Number(p.alDia) <= 0)
    return <span className="block text-right text-muted-foreground">{DASH}</span>;
  return (
    <span className="block text-right font-mono tabular-nums">
      {fmtBucketPres(p.facturas, "al_dia", moneda, tc)}
    </span>
  );
}

function SaldoContableCell({
  p,
  moneda,
  tc,
}: {
  p: SaldoProveedorAging;
  moneda: Moneda;
  tc: string | null;
}) {
  const saldoPick = pickSaldoNativo(p.saldoTotal, p.saldoTotalUsd);
  return (
    <span className="block text-right font-mono tabular-nums">
      {fmtMontoPres(saldoPick.valor, saldoPick.monedaNativa, moneda, tc)}
    </span>
  );
}

function APagarCell({ p }: { p: SaldoProveedorAging }) {
  const { selected, montosOverride, setMonto } = useBatchPago();
  if (!selected.has(p.proveedorId)) {
    return <span className="block text-right font-mono text-xs tabular-nums">{DASH}</span>;
  }
  return (
    <Input
      type="text"
      inputMode="decimal"
      className="h-7 text-right font-mono text-xs tabular-nums"
      value={montosOverride[p.proveedorId] ?? p.saldoTotal}
      onChange={(e) => setMonto(p.proveedorId, e.target.value)}
    />
  );
}

function PagarSoloCell({ p }: { p: SaldoProveedorAging }) {
  return (
    <span className="flex justify-end">
      <Link
        href={
          p.cuentaContableId
            ? `/tesoreria/movimientos/nuevo?${new URLSearchParams({
                tipo: "PAGO",
                cuentaContableId: String(p.cuentaContableId),
                monto: p.saldoTotal,
                descripcion: `Pago a ${p.proveedorNombre}${p.facturas.length > 0 ? ` — ${p.facturas.length} factura(s)` : ""}`,
              }).toString()}`
            : "/tesoreria/movimientos/nuevo?tipo=PAGO"
        }
        className={buttonVariants({ variant: "outline", size: "sm" })}
      >
        Pagar solo
        <HugeiconsIcon icon={ArrowRight02Icon} strokeWidth={2} />
      </Link>
    </span>
  );
}

/**
 * Chips de facturas pendientes (drill-down `renderExpanded` del grid). Antes
 * era una fila extra SIEMPRE visible; ahora se expande por chevron (delta de
 * UX documentado en las notas). Contenido idéntico al legado.
 */
export function FacturasChips({
  p,
  moneda,
  tc,
}: {
  p: SaldoProveedorAging;
  moneda: Moneda;
  tc: string | null;
}) {
  if (p.facturas.length === 0) {
    return <span className="px-2 text-xs text-muted-foreground">Sin facturas pendientes.</span>;
  }
  return (
    <div className="flex flex-wrap gap-2 px-2">
      {p.facturas.slice(0, 8).map((f) => (
        <span
          key={`${f.origen}-${f.id}`}
          className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs"
        >
          <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
            {f.origen === "compra" ? "C" : f.origen === "gasto" ? "G" : "EMB"}
          </Badge>
          <span className="font-mono">{f.numero}</span>
          <span className="font-mono text-muted-foreground tabular-nums">
            {fmtMontoPres(f.montoNativo, f.moneda as Moneda, moneda, tc)}
          </span>
          <DateBadge fecha={f.fechaVencimiento} relative />
        </span>
      ))}
      {p.facturas.length > 8 && (
        <span className="text-xs text-muted-foreground">+{p.facturas.length - 8} más</span>
      )}
    </div>
  );
}

export function buildSaldosProveedoresColumns({
  moneda,
  tc,
}: {
  moneda: Moneda;
  tc: string | null;
}): ColumnDef<SaldoProveedorAging, unknown>[] {
  return [
    {
      id: "sel",
      enableSorting: false,
      enableHiding: false,
      meta: { pinned: "left", width: 36, label: "Selección" },
      header: ({ table }) => <SelectAllHeader table={table} />,
      cell: ({ row }) => <SeleccionCell p={row.original} />,
    },
    {
      id: "proveedor",
      accessorFn: (r) => r.proveedorNombre,
      header: "Proveedor",
      meta: { pinned: "left", width: 220, label: "Proveedor" },
      cell: ({ row }) => <ProveedorCell p={row.original} />,
    },
    {
      id: "vencido",
      accessorFn: (r) => Number(r.vencido),
      header: () => <span className="block text-right">Vencido</span>,
      meta: { align: "right", width: 130, label: "Vencido" },
      cell: ({ row }) => <VencidoCell p={row.original} moneda={moneda} tc={tc} />,
    },
    {
      id: "proximo",
      accessorFn: (r) => Number(r.proximo),
      header: () => <span className="block text-right">A vencer 7d</span>,
      meta: { align: "right", width: 130, label: "A vencer 7d" },
      cell: ({ row }) => <ProximoCell p={row.original} moneda={moneda} tc={tc} />,
    },
    {
      id: "alDia",
      accessorFn: (r) => Number(r.alDia),
      header: () => <span className="block text-right">Al día</span>,
      meta: { align: "right", width: 130, label: "Al día" },
      cell: ({ row }) => <AlDiaCell p={row.original} moneda={moneda} tc={tc} />,
    },
    {
      id: "saldoContable",
      accessorFn: (r) => Number(r.saldoTotal),
      header: () => <span className="block text-right">Saldo contable ({moneda})</span>,
      meta: { align: "right", width: 160, label: "Saldo contable" },
      cell: ({ row }) => <SaldoContableCell p={row.original} moneda={moneda} tc={tc} />,
    },
    {
      id: "aPagar",
      enableSorting: false,
      enableHiding: false,
      header: () => <span className="block text-right">A pagar (ARS)</span>,
      meta: { align: "right", width: 140, label: "A pagar (ARS)" },
      cell: ({ row }) => <APagarCell p={row.original} />,
    },
    {
      id: "acciones",
      enableSorting: false,
      header: () => <span className="sr-only">Acciones</span>,
      meta: { align: "right", width: 130, label: "Acciones" },
      cell: ({ row }) => <PagarSoloCell p={row.original} />,
    },
  ];
}
