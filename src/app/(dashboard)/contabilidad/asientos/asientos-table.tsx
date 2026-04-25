"use client";

import { useState, useTransition } from "react";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { format } from "date-fns";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  CancelCircleIcon,
  CheckmarkCircle02Icon,
  MoreHorizontalCircle01Icon,
  ViewIcon,
} from "@hugeicons/core-free-icons";

import type {
  AsientoEstado,
  AsientoOrigen,
  Moneda,
} from "@/generated/prisma/client";
import {
  anularAsientoAction,
  contabilizarAsientoAction,
} from "@/lib/actions/asientos";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { AsientoDetalleSheet } from "./asiento-detalle-sheet";

export type AsientoRow = {
  id: string;
  numero: number;
  fecha: Date;
  descripcion: string;
  estado: AsientoEstado;
  origen: AsientoOrigen;
  moneda: Moneda;
  totalDebe: string;
  totalHaber: string;
  periodoCodigo: string;
};

type PendingAction =
  | { action: "contabilizar" | "anular"; asiento: AsientoRow }
  | null;

function formatDate(d: Date) {
  return format(d, "dd/MM/yyyy");
}

function estadoVariant(
  estado: AsientoEstado,
): "default" | "outline" | "secondary" {
  switch (estado) {
    case "BORRADOR":
      return "outline";
    case "CONTABILIZADO":
      return "default";
    case "ANULADO":
      return "secondary";
  }
}

export function AsientosTable({ data }: { data: AsientoRow[] }) {
  const [pending, setPending] = useState<PendingAction>(null);
  const [detalleId, setDetalleId] = useState<string | null>(null);
  const [isSubmitting, startTransition] = useTransition();

  const columns: ColumnDef<AsientoRow>[] = [
    {
      id: "numero",
      header: "N°",
      cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.numero}</span>
      ),
    },
    {
      id: "periodo",
      header: "Período",
      cell: ({ row }) => (
        <Badge variant="outline" className="font-mono text-xs">
          {row.original.periodoCodigo}
        </Badge>
      ),
    },
    {
      id: "fecha",
      header: "Fecha",
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">
          {formatDate(row.original.fecha)}
        </span>
      ),
    },
    {
      id: "descripcion",
      header: "Descripción",
      cell: ({ row }) => (
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                className={cn(
                  "block max-w-[32ch] truncate text-sm",
                  row.original.estado === "ANULADO" && "line-through opacity-60",
                )}
              />
            }
          >
            {row.original.descripcion}
          </TooltipTrigger>
          <TooltipContent>{row.original.descripcion}</TooltipContent>
        </Tooltip>
      ),
    },
    {
      id: "origen",
      header: "Origen",
      cell: ({ row }) => (
        <Badge variant="ghost" className="text-xs">
          {row.original.origen}
        </Badge>
      ),
    },
    {
      id: "moneda",
      header: "Moneda",
      cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.moneda}</span>
      ),
    },
    {
      id: "total",
      header: () => <span className="block text-right">Total</span>,
      cell: ({ row }) => (
        <span className="block text-right font-mono text-sm tabular-nums">
          {row.original.totalDebe}
        </span>
      ),
    },
    {
      id: "estado",
      header: "Estado",
      cell: ({ row }) => (
        <Badge variant={estadoVariant(row.original.estado)}>
          {row.original.estado}
        </Badge>
      ),
    },
    {
      id: "acciones",
      header: () => <span className="sr-only">Acciones</span>,
      cell: ({ row }) => (
        <RowActions
          asiento={row.original}
          onOpenDetalle={() => setDetalleId(row.original.id)}
          onAction={(action) => setPending({ action, asiento: row.original })}
        />
      ),
    },
  ];

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const onConfirm = () => {
    if (!pending) return;
    const { action, asiento } = pending;
    const fn =
      action === "contabilizar" ? contabilizarAsientoAction : anularAsientoAction;
    const verbPast = action === "contabilizar" ? "contabilizado" : "anulado";

    startTransition(async () => {
      const result = await fn(asiento.id);
      if (result.ok) {
        toast.success(`Asiento Nº ${result.numero} ${verbPast}.`);
        setPending(null);
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <TooltipProvider>
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id}>
                  {flexRender(
                    header.column.columnDef.header,
                    header.getContext(),
                  )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="py-12 text-center text-sm text-muted-foreground"
              >
                No hay asientos para los filtros seleccionados.
              </TableCell>
            </TableRow>
          ) : (
            table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && !isSubmitting) setPending(null);
        }}
      >
        <DialogContent>
          {pending && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {pending.action === "contabilizar"
                    ? `Contabilizar asiento Nº ${pending.asiento.numero}`
                    : `Anular asiento Nº ${pending.asiento.numero}`}
                </DialogTitle>
                <DialogDescription>
                  {pending.asiento.descripcion} · {formatDate(pending.asiento.fecha)}
                  {pending.action === "contabilizar"
                    ? ". Al contabilizarlo, las líneas pasarán a afectar saldos y reportes."
                    : ". Al anularlo, las líneas dejarán de afectar saldos. El número del asiento se mantiene para auditoría."}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setPending(null)}
                  disabled={isSubmitting}
                >
                  Cancelar
                </Button>
                <Button
                  variant={
                    pending.action === "anular" ? "destructive" : "default"
                  }
                  onClick={onConfirm}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Procesando…" : "Confirmar"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AsientoDetalleSheet
        asientoId={detalleId}
        open={detalleId !== null}
        onOpenChange={(open) => {
          if (!open) setDetalleId(null);
        }}
      />
    </TooltipProvider>
  );
}

function RowActions({
  asiento,
  onOpenDetalle,
  onAction,
}: {
  asiento: AsientoRow;
  onOpenDetalle: () => void;
  onAction: (action: "contabilizar" | "anular") => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label="Acciones" />
        }
      >
        <HugeiconsIcon icon={MoreHorizontalCircle01Icon} strokeWidth={2} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onOpenDetalle}>
          <HugeiconsIcon icon={ViewIcon} strokeWidth={2} />
          Ver detalles
        </DropdownMenuItem>
        {asiento.estado === "BORRADOR" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onAction("contabilizar")}>
              <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} />
              Contabilizar
            </DropdownMenuItem>
          </>
        )}
        {asiento.estado === "CONTABILIZADO" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => onAction("anular")}
            >
              <HugeiconsIcon icon={CancelCircleIcon} strokeWidth={2} />
              Anular
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
