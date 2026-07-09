"use client";

/**
 * Modelo de columnas (data-driven) de la worklist de leads (CRM-01 · PR-030).
 * Espejo estructural de `pedidos-compra-columns.tsx` (PR-029): cada celda no
 * trivial es un renderer nombrado de módulo (CCN baja — gate Codacy/Lizard) y
 * el pinning va por `meta.pinned` (nombre + empresa + estado congelados).
 *
 * Read-only: el seguimiento (próxima acción / último contacto / sin
 * follow-up) llega YA derivado en la fila (`leads-presentacion.ts`) — acá no
 * se recalcula nada.
 */

import type { ColumnDef } from "@tanstack/react-table";

import { EntityLink } from "@/components/data-grid/entity-link";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { fmtDate } from "@/lib/format";

import type { LeadWorklistRow } from "./leads-presentacion";

export type { LeadWorklistRow };

const DASH = "—";

function DashCell() {
  return <span className="text-xs text-muted-foreground">{DASH}</span>;
}

function NombreCell({ r }: { r: LeadWorklistRow }) {
  return <EntityLink label={r.nombre} href={`/crm/leads/${r.id}`} tabLabel={r.nombre} />;
}

function EmpresaCell({ r }: { r: LeadWorklistRow }) {
  if (!r.empresa) return <DashCell />;
  return <span className="text-sm">{r.empresa}</span>;
}

function EstadoCell({ r }: { r: LeadWorklistRow }) {
  return <StatusBadge estado={r.estado} />;
}

function ScoreCell({ r }: { r: LeadWorklistRow }) {
  return <span className="block text-right text-sm tabular-nums">{r.score}</span>;
}

function TipoSufijo({ tipo }: { tipo: string | null }) {
  if (!tipo) return null;
  return <span className="ml-1 font-mono text-[10px] text-muted-foreground">{tipo}</span>;
}

// Próxima acción: pendiente con menor fechaProgramada; pendiente sin fecha →
// «Pendiente sin fecha»; sin pendiente → «—».
function ProximaAccionCell({ r }: { r: LeadWorklistRow }) {
  if (!r.tienePendiente) return <DashCell />;
  if (!r.proximaAccionFecha) {
    return <span className="text-xs text-warning">Pendiente sin fecha</span>;
  }
  return (
    <span className="text-sm tabular-nums">
      {fmtDate(new Date(r.proximaAccionFecha))}
      <TipoSufijo tipo={r.proximaAccionTipo} />
    </span>
  );
}

// Último contacto: completada con mayor fechaCompletada (+tipo).
function UltimoContactoCell({ r }: { r: LeadWorklistRow }) {
  if (!r.ultimoContactoFecha) return <DashCell />;
  return (
    <span className="text-sm tabular-nums">
      {fmtDate(new Date(r.ultimoContactoFecha))}
      <TipoSufijo tipo={r.ultimoContactoTipo} />
    </span>
  );
}

function SeguimientoCell({ r }: { r: LeadWorklistRow }) {
  if (!r.sinFollowUp) return <DashCell />;
  return (
    <Badge variant="outline" className="border-warning/30 bg-warning/15 text-warning">
      Sin follow-up
    </Badge>
  );
}

function CuitCell({ r }: { r: LeadWorklistRow }) {
  if (!r.cuit) return <DashCell />;
  return <span className="font-mono text-xs">{r.cuit}</span>;
}

function EmailCell({ r }: { r: LeadWorklistRow }) {
  if (!r.email) return <DashCell />;
  return <span className="text-sm">{r.email}</span>;
}

function OwnerCell({ r }: { r: LeadWorklistRow }) {
  return <span className="text-sm">{r.ownerNombre}</span>;
}

function ClienteCell({ r }: { r: LeadWorklistRow }) {
  if (!r.clienteId) return <DashCell />;
  return (
    <EntityLink
      label={r.clienteNombre ?? r.clienteId}
      href={`/maestros/clientes/${r.clienteId}`}
      tabLabel={r.clienteNombre ?? undefined}
    />
  );
}

