"use client";

/**
 * Modelo de columnas (data-driven) de la worklist de pedidos de compra
 * (COMP-01 · PR-029). Espejo estructural de `fin-cxc-columns.tsx` (PR-026):
 * cada celda no trivial es un renderer nombrado de módulo (CCN baja — gate
 * Codacy/Lizard) y el pinning va por `meta.pinned` (OC + proveedor + estado
 * congelados). Canon consume-or-omit: sólo columnas con backing model.
 *
 * Read-only: el total es display native-first (`fmtMontoPres` sobre el total
 * NATIVO del pedido — nunca se divide por TC a mano); `estado` usa el
 * StatusBadge semántico compartido. Deuda documentada (idem FIN-01): el
 * sort-key de la columna Total es la magnitud nativa (`Number(r.total)`) —
 * en multimoneda el orden puede divergir del display convertido.
 */

import type { ColumnDef } from "@tanstack/react-table";

import { EntityLink } from "@/components/data-grid/entity-link";
import { DateBadge } from "@/components/ui/date-badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { fmtDate, fmtMontoPres } from "@/lib/format";

import type { PedidoCompraWorklistRow } from "./pedidos-compra-presentacion";
import type { Moneda } from "../../../reportes/_components/moneda-toggle";

export type { PedidoCompraWorklistRow };

const DASH = "—";

function NumeroCell({ r }: { r: PedidoCompraWorklistRow }) {
  return <EntityLink label={r.numero} href={`/compras/pedidos/${r.id}`} tabLabel={r.numero} />;
}

function ProveedorCell({ r }: { r: PedidoCompraWorklistRow }) {
  return (
    <EntityLink
      label={r.proveedorNombre}
      href={`/maestros/proveedores/${r.proveedorId}`}
      tabLabel={r.proveedorNombre}
    />
  );
}

function EstadoCell({ r }: { r: PedidoCompraWorklistRow }) {
  return <StatusBadge estado={r.estado} />;
}

function FechaCell({ r }: { r: PedidoCompraWorklistRow }) {
  return <span className="text-sm tabular-nums">{fmtDate(new Date(r.fecha))}</span>;
}

function PrevistaCell({ r }: { r: PedidoCompraWorklistRow }) {
  return <DateBadge fecha={r.fechaPrevista} relative />;
}

function MonedaCell({ r }: { r: PedidoCompraWorklistRow }) {
  return <span className="font-mono text-xs">{r.moneda}</span>;
}

function TotalCell({
  r,
  moneda,
  tc,
}: {
  r: PedidoCompraWorklistRow;
  moneda: Moneda;
  tc: string | null;
}) {
  return (
    <span className="block text-right font-mono tabular-nums">
      {fmtMontoPres(r.total, r.moneda, moneda, tc)}
    </span>
  );
}

function ItemsCell({ r }: { r: PedidoCompraWorklistRow }) {
  return <span className="block text-right text-sm tabular-nums">{r.itemsCount}</span>;
}

// Compras vinculadas: "—" cuando el pedido todavía no generó ninguna.
function ComprasCell({ r }: { r: PedidoCompraWorklistRow }) {
  if (r.comprasCount === 0) {
    return <span className="block text-right text-xs text-muted-foreground">{DASH}</span>;
  }
  return <span className="block text-right text-sm tabular-nums">{r.comprasCount}</span>;
}

export function buildPedidosCompraColumns({
  moneda,
  tc,
}: {
  moneda: Moneda;
  tc: string | null;
}): ColumnDef<PedidoCompraWorklistRow, unknown>[] {
  return [
    {
      id: "numero",
      accessorFn: (r) => r.numero,
      header: "OC",
      meta: { pinned: "left", width: 140, label: "OC" },
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
      id: "fechaPrevista",
      // `undefined` + sortUndefined:"last" fija sin-fecha AL FINAL en asc y
      // desc ("" ordenaría antes de todo ISO).
      accessorFn: (r) => r.fechaPrevista ?? undefined,
      sortUndefined: "last",
      header: "Prevista",
      meta: { width: 120, label: "Prevista" },
      cell: ({ row }) => <PrevistaCell r={row.original} />,
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
      header: () => <span className="block text-right">Total est.</span>,
      meta: { align: "right", width: 130, label: "Total est." },
      cell: ({ row }) => <TotalCell r={row.original} moneda={moneda} tc={tc} />,
    },
    {
      id: "items",
      accessorFn: (r) => r.itemsCount,
      header: () => <span className="block text-right">Ítems</span>,
      meta: { align: "right", width: 80, label: "Ítems" },
      cell: ({ row }) => <ItemsCell r={row.original} />,
    },
    {
      id: "compras",
      accessorFn: (r) => r.comprasCount,
      header: () => <span className="block text-right">Compras</span>,
      meta: { align: "right", width: 90, label: "Compras" },
      cell: ({ row }) => <ComprasCell r={row.original} />,
    },
  ];
}
