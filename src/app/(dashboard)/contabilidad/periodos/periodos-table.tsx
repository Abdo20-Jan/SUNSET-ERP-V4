"use client";

import { useState, useTransition } from "react";
import { type ColumnDef, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { toast } from "sonner";

import type { PeriodoEstado } from "@/generated/prisma/client";
import { cerrarPeriodo, reabrirPeriodo, type PeriodoActionResult } from "@/lib/actions/periodos";
import { fmtDate } from "@/lib/format";
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
import { DataTable } from "@/components/ui/data-table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export type PeriodoRow = {
  id: number;
  codigo: string;
  nombre: string;
  fechaInicio: Date;
  fechaFin: Date;
  estado: PeriodoEstado;
  borradorCount: number;
};

type PendingAction = { action: "cerrar" | "reabrir"; periodo: PeriodoRow } | null;

export function PeriodosTable({ data }: { data: PeriodoRow[] }) {
  const [pending, setPending] = useState<PendingAction>(null);
  const [isSubmitting, startTransition] = useTransition();

  const columns: ColumnDef<PeriodoRow>[] = [
    {
      id: "codigo",
      header: "Código",
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.codigo}</span>,
    },
    {
      id: "nombre",
      header: "Nombre",
      cell: ({ row }) => <span>{row.original.nombre}</span>,
    },
    {
      id: "fechaInicio",
      header: "Inicio",
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">{fmtDate(row.original.fechaInicio)}</span>
      ),
    },
    {
      id: "fechaFin",
      header: "Fin",
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">{fmtDate(row.original.fechaFin)}</span>
      ),
    },
    {
      id: "estado",
      header: "Estado",
      cell: ({ row }) => (
        <Badge variant={row.original.estado === "ABIERTO" ? "default" : "secondary"}>
          {row.original.estado}
        </Badge>
      ),
    },
    {
      id: "acciones",
      header: () => <span className="sr-only">Acciones</span>,
      cell: ({ row }) => <RowAction periodo={row.original} onOpen={setPending} />,
    },
  ];

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const onConfirm = () => {
    if (!pending) return;
    const { action, periodo } = pending;
    const fn = action === "cerrar" ? cerrarPeriodo : reabrirPeriodo;
    const verbPast = action === "cerrar" ? "cerrado" : "reabierto";

    startTransition(async () => {
      const result: PeriodoActionResult = await fn(periodo.id);
      if (result.ok) {
        toast.success(`Período ${result.codigo} ${verbPast}.`);
        setPending(null);
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <TooltipProvider>
      <DataTable table={table} emptyMessage="Sin períodos." />

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
                  {pending.action === "cerrar"
                    ? `Cerrar período ${pending.periodo.codigo}`
                    : `Reabrir período ${pending.periodo.codigo}`}
                </DialogTitle>
                <DialogDescription>
                  {pending.periodo.nombre} · {fmtDate(pending.periodo.fechaInicio)} –{" "}
                  {fmtDate(pending.periodo.fechaFin)}
                  {pending.action === "cerrar"
                    ? ". Una vez cerrado, no se podrán crear ni modificar asientos en este período."
                    : ". Al reabrirlo, se podrán crear y modificar asientos nuevamente."}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPending(null)} disabled={isSubmitting}>
                  Cancelar
                </Button>
                <Button
                  variant={pending.action === "cerrar" ? "destructive" : "default"}
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
    </TooltipProvider>
  );
}

function RowAction({
  periodo,
  onOpen,
}: {
  periodo: PeriodoRow;
  onOpen: (p: PendingAction) => void;
}) {
  if (periodo.estado === "CERRADO") {
    return (
      <Button variant="default" size="sm" onClick={() => onOpen({ action: "reabrir", periodo })}>
        Reabrir
      </Button>
    );
  }

  const disabled = periodo.borradorCount > 0;
  const button = (
    <Button
      variant="destructive"
      size="sm"
      disabled={disabled}
      onClick={() => onOpen({ action: "cerrar", periodo })}
    >
      Cerrar
    </Button>
  );

  if (!disabled) return button;

  return (
    <Tooltip>
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: span wrapper necesario para mostrar tooltip sobre <Button disabled> (disabled no recibe foco ni eventos pointer) */}
      <TooltipTrigger render={<span tabIndex={0} />}>{button}</TooltipTrigger>
      <TooltipContent>{periodo.borradorCount} asiento(s) en BORRADOR</TooltipContent>
    </Tooltip>
  );
}
