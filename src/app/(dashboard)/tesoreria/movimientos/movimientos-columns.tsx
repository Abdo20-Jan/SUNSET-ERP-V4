"use client";

/**
 * Modelo de columnas (data-driven) de la worklist de movimientos de tesorería
 * (TES-01 · PR-025a). Cada celda no trivial es un renderer nombrado de módulo
 * para mantener `buildMovimientosColumns` en complejidad ciclomática baja.
 *
 * NOTA de gate: `monto` es dato TRANSACCIONAL (no "saldo" de cuenta) — se lee de
 * un asiento ya generado por el motor, NO se recomputa — y sigue el
 * comportamiento actual (visible). El gate `VER_SALDO` (PR-025) cubre los saldos
 * de cuenta/agregados, no el monto de un movimiento individual.
 *
 * El drill-down (columna Fecha = `EntityLink`) abre la
 * `MovimientoDetalleWorkWindow` (FWW, sin drawer lateral) vía `onOpenDetalle`;
 * el menú de acciones conserva "página completa" + "Anular" (byte-idéntico).
 */

import type { ColumnDef } from "@tanstack/react-table";
import { format } from "date-fns";
import { HugeiconsIcon } from "@hugeicons/react";
import { CancelCircleIcon, MoreHorizontalCircle01Icon } from "@hugeicons/core-free-icons";

import type { AsientoEstado, Moneda, MovimientoTesoreriaTipo } from "@/generated/prisma/client";
import { fmtMontoPres } from "@/lib/format";
import { cn } from "@/lib/utils";
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

export type MovimientoWorklistRow = {
  id: string;
  tipo: MovimientoTesoreriaTipo;
  fecha: Date;
  monto: string;
  moneda: Moneda;
  tipoCambio: string;
  descripcion: string | null;
  comprobante: string | null;
  referenciaBanco: string | null;
  /** Campo plano para búsqueda/chip (= cuentaBancaria.banco). */
  banco: string;
  cuentaBancaria: {
    id: string;
    banco: string;
    moneda: Moneda;
    numero: string | null;
  };
  cuentaContable: {
    codigo: string;
    nombre: string;
  };
  asiento: {
    id: string;
    numero: number;
    estado: AsientoEstado;
    periodoCodigo: string;
  } | null;
  prestamo: {
    id: string;
    prestamista: string;
  } | null;
};

const DASH = "—";

function formatDate(d: Date) {
  return format(d, "dd/MM/yyyy");
}

function estadoVariant(estado: AsientoEstado): "default" | "outline" | "secondary" {
  switch (estado) {
    case "BORRADOR":
      return "outline";
    case "CONTABILIZADO":
      return "default";
    case "ANULADO":
      return "secondary";
  }
}

function tipoVariant(tipo: MovimientoTesoreriaTipo): "default" | "outline" | "secondary" {
  switch (tipo) {
    case "COBRO":
      return "default";
    case "PAGO":
      return "secondary";
    case "TRANSFERENCIA":
      return "outline";
  }
}

function FechaCell({
  row,
  onOpenDetalle,
}: {
  row: MovimientoWorklistRow;
  onOpenDetalle: (row: MovimientoWorklistRow) => void;
}) {
  return (
    <EntityLink
      label={formatDate(row.fecha)}
      onOpen={() => onOpenDetalle(row)}
      tabLabel={`Movimiento ${row.tipo}`}
    />
  );
}

function CuentaBancariaCell({ row }: { row: MovimientoWorklistRow }) {
  return (
    <div className="flex flex-col leading-tight">
      <span className="text-sm">
        {row.cuentaBancaria.banco}
        <span className="ml-1 font-mono text-xs text-muted-foreground">
          · {row.cuentaBancaria.moneda}
        </span>
      </span>
      <span className="font-mono text-xs text-muted-foreground">
        {row.cuentaBancaria.numero ?? ""}
      </span>
    </div>
  );
}

