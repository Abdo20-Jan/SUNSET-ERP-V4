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

import type { PeriodoEstado } from "@/generated/prisma/client";
import {
  cerrarPeriodo,
  reabrirPeriodo,
  type PeriodoActionResult,
} from "@/lib/actions/periodos";
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

export type PeriodoRow = {
  id: number;
  codigo: string;
  nombre: string;
  fechaInicio: Date;
  fechaFin: Date;
  estado: PeriodoEstado;
  borradorCount: number;
};

type PendingAction =
  | { action: "cerrar" | "reabrir"; periodo: PeriodoRow }
  | null;

function formatDate(d: Date) {
  return format(d, "dd/MM/yyyy");
}

export function PeriodosTable({ data }: { data: PeriodoRow[] }) {
  const [pending, setPending] = useState<PendingAction>(null);
  const [isSubmitting, startTransition] = useTransition();

  const columns: ColumnDef<PeriodoRow>[] = [
    {
      id: "codigo",
      header: "Código",
      cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.codigo}</span>
      ),
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
        <span className="text-sm tabular-nums">
          {formatDate(row.original.fechaInicio)}
        </span>
      ),
    },
    {
      id: "fechaFin",
      header: "Fin",
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">
          {formatDate(row.original.fechaFin)}
        </span>
      ),
    },
    {
      id: "estado",
      header: "Estado",
      cell: ({ row }) => (
        <Badge
          variant={row.original.estado === "ABIERTO" ? "default" : "secondary"}
        >
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
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
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
                  {pending.action === "cerrar"
                    ? `Cerrar período ${pending.periodo.codigo}`
                    : `Reabrir período ${pending.periodo.codigo}`}
                </DialogTitle>
                <DialogDescription>
                  {pending.periodo.nombre} · {formatDate(pending.periodo.fechaInicio)}{" "}
                  – {formatDate(pending.periodo.fechaFin)}
                  {pending.action === "cerrar"
                    ? ". Una vez cerrado, no se podrán crear ni modificar asientos en este período."
                    : ". Al reabrirlo, se podrán crear y modificar asientos nuevamente."}
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
      <Button
        variant="default"
        size="sm"
        onClick={() => onOpen({ action: "reabrir", periodo })}
      >
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
      <TooltipTrigger render={<span tabIndex={0} />}>{button}</TooltipTrigger>
      <TooltipContent>
        {periodo.borradorCount} asiento(s) en BORRADOR
      </TooltipContent>
    </Tooltip>
  );
}
