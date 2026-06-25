"use client";

import type { ColumnDef } from "@tanstack/react-table";

import type { AuditAccion } from "@/generated/prisma/enums";
import { Badge } from "@/components/ui/badge";
import { EntityLink } from "@/components/data-grid/entity-link";
import { diffAuditoria } from "@/lib/auditoria-diff";
import type { AuditoriaRow } from "@/lib/services/auditoria-query";

// Las acciones de mayor riesgo (eventos críticos) se resaltan en destructive.
function accionVariant(accion: AuditAccion): "destructive" | "outline" {
  return accion === "DELETE" || accion === "CANCELACION" || accion === "MASTER_OVERRIDE"
    ? "destructive"
    : "outline";
}

export function buildAuditoriaColumns(): ColumnDef<AuditoriaRow, unknown>[] {
  return [
    {
      id: "fecha",
      accessorFn: (r) => r.fecha,
      header: "Fecha",
      meta: { pinned: "left", width: 132, label: "Fecha" },
      cell: ({ row }) => (
        <span className="flex flex-col leading-tight tabular-nums">
          <span className="text-sm">{row.original.fechaLabel}</span>
          <span className="text-xs text-muted-foreground">{row.original.horaLabel}</span>
        </span>
      ),
    },
    {
      accessorKey: "usuarioNombre",
      header: "Usuario",
      meta: { width: 180, label: "Usuario" },
      cell: ({ row }) => <span className="text-sm font-medium">{row.original.usuarioNombre}</span>,
    },
    {
      accessorKey: "accionLabel",
      header: "Acción",
      meta: { label: "Acción" },
      cell: ({ row }) => (
        <Badge variant={accionVariant(row.original.accion)}>{row.original.accionLabel}</Badge>
      ),
    },
    {
      accessorKey: "origenLabel",
      header: "Origen",
      meta: { label: "Origen" },
      cell: ({ row }) => <span className="text-sm">{row.original.origenLabel}</span>,
    },
    {
      accessorKey: "tablaLabel",
      header: "Tabla",
      meta: { label: "Tabla" },
      cell: ({ row }) => <span className="text-sm">{row.original.tablaLabel}</span>,
    },
    {
      accessorKey: "registroId",
      header: "Registro",
      meta: { width: 160, label: "Registro" },
      cell: ({ row }) => <RegistroCell row={row.original} />,
    },
    {
      accessorKey: "motivo",
      header: "Motivo",
      meta: { label: "Motivo" },
      cell: ({ row }) => (
        <span
          className="block max-w-[280px] truncate text-sm text-muted-foreground"
          title={row.original.motivo ?? undefined}
        >
          {row.original.motivo ?? "—"}
        </span>
      ),
    },
  ];
}

function RegistroCell({ row }: { row: AuditoriaRow }) {
  if (!row.registroHref) {
    return <span className="font-mono text-xs text-muted-foreground">{row.registroId}</span>;
  }
  return (
    <EntityLink
      label={row.registroId}
      href={row.registroHref}
      tabLabel={`${row.tablaLabel} ${row.registroId}`}
    />
  );
}

/** Expansión: metadata (IP/documento) + diff before→after (reusa `diffAuditoria`). */
export function AuditoriaExpandedRow({ row }: { row: AuditoriaRow }) {
  const diffs = diffAuditoria(row.datosAnteriores, row.datosNuevos);
  return (
    <div className="flex flex-col gap-2 text-xs">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
        <span>
          <span className="font-medium text-foreground">IP</span>: {row.ip ?? "—"}
        </span>
        {row.documentoId ? (
          <span>
            <span className="font-medium text-foreground">Documento</span>: {row.documentoId}
          </span>
        ) : null}
        {row.motivo ? (
          <span className="basis-full">
            <span className="font-medium text-foreground">Motivo</span>: {row.motivo}
          </span>
        ) : null}
      </div>
      {diffs.length > 0 ? (
        <table className="w-full max-w-3xl border-separate border-spacing-0 text-left">
          <thead>
            <tr className="text-[10px] tracking-wide text-muted-foreground uppercase">
              <th className="py-1 pr-4 font-medium">Campo</th>
              <th className="py-1 pr-4 font-medium">Valor anterior</th>
              <th className="py-1 font-medium">Valor nuevo</th>
            </tr>
          </thead>
          <tbody>
            {diffs.map((d) => (
              <tr key={d.campo} className="align-top">
                <td className="py-0.5 pr-4 font-medium text-foreground">{d.campo}</td>
                <td className="py-0.5 pr-4 text-muted-foreground">{d.antes ?? "—"}</td>
                <td className="py-0.5 text-foreground">{d.despues ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-muted-foreground">Sin cambios de campos registrados.</p>
      )}
    </div>
  );
}
