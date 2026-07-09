"use client";

/**
 * Modelo de columnas (data-driven) de la worklist canónica de compras.
 * Espejo estructural de `fin-cxc-columns.tsx` (PR-026): cada celda no trivial
 * es un renderer nombrado de módulo (CCN baja — gate Codacy) y el pinning va
 * por `meta.pinned` (número + proveedor + estado congelados).
 *
 * Paridad con la tabla simple que reemplaza (`compras-table.tsx`): el
 * vencimiento relativo aplica SÓLO a EMITIDA y el total va tachado en
 * CANCELADA. El display del total es native-first (`fmtMontoPres` sobre el
 * total nativo — lección #262/#263). La columna "Pedido (OC)" cierra el ciclo
 * OC↔factura con el vínculo inyectado por la page (cero queries acá).
 */

import type { ColumnDef } from "@tanstack/react-table";

import { fmtDate, fmtMontoPres } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DateBadge } from "@/components/ui/date-badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { EntityLink } from "@/components/data-grid/entity-link";

import type { CompraWorklistRow } from "./compras-presentacion";
import type { Moneda } from "../../reportes/_components/moneda-toggle";

const DASH = "—";

function NumeroCell({ r }: { r: CompraWorklistRow }) {
  return <EntityLink label={r.numero} href={`/compras/${r.id}`} tabLabel={r.numero} />;
}

function ProveedorCell({ r }: { r: CompraWorklistRow }) {
  return (
    <EntityLink
      label={r.proveedorNombre}
      href={`/maestros/proveedores/${r.proveedorId}`}
      tabLabel={r.proveedorNombre}
    />
  );
}

function EstadoCell({ r }: { r: CompraWorklistRow }) {
  return <StatusBadge estado={r.estado} />;
}

function FechaCell({ r }: { r: CompraWorklistRow }) {
  return <span className="text-sm tabular-nums">{fmtDate(new Date(r.fecha))}</span>;
}

// Paridad con la tabla legada: la píldora relativa sólo aplica a EMITIDA
// (BORRADOR no corre plazos y RECIBIDA/CANCELADA ya no tienen vencimiento
// operativo).
function VencimientoCell({ r }: { r: CompraWorklistRow }) {
  if (r.estado !== "EMITIDA") {
    return <span className="text-xs text-muted-foreground">{DASH}</span>;
  }
  return <DateBadge fecha={r.fechaVencimiento} relative />;
}

function PedidoCell({ r }: { r: CompraWorklistRow }) {
  if (!r.pedido) {
    return <span className="text-xs text-muted-foreground">{DASH}</span>;
  }
  return (
    <EntityLink
      label={r.pedido.numero}
      href={`/compras/pedidos/${r.pedido.id}`}
      tabLabel={r.pedido.numero}
    />
  );
}

function MonedaCell({ r }: { r: CompraWorklistRow }) {
  return <span className="font-mono text-xs">{r.moneda}</span>;
}

function TotalCell({ r, moneda, tc }: { r: CompraWorklistRow; moneda: Moneda; tc: string | null }) {
  return (
    <span
      className={cn(
        "block text-right font-mono text-sm tabular-nums",
        r.estado === "CANCELADA" && "line-through opacity-60",
      )}
    >
      {fmtMontoPres(r.total, r.moneda, moneda, tc)}
    </span>
  );
}

export function buildComprasColumns({
  moneda,
  tc,
}: {
  moneda: Moneda;
  tc: string | null;
}): ColumnDef<CompraWorklistRow, unknown>[] {
  return [
    {
      id: "numero",
      accessorFn: (r) => r.numero,
      header: "Número",
      meta: { pinned: "left", width: 140, label: "Número" },
      cell: ({ row }) => <NumeroCell r={row.original} />,
    },
    {
      id: "proveedor",
      accessorFn: (r) => r.proveedorNombre,
      header: "Proveedor",
      meta: { pinned: "left", width: 200, label: "Proveedor" },
      cell: ({ row }) => <ProveedorCell r={row.original} />,
    },
    {
      // `id`/campo top-level "estado": el chip del QuickFilter compara contra
      // `row.estado` (ver `matchesActiveFilters` en data-grid-helpers).
      id: "estado",
      accessorFn: (r) => r.estado,
      header: "Estado",
      meta: { pinned: "left", width: 110, label: "Estado" },
      cell: ({ row }) => <EstadoCell r={row.original} />,
    },
    {
      id: "fecha",
      accessorFn: (r) => r.fecha,
      header: "Fecha",
      meta: { width: 100, label: "Fecha" },
      cell: ({ row }) => <FechaCell r={row.original} />,
    },
    {
      id: "vencimiento",
      // `undefined` + sortUndefined:"last" fija sin-fecha AL FINAL en asc y
      // desc (convención PR-026; "" ordenaría antes de todo ISO).
      accessorFn: (r) => r.fechaVencimiento ?? undefined,
      sortUndefined: "last",
      header: "Vencimiento",
      meta: { width: 130, label: "Vencimiento" },
      cell: ({ row }) => <VencimientoCell r={row.original} />,
    },
    {
      id: "pedido",
      accessorFn: (r) => r.pedido?.numero ?? undefined,
      sortUndefined: "last",
      header: "Pedido (OC)",
      meta: { width: 130, label: "Pedido (OC)" },
      cell: ({ row }) => <PedidoCell r={row.original} />,
    },
    {
      id: "moneda",
      accessorFn: (r) => r.moneda,
      header: "Moneda",
      meta: { width: 70, label: "Moneda" },
      cell: ({ row }) => <MonedaCell r={row.original} />,
    },
    {
      id: "total",
      accessorFn: (r) => Number(r.total),
      header: () => <span className="block text-right">Total ({moneda})</span>,
      meta: { align: "right", width: 140, label: "Total" },
      cell: ({ row }) => <TotalCell r={row.original} moneda={moneda} tc={tc} />,
    },
  ];
}
