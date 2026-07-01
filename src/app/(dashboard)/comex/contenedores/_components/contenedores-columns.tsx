"use client";

/**
 * Column model (data-driven) de la worklist GLOBAL de contenedores (PR-024 / CX-04).
 *
 * 3 columnas CONGELADAS (Número · BL/HBL · Status) + las canónicas de la spec
 * §9-estrutural 2 (fecha salida/llegada · depósito fiscal · declarada/física/
 * disponible/en despacho/despachada) + 2 de contexto para la vista global
 * (Proceso · Proveedor, necesarias para navegar/filtrar entre procesos).
 *
 * La columna **Costo FC (USD)** se incluye SÓLO si `verCosto` (gate
 * `VER_COSTO_LANDED`) — omitida por completo (ni "—") en caso contrario
 * (spec §9-estrutural 8). Cada celda no trivial es un renderer nombrado de módulo
 * para mantener `buildContenedoresColumns` en complejidad ciclomática baja.
 */

import type { ColumnDef } from "@tanstack/react-table";

import { EntityLink } from "@/components/data-grid/entity-link";
import { fmtMoney } from "@/lib/format";
import type { ContenedorRow } from "@/lib/services/contenedor-worklist";

import { EstadoContenedorBadge } from "./contenedores-chips";

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

function NumeroCell({ row }: { row: ContenedorRow }) {
  const href = `/comex/contenedores/${row.id}`;
  return (
    <EntityLink
      label={<span className="font-mono">{row.numeroContenedor}</span>}
      href={href}
      tabLabel={row.numeroContenedor}
      menu={[
        { label: "Abrir contenedor", href },
        { label: "Ver embarque", href: `/comex/embarques/${row.embarqueId}` },
      ]}
    />
  );
}

function BlHblCell({ row }: { row: ContenedorRow }) {
  if (!row.numeroBL && !row.numeroHBL) {
    return <span className="text-xs text-muted-foreground">{DASH}</span>;
  }
  const href = `/comex/contenedores/${row.id}`;
  return (
    <span className="flex flex-col leading-tight">
      <EntityLink
        label={<span className="font-mono text-sm">{row.numeroBL ?? DASH}</span>}
        href={href}
        tabLabel={row.numeroBL ?? row.numeroContenedor}
      />
      <span className="font-mono text-[10px] text-muted-foreground">
        HBL {row.numeroHBL ?? DASH}
      </span>
    </span>
  );
}

function ProcesoCell({ row }: { row: ContenedorRow }) {
  const href = `/comex/embarques/${row.embarqueId}`;
  return <EntityLink label={row.embarqueCodigo} href={href} tabLabel={row.embarqueCodigo} />;
}

function FechaCell({ iso }: { iso: string | null }) {
  return <span className="text-sm tabular-nums">{fmtFechaIso(iso)}</span>;
}

function DepositoFiscalCell({ row }: { row: ContenedorRow }) {
  return <span className="text-sm">{row.depositoFiscal ?? DASH}</span>;
}

function NumCell({ value }: { value: number }) {
  return <span className="block text-right text-sm tabular-nums">{value}</span>;
}

// Disponible: resaltado (es el saldo accionable para despacho).
function DisponibleCell({ value }: { value: number }) {
  return <span className="block text-right text-sm font-semibold tabular-nums">{value}</span>;
}

function CostoFcCell({ row }: { row: ContenedorRow }) {
  if (row.costoFCTotal == null) {
    return <span className="block text-right text-xs text-muted-foreground">{DASH}</span>;
  }
  return (
    <span className="block text-right font-mono text-sm font-semibold tabular-nums">
      {fmtMoney(row.costoFCTotal)} USD
    </span>
  );
}