function CreadoCell({ r }: { r: LeadWorklistRow }) {
  return (
    <span className="text-xs text-muted-foreground tabular-nums">
      {fmtDate(new Date(r.createdAt))}
    </span>
  );
}

// Sort-key del badge de seguimiento (helper nombrado — gotcha Lizard).
function seguimientoSortKey(r: LeadWorklistRow): number {
  if (r.sinFollowUp) return 1;
  return 0;
}

export function buildLeadsColumns(): ColumnDef<LeadWorklistRow, unknown>[] {
  return [
    {
      id: "nombre",
      accessorFn: (r) => r.nombre,
      header: "Nombre",
      meta: { pinned: "left", width: 200, label: "Nombre" },
      cell: ({ row }) => <NombreCell r={row.original} />,
    },
    {
      id: "empresa",
      accessorFn: (r) => r.empresa ?? undefined,
      sortUndefined: "last",
      header: "Empresa",
      meta: { pinned: "left", width: 180, label: "Empresa" },
      cell: ({ row }) => <EmpresaCell r={row.original} />,
    },
    {
      id: "estado",
      accessorFn: (r) => r.estado,
      header: "Estado",
      meta: { pinned: "left", width: 130, label: "Estado" },
      cell: ({ row }) => <EstadoCell r={row.original} />,
    },
    {
      id: "score",
      accessorFn: (r) => r.score,
      header: () => <span className="block text-right">Score</span>,
      meta: { align: "right", width: 70, label: "Score" },
      cell: ({ row }) => <ScoreCell r={row.original} />,
    },
    {
      id: "fuente",
      accessorFn: (r) => r.fuente,
      header: "Fuente",
      meta: { width: 110, label: "Fuente" },
      cell: ({ row }) => <span className="text-xs">{row.original.fuente}</span>,
    },
    {
      id: "proximaAccion",
      // `undefined` + sortUndefined:"last" fija sin-fecha/sin-pendiente AL
      // FINAL en asc y desc ("" ordenaría antes de todo ISO).
      accessorFn: (r) => r.proximaAccionFecha ?? undefined,
      sortUndefined: "last",
      header: "Próxima acción",
      meta: { width: 150, label: "Próxima acción" },
      cell: ({ row }) => <ProximaAccionCell r={row.original} />,
    },
    {
      id: "ultimoContacto",
      accessorFn: (r) => r.ultimoContactoFecha ?? undefined,
      sortUndefined: "last",
      header: "Último contacto",
      meta: { width: 150, label: "Último contacto" },
      cell: ({ row }) => <UltimoContactoCell r={row.original} />,
    },
    {
      id: "seguimiento",
      accessorFn: seguimientoSortKey,
      header: "Seguimiento",
      meta: { width: 120, label: "Seguimiento" },
      cell: ({ row }) => <SeguimientoCell r={row.original} />,
    },
    {
      id: "cuit",
      accessorFn: (r) => r.cuit ?? undefined,
      sortUndefined: "last",
      header: "CUIT",
      meta: { width: 120, label: "CUIT" },
      cell: ({ row }) => <CuitCell r={row.original} />,
    },
    {
      id: "email",
      accessorFn: (r) => r.email ?? undefined,
      sortUndefined: "last",
      header: "Email",
      meta: { width: 190, label: "Email" },
      cell: ({ row }) => <EmailCell r={row.original} />,
    },
    {
      id: "owner",
      accessorFn: (r) => r.ownerNombre,
      header: "Owner",
      meta: { width: 130, label: "Owner" },
      cell: ({ row }) => <OwnerCell r={row.original} />,
    },
    {
      id: "cliente",
      accessorFn: (r) => r.clienteNombre ?? undefined,
      sortUndefined: "last",
      header: "Cliente",
      meta: { width: 170, label: "Cliente" },
      cell: ({ row }) => <ClienteCell r={row.original} />,
    },
    {
      id: "creado",
      accessorFn: (r) => r.createdAt,
      header: "Creado",
      meta: { width: 100, label: "Creado" },
      cell: ({ row }) => <CreadoCell r={row.original} />,
    },
  ];
}
