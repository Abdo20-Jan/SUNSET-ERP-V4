"use client";

import type { ColumnDef } from "@tanstack/react-table";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { EntityLink } from "@/components/data-grid/entity-link";
import { MoneyAmount } from "@/components/ui/money-amount";
import { SLA_BANDA_CLASS } from "@/lib/services/aprobaciones-constants";
import type { AprobacionRow } from "@/lib/services/aprobaciones-query";
import { cn } from "@/lib/utils";

function DocumentoCell({ row }: { row: AprobacionRow }) {
  if (!row.documentoHref) {
    return <span className="font-mono text-xs text-muted-foreground">{row.registroId}</span>;
  }
  return (
    <EntityLink
      label={row.registroId}
      href={row.documentoHref}
      tabLabel={`${row.tabla} ${row.registroId}`}
    />
  );
}

function ValorCell({ row }: { row: AprobacionRow }) {
  if (row.valor == null) return <span className="text-muted-foreground">—</span>;
  return <MoneyAmount value={row.valor} mode="plain" symbol={row.moneda ? `${row.moneda} ` : ""} />;
}

function SlaCell({ row }: { row: AprobacionRow }) {
  return (
    <span className="flex flex-col leading-tight tabular-nums">
      <span className="text-sm">{row.venceEnLabel}</span>
      <span className={cn("text-xs", SLA_BANDA_CLASS[row.slaBanda])}>{row.slaLabel}</span>
    </span>
  );
}

// `onRevisar` abre la janela de decisão de la fila (FloatingWorkWindow). Las
// columnas son data-driven; la acción se inyecta desde la worklist (estado client).
export function buildAprobacionesColumns(
  onRevisar: (row: AprobacionRow) => void,
): ColumnDef<AprobacionRow, unknown>[] {
  return [
    {
      accessorKey: "solicitanteNombre",
      header: "Solicitante",
      meta: { pinned: "left", width: 160, label: "Solicitante" },
      cell: ({ row }) => (
        <span className="text-sm font-medium">{row.original.solicitanteNombre}</span>
      ),
    },
    {
      accessorKey: "tipoLabel",
      header: "Tipo",
      meta: { width: 210, label: "Tipo" },
      cell: ({ row }) => <span className="text-sm">{row.original.tipoLabel}</span>,
    },
    {
      accessorKey: "registroId",
      header: "Documento",
      meta: { width: 150, label: "Documento" },
      cell: ({ row }) => <DocumentoCell row={row.original} />,
    },
    {
      accessorKey: "valor",
      header: "Valor",
      meta: { align: "right", width: 130, label: "Valor" },
      cell: ({ row }) => <ValorCell row={row.original} />,
    },
    {
      accessorKey: "estado",
      header: "Estado",
      meta: { width: 130, label: "Estado" },
      cell: ({ row }) => (
        <StatusBadge estado={row.original.estado} label={row.original.estadoLabel} />
      ),
    },
    {
      id: "sla",
      accessorFn: (r) => r.venceEn,
      header: "SLA",
      meta: { width: 150, label: "SLA" },
      cell: ({ row }) => <SlaCell row={row.original} />,
    },
    {
      accessorKey: "aprobadorNombre",
      header: "Aprobador",
      meta: { width: 150, label: "Aprobador" },
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{row.original.aprobadorNombre}</span>
      ),
    },
    {
      id: "acciones",
      header: "",
      meta: { width: 110, label: "Acciones" },
      cell: ({ row }) => (
        <Button type="button" variant="outline" size="sm" onClick={() => onRevisar(row.original)}>
          Revisar
        </Button>
      ),
    },
  ];
}