function DescripcionCell({ row }: { row: MovimientoWorklistRow }) {
  const text = row.descripcion ?? DASH;
  const isAnulado = row.asiento?.estado === "ANULADO";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              "block max-w-[32ch] truncate text-sm",
              isAnulado && "line-through opacity-60",
            )}
          />
        }
      >
        {text}
      </TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  );
}

function EstadoCell({ row }: { row: MovimientoWorklistRow }) {
  const a = row.asiento;
  if (!a) return <span className="text-xs text-muted-foreground">{DASH}</span>;
  return (
    <div className="flex items-center gap-2">
      <Badge variant={estadoVariant(a.estado)}>{a.estado}</Badge>
      <span className="font-mono text-xs text-muted-foreground">Nº {a.numero}</span>
    </div>
  );
}

function RowActions({
  row,
  onAnular,
}: {
  row: MovimientoWorklistRow;
  onAnular: (row: MovimientoWorklistRow) => void;
}) {
  const puedeAnular = row.asiento?.estado === "CONTABILIZADO";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Acciones" />}>
        <HugeiconsIcon icon={MoreHorizontalCircle01Icon} strokeWidth={2} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          render={<a href={`/tesoreria/movimientos/${row.id}`}>Ver detalles (página completa)</a>}
        />
        {puedeAnular && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => onAnular(row)}>
              <HugeiconsIcon icon={CancelCircleIcon} strokeWidth={2} />
              Anular
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function buildMovimientosColumns({
  moneda,
  tc,
  onOpenDetalle,
  onAnular,
}: {
  moneda: Moneda;
  tc: string | null;
  onOpenDetalle: (row: MovimientoWorklistRow) => void;
  onAnular: (row: MovimientoWorklistRow) => void;
}): ColumnDef<MovimientoWorklistRow, unknown>[] {
  return [
    {
      id: "fecha",
      accessorFn: (r) => r.fecha.getTime(),
      header: "Fecha",
      meta: { pinned: "left", width: 130, label: "Fecha" },
      cell: ({ row }) => <FechaCell row={row.original} onOpenDetalle={onOpenDetalle} />,
    },
    {
      accessorKey: "tipo",
      header: "Tipo",
      meta: { width: 130, label: "Tipo" },
      cell: ({ row }) => (
        <Badge variant={tipoVariant(row.original.tipo)}>{row.original.tipo}</Badge>
      ),
    },
    {
      id: "cuentaBancaria",
      accessorFn: (r) => r.banco,
      header: "Cuenta bancaria",
      meta: { width: 220, label: "Cuenta bancaria" },
      cell: ({ row }) => <CuentaBancariaCell row={row.original} />,
    },
    {
      accessorKey: "descripcion",
      header: "Descripción",
      enableSorting: false,
      meta: { label: "Descripción" },
      cell: ({ row }) => <DescripcionCell row={row.original} />,
    },
    {
      id: "monto",
      accessorFn: (r) => Number(r.monto),
      header: () => <span className="block text-right">Monto</span>,
      meta: { align: "right", width: 140, label: "Monto" },
      cell: ({ row }) => (
        <span className="block text-right font-mono text-sm tabular-nums">
          {fmtMontoPres(row.original.monto, row.original.moneda, moneda, tc)}
        </span>
      ),
    },
    {
      id: "moneda",
      header: "Moneda",
      meta: { width: 90, label: "Moneda" },
      cell: () => <span className="font-mono text-xs">{moneda}</span>,
    },
    {
      id: "estado",
      accessorFn: (r) => r.asiento?.estado ?? "",
      header: "Estado",
      meta: { width: 160, label: "Estado" },
      cell: ({ row }) => <EstadoCell row={row.original} />,
    },
    {
      id: "acciones",
      header: () => <span className="sr-only">Acciones</span>,
      enableSorting: false,
      meta: { width: 60, label: "Acciones" },
      cell: ({ row }) => <RowActions row={row.original} onAnular={onAnular} />,
    },
  ];
}
