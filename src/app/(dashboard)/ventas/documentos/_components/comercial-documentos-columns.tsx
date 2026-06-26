"use client";

/**
 * Column model (data-driven) de la worklist Comercial > Documentos (PR-017 / COM-01).
 *
 * Las 4 PRIMERAS columnas son **congeladas** (OD-01): Número, Tipo, Cliente, Status
 * (`meta:{pinned:"left", width}`). El resto desplaza con scroll horizontal. Definido
 * como función pura `buildComercialColumns({moneda,tc})` para mantener baja la
 * complejidad ciclomática (el grid resuelve orden/visibilidad/paginación).
 *
 * Columnas sensibles (costo/margen): OMITIDAS — los services de esta worklist no
 * exponen esos campos; no hay nada que enmascarar aquí (la margen vive en COM-02/03).
 */

import type { ColumnDef } from "@tanstack/react-table";

import { EntityLink, type EntityLinkMenuItem } from "@/components/data-grid/entity-link";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { convertirMonto, fmtMontoPres } from "@/lib/format";
import type { ComercialDocRow } from "@/lib/comercial/documentos";

import type { Moneda } from "../../../reportes/_components/moneda-toggle";

function fmtFechaIso(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : new Intl.DateTimeFormat("es-AR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone: "UTC",
      }).format(d);
}

function clienteMenu(clienteId: string): EntityLinkMenuItem[] {
  return [
    { label: "Ver ficha", href: `/maestros/clientes/${clienteId}` },
    { label: "Ver ventas", href: "/ventas" },
    { label: "Ver pedidos", href: "/ventas/pedidos" },
  ];
}

type ColumnCtx = { moneda: Moneda; tc: string | null };

export function buildComercialColumns({
  moneda,
  tc,
}: ColumnCtx): ColumnDef<ComercialDocRow, unknown>[] {
  return [
    // ── 1. Número (congelada · EntityLink → record) ──
    {
      accessorKey: "numero",
      header: "Número",
      meta: { pinned: "left", width: 140, label: "Número" },
      cell: ({ row }) => (
        <EntityLink
          label={row.original.numero}
          href={row.original.recordHref}
          tabLabel={row.original.numero}
          menu={[
            { label: "Abrir", href: row.original.recordHref },
            { label: "Ver cliente", href: `/maestros/clientes/${row.original.cliente.id}` },
          ]}
        />
      ),
    },
    // ── 2. Tipo (congelada · badge P/V) ──
    {
      accessorKey: "tipo",
      header: "Tipo",
      meta: { pinned: "left", width: 92, label: "Tipo" },
      cell: ({ row }) => (
        <Badge variant={row.original.tipo === "VENTA" ? "default" : "secondary"}>
          {row.original.tipo === "VENTA" ? "Venta" : "Pedido"}
        </Badge>
      ),
    },
    // ── 3. Cliente (congelada · EntityLink → ficha) ──
    {
      accessorKey: "clienteNombre",
      header: "Cliente",
      meta: { pinned: "left", width: 220, label: "Cliente" },
      cell: ({ row }) => (
        <EntityLink
          label={row.original.cliente.nombre}
          href={`/maestros/clientes/${row.original.cliente.id}`}
          tabLabel={row.original.cliente.nombre}
          menu={clienteMenu(row.original.cliente.id)}
        />
      ),
    },
    // ── 4. Status (congelada · StatusBadge) ──
    {
      accessorKey: "estado",
      header: "Status",
      meta: { pinned: "left", width: 132, label: "Status" },
      cell: ({ row }) => <StatusBadge estado={row.original.estado} />,
    },
    // ── 5. Fecha de emisión ──
    {
      accessorKey: "fecha",
      header: "Fecha",
      meta: { label: "Fecha" },
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">{fmtFechaIso(row.original.fecha)}</span>
      ),
    },
    // ── 6. Vencimiento (venta) / Prevista (pedido) ──
    {
      id: "fechaRef",
      accessorFn: (row) => row.fechaRef ?? "",
      header: "Venc./Prevista",
      meta: { label: "Venc./Prevista" },
      cell: ({ row }) => (
        <span className="text-sm tabular-nums text-muted-foreground">
          {fmtFechaIso(row.original.fechaRef)}
        </span>
      ),
    },
    // ── 7. Moneda nativa ──
    {
      accessorKey: "moneda",
      header: "Moneda",
      meta: { align: "center", label: "Moneda" },
      cell: ({ row }) => <span className="text-xs tabular-nums">{row.original.moneda}</span>,
    },
    // ── 8. Valor (presentación ARS/USD; orden por monto convertido) ──
    {
      id: "valor",
      accessorFn: (row) => Number(convertirMonto(row.total, row.moneda, moneda, tc)),
      header: "Valor",
      meta: { align: "right", label: "Valor" },
      cell: ({ row }) => (
        <span className="block text-right font-mono text-sm tabular-nums">
          {fmtMontoPres(row.original.total, row.original.moneda, moneda, tc)} {moneda}
        </span>
      ),
    },
    // ── 9. Ítems (sólo pedidos) ──
    {
      id: "items",
      accessorFn: (row) => row.itemsCount ?? -1,
      header: "Ítems",
      meta: { align: "right", label: "Ítems" },
      cell: ({ row }) => (
        <span className="block text-right text-sm tabular-nums text-muted-foreground">
          {row.original.itemsCount ?? "—"}
        </span>
      ),
    },
  ];
}
