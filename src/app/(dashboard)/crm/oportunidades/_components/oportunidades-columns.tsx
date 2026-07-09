"use client";

/**
 * Modelo de columnas (data-driven) de la worklist de oportunidades
 * (CRM-01 · PR-030). Espejo estructural de `pedidos-compra-columns.tsx`
 * (PR-029): cada celda no trivial es un renderer nombrado de módulo (CCN baja
 * — gate Codacy/Lizard) y el pinning va por `meta.pinned` (N° congelado).
 *
 * Read-only: monto y ponderado son display native-first (`fmtMontoPres` sobre
 * el valor NATIVO — nunca se divide por TC a mano); `estado` usa el
 * StatusBadge semántico compartido (EN_PAUSA cae al fallback neutro — ok).
 * Deuda documentada (idem FIN-01/COMP-01): el sort-key de Monto/Ponderado es
 * la magnitud nativa (`Number(...)`) — en multimoneda el orden puede divergir
 * del display convertido.
 */

import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";

import { EntityLink } from "@/components/data-grid/entity-link";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { fmtDate, fmtMontoPres } from "@/lib/format";

import type { OportunidadWorklistRow } from "./oportunidades-presentacion";
import type { Moneda } from "../../../reportes/_components/moneda-toggle";

export type { OportunidadWorklistRow };

const DASH = "—";

function NumeroCell({ r }: { r: OportunidadWorklistRow }) {
  return <EntityLink label={r.numero} href={`/crm/oportunidades/${r.id}`} tabLabel={r.numero} />;
}

function TituloCell({ r }: { r: OportunidadWorklistRow }) {
  return <span className="block max-w-[280px] truncate text-sm">{r.titulo}</span>;
}

// Lógica VERBATIM de la oportunidades-table anterior: cliente con precedencia
// (→ ficha de cliente), después lead (label empresa ?? nombre), después "—".
function VinculoCell({ r }: { r: OportunidadWorklistRow }) {
  if (r.clienteNombre) {
    return (
      <Link href={`/maestros/clientes/${r.clienteId}`} className="text-primary hover:underline">
        {r.clienteNombre}
      </Link>
    );
  }
  if (r.leadId) {
    return (
      <Link href={`/crm/leads/${r.leadId}`} className="text-primary hover:underline">
        {r.leadEmpresa ?? r.leadNombre}
      </Link>
    );
  }
  return <>{DASH}</>;
}

function MontoCell({
  r,
  moneda,
  tc,
}: {
  r: OportunidadWorklistRow;
  moneda: Moneda;
  tc: string | null;
}) {
  return (
    <span className="block text-right font-mono tabular-nums">
      {fmtMontoPres(r.monto, r.moneda, moneda, tc)}
    </span>
  );
}

function ProbCell({ r }: { r: OportunidadWorklistRow }) {
  return <span className="block text-right text-sm tabular-nums">{r.probabilidad}%</span>;
}

function PonderadoCell({
  r,
  moneda,
  tc,
}: {
  r: OportunidadWorklistRow;
  moneda: Moneda;
  tc: string | null;
}) {
  return (
    <span className="block text-right font-mono tabular-nums">
      {fmtMontoPres(r.valorPonderado, r.moneda, moneda, tc)}
    </span>
  );
}

function StageCell({ r }: { r: OportunidadWorklistRow }) {
  return <span className="text-sm">{r.stageNombre}</span>;
}

function EstadoCell({ r }: { r: OportunidadWorklistRow }) {
  return <StatusBadge estado={r.estado} />;
}

// Fecha + tipo de la próxima pendiente; ABIERTA sin próxima acción = badge
// ámbar accionable (mismo tono `warning` del StatusBadge); cerradas → "—".
function ProximaAccionCell({ r }: { r: OportunidadWorklistRow }) {
  if (r.proximaAccion) {
    const fecha = r.proximaAccion.fecha ? fmtDate(r.proximaAccion.fecha) : "Sin fecha";
    return (
      <span className="text-sm">
        <span className="tabular-nums">{fecha}</span>
        <span className="ml-1 font-mono text-[10px] uppercase text-muted-foreground">
          {r.proximaAccion.tipo}
        </span>
      </span>
    );
  }
  if (r.estado === "ABIERTA") {
    return (
      <Badge variant="outline" className="bg-warning/15 text-warning border-warning/30">
        Sin próxima acción
      </Badge>
    );
  }
  return <span className="text-xs text-muted-foreground">{DASH}</span>;
}

