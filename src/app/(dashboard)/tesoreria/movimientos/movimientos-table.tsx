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
  MoreHorizontalCircle01Icon,
  ViewIcon,
} from "@hugeicons/core-free-icons";

import type {
  AsientoEstado,
  Moneda,
  MovimientoTesoreriaTipo,
} from "@/generated/prisma/client";
import { anularAsientoAction } from "@/lib/actions/asientos";
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

import { MovimientoDetalleSheet } from "./movimiento-detalle-sheet";

export type MovimientoRow = {
  id: string;
  tipo: MovimientoTesoreriaTipo;
  fecha: Date;
  monto: string;
  moneda: Moneda;
  tipoCambio: string;
  descripcion: string | null;
  comprobante: string | null;
  referenciaBanco: string | null;
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

function tipoVariant(
  tipo: MovimientoTesoreriaTipo,
): "default" | "outline" | "secondary" {
  switch (tipo) {
    case "COBRO":
      return "default";
    case "PAGO":
      return "secondary";
    case "TRANSFERENCIA":
      return "outline";
  }
}

export function MovimientosTable({ data }: { data: MovimientoRow[] }) {
  const [pending, setPending] = useState<MovimientoRow | null>(null);
  const [detalle, setDetalle] = useState<MovimientoRow | null>(null);
  const [isSubmitting, startTransition] = useTransition();

  const columns: ColumnDef<MovimientoRow>[] = [
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
      id: "tipo",
      header: "Tipo",
      cell: ({ row }) => (
        <Badge variant={tipoVariant(row.original.tipo)}>
          {row.original.tipo}
        </Badge>
      ),
    },
    {
      id: "cuentaBancaria",
      header: "Cuenta bancaria",
      cell: ({ row }) => (
        <div className="flex flex-col leading-tight">
          <span className="text-sm">
            {row.original.cuentaBancaria.banco}
            <span className="ml-1 font-mono text-xs text-muted-foreground">
              · {row.original.cuentaBancaria.moneda}
            </span>
          </span>
          <span className="font-mono text-xs text-muted-foreground">
            {row.original.cuentaBancaria.numero ?? ""}
          </span>
        </div>
      ),
    },
    {
      id: "descripcion",
      header: "Descripción",
      cell: ({ row }) => {
        const text = row.original.descripcion ?? "—";
        const isAnulado = row.original.asiento?.estado === "ANULADO";
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
      },
    },
    {
      id: "monto",
      header: () => <span className="block text-right">Monto</span>,
      cell: ({ row }) => (
        <span className="block text-right font-mono text-sm tabular-nums">
          {row.original.monto}
        </span>
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
      id: "estado",
      header: "Estado",
      cell: ({ row }) => {
        const a = row.original.asiento;
        if (!a) return <span className="text-xs text-muted-foreground">—</span>;
        return (
          <div className="flex items-center gap-2">
            <Badge variant={estadoVariant(a.estado)}>{a.estado}</Badge>
            <span className="font-mono text-xs text-muted-foreground">
              Nº {a.numero}
            </span>
          </div>
        );
      },
    },
    {
      id: "acciones",
      header: () => <span className="sr-only">Acciones</span>,
      cell: ({ row }) => (
        <RowActions
          movimiento={row.original}
          onOpenDetalle={() => setDetalle(row.original)}
          onAnular={() => setPending(row.original)}
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
    if (!pending || !pending.asiento) return;
    const asientoId = pending.asiento.id;
    startTransition(async () => {
      const result = await anularAsientoAction(asientoId);
      if (result.ok) {
        toast.success(`Movimiento anulado (asiento Nº ${result.numero}).`);
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
                No hay movimientos para los filtros seleccionados.
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
          {pending && pending.asiento && (
            <>
              <DialogHeader>
                <DialogTitle>
                  Anular movimiento Nº {pending.asiento.numero}
                </DialogTitle>
                <DialogDescription>
                  {pending.tipo} · {formatDate(pending.fecha)} ·{" "}
                  {pending.cuentaBancaria.banco} · {pending.monto}{" "}
                  {pending.moneda}. Al anularlo, el asiento pasará a ANULADO y
                  dejará de afectar saldos. El número se mantiene para
                  auditoría.
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
                  variant="destructive"
                  onClick={onConfirm}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Procesando…" : "Anular"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <MovimientoDetalleSheet
        movimiento={detalle}
        open={detalle !== null}
        onOpenChange={(open) => {
          if (!open) setDetalle(null);
        }}
      />
    </TooltipProvider>
  );
}

function RowActions({
  movimiento,
  onOpenDetalle,
  onAnular,
}: {
  movimiento: MovimientoRow;
  onOpenDetalle: () => void;
  onAnular: () => void;
}) {
  const puedeAnular = movimiento.asiento?.estado === "CONTABILIZADO";
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
          Ver detalles (panel)
        </DropdownMenuItem>
        <DropdownMenuItem
          render={
            <a href={`/tesoreria/movimientos/${movimiento.id}`}>
              Ver detalles (página completa)
            </a>
          }
        />
        {puedeAnular && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onAnular}>
              <HugeiconsIcon icon={CancelCircleIcon} strokeWidth={2} />
              Anular
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
