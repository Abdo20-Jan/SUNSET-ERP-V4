"use client";

/**
 * Column model (data-driven) de la worklist Comex de procesos (PR-020 / CX-02).
 *
 * 5 columnas CONGELADAS (Proceso · Proveedor · Status · ETA · FOB/CFR) +
 * 12 canónicas. Cada celda no trivial es un renderer nombrado de módulo para
 * mantener `buildEmbarquesColumns` en complejidad ciclomática baja (sólo arma el
 * array; el grid resuelve orden/visibilidad/paginación). La columna **Costo
 * Total** se incluye SÓLO si `verCosto` (gate `VER_COSTO_LANDED`) — omitida por
 * completo (ni "—") en caso contrario. Las columnas sin modelo de respaldo
 * (PI, CI, Puerto, Próxima acción, Responsable, Status documentos) muestran "—".
 */

import type { ColumnDef } from "@tanstack/react-table";

import { EntityLink } from "@/components/data-grid/entity-link";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import { fmtMoney } from "@/lib/format";
import type { EmbarqueWorklistRow } from "@/lib/actions/embarques";
import {
  type EtaTono,
  STATUS_PAGO_LABEL,
  TONO_STATUS_COSTO,
  TONO_STATUS_PAGO,
} from "@/lib/services/comex-worklist-derivaciones";

import { ContainerChip, TonoChip } from "./embarques-chips";

const DASH = "—";

function fmtFechaIso(iso: string | null): string {
  if (!iso) return DASH;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? DASH
    : new Intl.DateTimeFormat("es-AR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone: "UTC",
      }).format(d);
}

const ETA_CLASS: Record<EtaTono, string> = {
  overdue: "text-destructive font-medium",
  soon: "text-warning font-medium",
  none: "text-foreground",
};

function ProcesoCell({ row }: { row: EmbarqueWorklistRow }) {
  const href = `/comex/embarques/${row.id}`;
  return (
    <EntityLink
      label={row.codigo}
      href={href}
      tabLabel={row.codigo}
      menu={[
        { label: "Abrir", href },
        { label: "Ver proveedor", href: `/maestros/proveedores/${row.proveedor.id}` },
      ]}
    />
  );
}

function ProveedorCell({ row }: { row: EmbarqueWorklistRow }) {
  const href = `/maestros/proveedores/${row.proveedor.id}`;
  return (
    <EntityLink
      label={row.proveedor.nombre}
      href={href}
      tabLabel={row.proveedor.nombre}
      menu={[
        { label: "Ver ficha", href },
        { label: "Ver embarques", href: "/comex/embarques" },
      ]}
    />
  );
}

function EtaCell({ row }: { row: EmbarqueWorklistRow }) {
  return (
    <span className={cn("text-sm tabular-nums", ETA_CLASS[row.etaTono])}>
      {fmtFechaIso(row.fechaLlegada)}
    </span>
  );
}

// FOB/CFR siempre en USD (valor comercial); sub-línea con el valor nativo si ≠ USD.
function FobCell({ row }: { row: EmbarqueWorklistRow }) {
  return (
    <span className="flex flex-col items-end leading-tight">
      <span className="font-mono text-sm tabular-nums">{fmtMoney(row.fobUsd)} USD</span>
      {row.moneda !== "USD" ? (
        <span className="font-mono text-[10px] text-muted-foreground">
          {fmtMoney(row.fobTotal)} {row.moneda}
        </span>
      ) : null}
    </span>
  );
}

function ContainersCell({ row }: { row: EmbarqueWorklistRow }) {
  const items = row.contenedores;
  if (items.length === 0) return <span className="text-xs text-muted-foreground">{DASH}</span>;
  const shown = items.slice(0, 3);
  const extra = items.length - shown.length;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {shown.map((c) => (
        <ContainerChip key={c.numero} numero={c.numero} estado={c.estado} />
      ))}
      {extra > 0 ? <span className="text-[11px] text-muted-foreground">+{extra}</span> : null}
    </span>
  );
}

function NeumaticosCell({ row }: { row: EmbarqueWorklistRow }) {
  return (
    <span className="block text-right text-sm tabular-nums">{row.cantidadNeumaticos || DASH}</span>
  );
}

function StatusCostoCell({ row }: { row: EmbarqueWorklistRow }) {
  return <TonoChip tono={TONO_STATUS_COSTO[row.statusCosto]}>{row.statusCosto}</TonoChip>;
}

function StatusPagoCell({ row }: { row: EmbarqueWorklistRow }) {
  if (!row.statusPago) return <span className="text-xs text-muted-foreground">{DASH}</span>;
  return (
    <TonoChip tono={TONO_STATUS_PAGO[row.statusPago]}>{STATUS_PAGO_LABEL[row.statusPago]}</TonoChip>
  );
}

function BloqueoCell({ row }: { row: EmbarqueWorklistRow }) {
  if (!row.bloqueo) return <span className="text-xs text-muted-foreground">{DASH}</span>;
  return <TonoChip tono="danger">{row.bloqueo}</TonoChip>;
}

// updatedAt existe; el usuario NO (sin userId en Fase 1) → fecha + "—".
function ActualizacionCell({ row }: { row: EmbarqueWorklistRow }) {
  return (
    <span className="flex flex-col leading-tight tabular-nums">
      <span className="text-sm">{fmtFechaIso(row.updatedAt)}</span>
      <span className="text-[10px] text-muted-foreground">{DASH}</span>
    </span>
  );
}