function OwnerCell({ r }: { r: OportunidadWorklistRow }) {
  return <span className="text-sm">{r.ownerNombre}</span>;
}

function CierreCell({ r }: { r: OportunidadWorklistRow }) {
  if (!r.cierreEstimado) return <span className="text-xs text-muted-foreground">{DASH}</span>;
  return <span className="text-sm tabular-nums">{fmtDate(r.cierreEstimado)}</span>;
}

// Sort-key del vínculo = mismo orden de precedencia del render.
function vinculoSortKey(r: OportunidadWorklistRow): string {
  return r.clienteNombre ?? r.leadEmpresa ?? r.leadNombre ?? "";
}

// `undefined` + sortUndefined:"last" fija sin-fecha AL FINAL en asc y desc.
function fechaSortKey(fecha: Date | null | undefined): string | undefined {
  if (!fecha) return undefined;
  return fecha.toISOString();
}

export function buildOportunidadesColumns({
  moneda,
  tc,
}: {
  moneda: Moneda;
  tc: string | null;
}): ColumnDef<OportunidadWorklistRow, unknown>[] {
  return [
    {
      id: "numero",
      accessorFn: (r) => r.numero,
      header: "N°",
      meta: { pinned: "left", width: 120, label: "N°" },
      cell: ({ row }) => <NumeroCell r={row.original} />,
    },
    {
      id: "titulo",
      accessorFn: (r) => r.titulo,
      header: "Título",
      meta: { width: 240, label: "Título" },
      cell: ({ row }) => <TituloCell r={row.original} />,
    },
    {
      id: "vinculo",
      accessorFn: vinculoSortKey,
      header: "Lead/Cliente",
      meta: { width: 200, label: "Lead/Cliente" },
      cell: ({ row }) => <VinculoCell r={row.original} />,
    },
    {
      id: "monto",
      accessorFn: (r) => Number(r.monto),
      header: () => <span className="block text-right">Monto</span>,
      meta: { align: "right", width: 120, label: "Monto" },
      cell: ({ row }) => <MontoCell r={row.original} moneda={moneda} tc={tc} />,
    },
    {
      id: "probabilidad",
      accessorFn: (r) => r.probabilidad,
      header: () => <span className="block text-right">Prob. %</span>,
      meta: { align: "right", width: 80, label: "Prob. %" },
      cell: ({ row }) => <ProbCell r={row.original} />,
    },
    {
      id: "ponderado",
      accessorFn: (r) => Number(r.valorPonderado),
      header: () => <span className="block text-right">Ponderado</span>,
      meta: { align: "right", width: 130, label: "Ponderado" },
      cell: ({ row }) => <PonderadoCell r={row.original} moneda={moneda} tc={tc} />,
    },
    {
      id: "stageNombre",
      accessorFn: (r) => r.stageNombre,
      header: "Stage",
      meta: { width: 140, label: "Stage" },
      cell: ({ row }) => <StageCell r={row.original} />,
    },
    {
      id: "estado",
      accessorFn: (r) => r.estado,
      header: "Estado",
      meta: { width: 110, label: "Estado" },
      cell: ({ row }) => <EstadoCell r={row.original} />,
    },
    {
      id: "proximaAccion",
      accessorFn: (r) => fechaSortKey(r.proximaAccion?.fecha),
      sortUndefined: "last",
      header: "Próxima acción",
      meta: { width: 170, label: "Próxima acción" },
      cell: ({ row }) => <ProximaAccionCell r={row.original} />,
    },
    {
      id: "ownerNombre",
      accessorFn: (r) => r.ownerNombre,
      header: "Owner",
      meta: { width: 140, label: "Owner" },
      cell: ({ row }) => <OwnerCell r={row.original} />,
    },
    {
      id: "cierre",
      accessorFn: (r) => fechaSortKey(r.cierreEstimado),
      sortUndefined: "last",
      header: "Cierre est.",
      meta: { width: 110, label: "Cierre est." },
      cell: ({ row }) => <CierreCell r={row.original} />,
    },
  ];
}
