"use client";

/**
 * Columnas OD-07 de la worklist de asientos (CONT-01 · PR-028) — factory +
 * renderers NOMBRADOS (gate Codacy CCN≤8; jamás ternarios dentro de object
 * literals). Canon OD-07: Número · Fecha · Período · Origen · Descripción ·
 * Debe · Haber · Estado · Documento origen, congeladas 1/4/8. El pin del grid
 * agrupa las congeladas a la izquierda (precedente fin-cxc: Estado pineada
 * aparece 3ª visualmente — mismo criterio).
 *
 * La `RowActions` es VERBATIM de `asientos-table.tsx` (Ver detalles /
 * Contabilizar BORRADOR / Anular CONTABILIZADO) + reflejo FE de
 * `ASIENTOS_ANULAR` (item deshabilitado con hint — el BE `requireAdmin` de la
 * action sigue siendo el control real).
 */

import type { ColumnDef } from "@tanstack/react-table";
import { format } from "date-fns";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  CancelCircleIcon,
  CheckmarkCircle02Icon,
  MoreHorizontalCircle01Icon,
  ViewIcon,
} from "@hugeicons/core-free-icons";

import { cn } from "@/lib/utils";
import { PERMISOS } from "@/lib/permisos-catalog";
import type { AsientoWorklistRow } from "@/lib/services/asientos-worklist";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EntityLink } from "@/components/data-grid/entity-link";
import { StatusBadge } from "@/components/ui/status-badge";
import { useHasPermission } from "@/components/auth/permissions-provider";

import { puedeAnular, puedeContabilizar } from "./asientos-presentacion";

export type AsientoRowAction = "contabilizar" | "anular";

type ColumnDeps = {
  onOpenDetalle: (asientoId: string) => void;
  onAction: (action: AsientoRowAction, row: AsientoWorklistRow) => void;
};

function NumeroCell({ row }: { row: AsientoWorklistRow }) {
  return (
    <EntityLink
      label={`#${row.numero}`}
      href={`/contabilidad/asientos/${row.id}`}
      tabLabel={`Asiento #${row.numero}`}
    />
  );
}

function FechaCell({ row }: { row: AsientoWorklistRow }) {
  return <span className="text-sm tabular-nums">{format(new Date(row.fecha), "dd/MM/yyyy")}</span>;
}

function PeriodoCell({ row }: { row: AsientoWorklistRow }) {
  return (
    <span className="flex items-center gap-1">
      <Badge variant="outline" className="font-mono text-xs">
        {row.periodoCodigo}
      </Badge>
      {row.periodoEstado === "CERRADO" && (
        <Badge variant="secondary" className="text-[10px] uppercase">
          Cerrado
        </Badge>
      )}
    </span>
  );
}

function OrigenCell({ row }: { row: AsientoWorklistRow }) {
  return (
    <Badge variant="ghost" className="text-xs">
      {row.origen}
    </Badge>
  );
}

function DescripcionCell({ row }: { row: AsientoWorklistRow }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              "block max-w-[32ch] truncate text-sm",
              row.estado === "ANULADO" && "line-through opacity-60",
            )}
          />
        }
      >
        {row.descripcion}
      </TooltipTrigger>
      <TooltipContent>{row.descripcion}</TooltipContent>
    </Tooltip>
  );
}

function montoCell(valor: string) {
  return <span className="block text-right font-mono text-sm tabular-nums">{valor}</span>;
}

function EstadoCell({ row }: { row: AsientoWorklistRow }) {
  return <StatusBadge estado={row.estado} />;
}

function DocumentoOrigenCell({ row }: { row: AsientoWorklistRow }) {
  if (!row.doc) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return <EntityLink label={row.doc.etiqueta} href={row.doc.href} />;
}

function AsientosRowActions({
  row,
  onOpenDetalle,
  onAction,
}: {
  row: AsientoWorklistRow;
  onOpenDetalle: (asientoId: string) => void;
  onAction: (action: AsientoRowAction, row: AsientoWorklistRow) => void;
}) {
  // Reflejo FE de la clave existente (RBAC OFF ⇒ true, cero regresión). El
  // control real sigue siendo `requireAdmin` dentro de `anularAsientoAction`.
  const puedeAnularFe = useHasPermission(PERMISOS.ASIENTOS_ANULAR);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Acciones" />}>
        <HugeiconsIcon icon={MoreHorizontalCircle01Icon} strokeWidth={2} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onOpenDetalle(row.id)}>
          <HugeiconsIcon icon={ViewIcon} strokeWidth={2} />
          Ver detalles
        </DropdownMenuItem>
        {puedeContabilizar(row.estado) && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onAction("contabilizar", row)}>
              <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} />
              Contabilizar
            </DropdownMenuItem>
          </>
        )}
        {puedeAnular(row.estado) && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={!puedeAnularFe}
              onClick={() => onAction("anular", row)}
            >
              <HugeiconsIcon icon={CancelCircleIcon} strokeWidth={2} />
              <span>Anular</span>
              {!puedeAnularFe && (
                <span className="ml-auto pl-3 text-[10px] uppercase tracking-wide text-muted-foreground">
                  Sin permiso
                </span>
              )}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function buildAsientosColumns(deps: ColumnDeps): ColumnDef<AsientoWorklistRow, unknown>[] {
  return [
    {
      id: "numero",
      header: "Número",
      cell: ({ row }) => <NumeroCell row={row.original} />,
      meta: { pinned: "left", width: 96, label: "Número" },
    },
    {
      id: "origen",
      header: "Origen",
      cell: ({ row }) => <OrigenCell row={row.original} />,
      meta: { pinned: "left", width: 104, label: "Origen" },
    },
    {
      id: "estado",
      header: "Estado",
      cell: ({ row }) => <EstadoCell row={row.original} />,
      meta: { pinned: "left", width: 128, label: "Estado" },
    },
    {
      id: "fecha",
      header: "Fecha",
      accessorFn: (row) => row.fecha,
      cell: ({ row }) => <FechaCell row={row.original} />,
      meta: { width: 100, label: "Fecha" },
    },
    {
      id: "periodo",
      header: "Período",
      accessorFn: (row) => row.periodoCodigo,
      cell: ({ row }) => <PeriodoCell row={row.original} />,
      meta: { width: 132, label: "Período" },
    },
    {
      id: "descripcion",
      header: "Descripción",
      accessorFn: (row) => row.descripcion,
      cell: ({ row }) => <DescripcionCell row={row.original} />,
      meta: { label: "Descripción" },
    },
    {
      id: "totalDebe",
      header: () => <span className="block text-right">Debe</span>,
      accessorFn: (row) => row.totalDebe,
      cell: ({ row }) => montoCell(row.original.totalDebe),
      meta: { align: "right", width: 120, label: "Debe" },
    },
    {
      id: "totalHaber",
      header: () => <span className="block text-right">Haber</span>,
      accessorFn: (row) => row.totalHaber,
      cell: ({ row }) => montoCell(row.original.totalHaber),
      meta: { align: "right", width: 120, label: "Haber" },
    },
    {
      id: "doc",
      header: "Documento origen",
      cell: ({ row }) => <DocumentoOrigenCell row={row.original} />,
      meta: { width: 140, label: "Documento origen" },
    },
    {
      id: "acciones",
      header: () => <span className="sr-only">Acciones</span>,
      cell: ({ row }) => (
        <AsientosRowActions
          row={row.original}
          onOpenDetalle={deps.onOpenDetalle}
          onAction={deps.onAction}
        />
      ),
      meta: { width: 48 },
    },
  ];
}