function CostoCell({ row }: { row: EmbarqueWorklistRow }) {
  if (row.costoTotal == null) {
    return <span className="block text-right text-xs text-muted-foreground">{DASH}</span>;
  }
  return (
    <span className="block text-right font-mono text-sm font-semibold tabular-nums">
      {fmtMoney(row.costoTotal)} ARS
    </span>
  );
}

function PuertoCell({ row }: { row: EmbarqueWorklistRow }) {
  return <span className="text-sm">{row.lugarIncoterm ?? DASH}</span>;
}

// Placeholder "—" para columnas canónicas sin modelo de respaldo (flagadas en notas).
function DashCell() {
  return <span className="text-xs text-muted-foreground">{DASH}</span>;
}

export function buildEmbarquesColumns({
  verCosto,
}: {
  verCosto: boolean;
}): ColumnDef<EmbarqueWorklistRow, unknown>[] {
  const base: ColumnDef<EmbarqueWorklistRow, unknown>[] = [
    {
      accessorKey: "codigo",
      header: "Proceso",
      meta: { pinned: "left", width: 150, label: "Proceso" },
      cell: ({ row }) => <ProcesoCell row={row.original} />,
    },
    {
      id: "proveedor",
      accessorFn: (r) => r.proveedor.nombre,
      header: "Proveedor",
      meta: { pinned: "left", width: 200, label: "Proveedor" },
      cell: ({ row }) => <ProveedorCell row={row.original} />,
    },
    {
      accessorKey: "estado",
      header: "Status",
      meta: { pinned: "left", width: 140, label: "Status" },
      cell: ({ row }) => <StatusBadge estado={row.original.estado} />,
    },
    {
      id: "eta",
      accessorFn: (r) => r.fechaLlegada ?? "",
      header: "ETA",
      meta: { pinned: "left", width: 112, label: "ETA" },
      cell: ({ row }) => <EtaCell row={row.original} />,
    },
    {
      id: "fob",
      accessorFn: (r) => Number(r.fobUsd),
      header: () => <span className="block text-right">FOB/CFR (USD)</span>,
      meta: { pinned: "left", align: "right", width: 132, label: "FOB/CFR" },
      cell: ({ row }) => <FobCell row={row.original} />,
    },
    {
      id: "pi",
      header: "PI / Proforma",
      enableSorting: false,
      meta: { label: "PI / Proforma" },
      cell: DashCell,
    },
    {
      id: "ci",
      header: "Commercial Invoice",
      enableSorting: false,
      meta: { label: "Commercial Invoice" },
      cell: DashCell,
    },
    {
      id: "containers",
      accessorFn: (r) => r.contenedores.length,
      header: "Containers",
      meta: { width: 220, label: "Containers" },
      cell: ({ row }) => <ContainersCell row={row.original} />,
    },
    {
      id: "neumaticos",
      accessorFn: (r) => r.cantidadNeumaticos,
      header: () => <span className="block text-right">Cant. neumáticos</span>,
      meta: { align: "right", label: "Cant. neumáticos" },
      cell: ({ row }) => <NeumaticosCell row={row.original} />,
    },
    {
      id: "puerto",
      accessorFn: (r) => r.lugarIncoterm ?? "",
      header: "Puerto",
      meta: { label: "Puerto" },
      cell: ({ row }) => <PuertoCell row={row.original} />,
    },
    {
      id: "proxima",
      header: "Próxima acción",
      enableSorting: false,
      meta: { label: "Próxima acción" },
      cell: DashCell,
    },
    {
      id: "responsable",
      header: "Responsable",
      enableSorting: false,
      meta: { label: "Responsable" },
      cell: DashCell,
    },
    {
      id: "statusCosto",
      accessorFn: (r) => r.statusCosto,
      header: "Status costo",
      meta: { label: "Status costo" },
      cell: ({ row }) => <StatusCostoCell row={row.original} />,
    },
    {
      id: "statusDocs",
      header: "Status documentos",
      enableSorting: false,
      meta: { label: "Status documentos" },
      cell: DashCell,
    },
    {
      id: "statusPago",
      accessorFn: (r) => r.statusPago ?? "",
      header: "Status pago",
      meta: { label: "Status pago" },
      cell: ({ row }) => <StatusPagoCell row={row.original} />,
    },
    {
      id: "actualizacion",
      accessorFn: (r) => r.updatedAt,
      header: "Última actualización",
      meta: { width: 150, label: "Última actualización" },
      cell: ({ row }) => <ActualizacionCell row={row.original} />,
    },
    {
      id: "bloqueo",
      accessorFn: (r) => r.bloqueo ?? "",
      header: "Bloqueo",
      meta: { label: "Bloqueo" },
      cell: ({ row }) => <BloqueoCell row={row.original} />,
    },
  ];

  const costo: ColumnDef<EmbarqueWorklistRow, unknown> = {
    id: "costoTotal",
    accessorFn: (r) => Number(r.costoTotal ?? 0),
    header: () => <span className="block text-right">Costo Total (ARS)</span>,
    meta: { align: "right", width: 150, label: "Costo Total" },
    cell: ({ row }) => <CostoCell row={row.original} />,
  };

  return verCosto ? [...base, costo] : base;
}