export function buildContenedoresColumns({
  verCosto,
}: {
  verCosto: boolean;
}): ColumnDef<ContenedorRow, unknown>[] {
  const base: ColumnDef<ContenedorRow, unknown>[] = [
    {
      accessorKey: "numeroContenedor",
      header: "Número",
      meta: { pinned: "left", width: 150, label: "Número" },
      cell: ({ row }) => <NumeroCell row={row.original} />,
    },
    {
      id: "blhbl",
      accessorFn: (r) => r.numeroBL ?? "",
      header: "BL / HBL",
      meta: { pinned: "left", width: 150, label: "BL / HBL" },
      cell: ({ row }) => <BlHblCell row={row.original} />,
    },
    {
      accessorKey: "estado",
      header: "Status",
      meta: { pinned: "left", width: 176, label: "Status" },
      cell: ({ row }) => <EstadoContenedorBadge estado={row.original.estado} />,
    },
    {
      id: "embarqueCodigo",
      accessorFn: (r) => r.embarqueCodigo,
      header: "Proceso",
      meta: { width: 140, label: "Proceso" },
      cell: ({ row }) => <ProcesoCell row={row.original} />,
    },
    {
      id: "proveedorNombre",
      accessorFn: (r) => r.proveedorNombre,
      header: "Proveedor",
      meta: { width: 200, label: "Proveedor" },
      cell: ({ row }) => <span className="text-sm">{row.original.proveedorNombre}</span>,
    },
    {
      id: "fechaSalida",
      accessorFn: (r) => r.fechaSalidaOrigen ?? "",
      header: "Fecha salida",
      meta: { width: 120, label: "Fecha salida" },
      cell: ({ row }) => <FechaCell iso={row.original.fechaSalidaOrigen} />,
    },
    {
      id: "fechaLlegada",
      accessorFn: (r) => r.fechaLlegadaPuerto ?? "",
      header: "Fecha llegada",
      meta: { width: 120, label: "Fecha llegada" },
      cell: ({ row }) => <FechaCell iso={row.original.fechaLlegadaPuerto} />,
    },
    {
      id: "depositoFiscal",
      accessorFn: (r) => r.depositoFiscal ?? "",
      header: "Depósito fiscal",
      meta: { width: 180, label: "Depósito fiscal" },
      cell: ({ row }) => <DepositoFiscalCell row={row.original} />,
    },
    {
      id: "cantidadDeclarada",
      accessorFn: (r) => r.cantidadDeclarada,
      header: () => <span className="block text-right">Cant. declarada</span>,
      meta: { align: "right", width: 130, label: "Cant. declarada" },
      cell: ({ row }) => <NumCell value={row.original.cantidadDeclarada} />,
    },
    {
      id: "cantidadFisica",
      accessorFn: (r) => r.cantidadFisica,
      header: () => <span className="block text-right">Cant. física</span>,
      meta: { align: "right", width: 120, label: "Cant. física" },
      cell: ({ row }) => <NumCell value={row.original.cantidadFisica} />,
    },
    {
      id: "cantidadDisponible",
      accessorFn: (r) => r.cantidadDisponible,
      header: () => <span className="block text-right">Cant. disponible</span>,
      meta: { align: "right", width: 130, label: "Cant. disponible" },
      cell: ({ row }) => <DisponibleCell value={row.original.cantidadDisponible} />,
    },
    {
      id: "cantidadEnDespacho",
      accessorFn: (r) => r.cantidadEnDespacho,
      header: () => <span className="block text-right">En despacho</span>,
      meta: { align: "right", width: 120, label: "En despacho" },
      cell: ({ row }) => <NumCell value={row.original.cantidadEnDespacho} />,
    },
    {
      id: "cantidadDespachada",
      accessorFn: (r) => r.cantidadDespachada,
      header: () => <span className="block text-right">Despachada</span>,
      meta: { align: "right", width: 120, label: "Despachada" },
      cell: ({ row }) => <NumCell value={row.original.cantidadDespachada} />,
    },
  ];

  const costo: ColumnDef<ContenedorRow, unknown> = {
    id: "costoFCTotal",
    accessorFn: (r) => Number(r.costoFCTotal ?? 0),
    header: () => <span className="block text-right">Costo FC (USD)</span>,
    meta: { align: "right", width: 150, label: "Costo FC" },
    cell: ({ row }) => <CostoFcCell row={row.original} />,
  };

  return verCosto ? [...base, costo] : base;
}
