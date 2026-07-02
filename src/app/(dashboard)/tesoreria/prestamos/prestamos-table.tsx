"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  CancelCircleIcon,
  Coins01Icon,
  MoreHorizontalCircle01Icon,
  ViewIcon,
} from "@hugeicons/core-free-icons";

import type { AsientoEstado, PrestamoClasificacion } from "@/generated/prisma/client";
import { anularPrestamoAction, type PrestamoRow } from "@/lib/actions/prestamos";
import { fmtMontoPres, pickSaldoNativo } from "@/lib/format";
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

import type { Moneda } from "../../reportes/_components/moneda-toggle";
// TES-02 · PR-025b: el detalle abre en FloatingWorkWindow (G-04, sin drawer
// lateral). El sheet legado `prestamo-detalle-sheet.tsx` queda en árbol, no
// importado (rollback).
import { PrestamoDetalleWorkWindow } from "./prestamo-detalle-work-window";

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

function clasificacionLabel(c: PrestamoClasificacion): string {
  return c === "CORTO_PLAZO" ? "CP" : "LP";
}

export function PrestamosTable({
  data,
  prestamoInicial,
  moneda,
  tc,
}: {
  data: PrestamoRow[];
  prestamoInicial?: PrestamoRow | null;
  moneda: Moneda;
  tc: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<PrestamoRow | null>(null);
  const [detalle, setDetalle] = useState<PrestamoRow | null>(prestamoInicial ?? null);
  const [isSubmitting, startTransition] = useTransition();

  const columns: ColumnDef<PrestamoRow>[] = [
    {
      id: "prestamista",
      header: "Prestamista",
      cell: ({ row }) => <span className="text-sm font-medium">{row.original.prestamista}</span>,
    },
    {
      id: "clasificacion",
      header: "Clas.",
      cell: ({ row }) => (
        <Badge variant="outline" className="font-mono text-xs">
          {clasificacionLabel(row.original.clasificacion)}
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
            {row.original.cuentaBancaria.numero}
          </span>
        </div>
      ),
    },
    {
      id: "cuentaContable",
      header: "Cuenta contable",
      cell: ({ row }) => (
        <div className="flex flex-col leading-tight">
          <span className="font-mono text-xs text-muted-foreground">
            {row.original.cuentaContable.codigo}
          </span>
          <span className="text-sm">{row.original.cuentaContable.nombre}</span>
        </div>
      ),
    },
    {
      id: "principal",
      header: () => <span className="block text-right">Principal</span>,
      cell: ({ row }) => (
        <span className="block text-right font-mono text-sm tabular-nums">
          {fmtMontoPres(row.original.principal, row.original.moneda, moneda, tc)}{" "}
          <span className="text-xs text-muted-foreground">{moneda}</span>
        </span>
      ),
    },
    {
      id: "tipoCambio",
      header: () => <span className="block text-right">TC</span>,
      cell: ({ row }) => (
        <span className="block text-right font-mono text-xs tabular-nums text-muted-foreground">
          {Number(row.original.tipoCambio).toFixed(row.original.moneda === "ARS" ? 2 : 6)}
        </span>
      ),
    },
    {
      id: "saldo",
      header: () => <span className="block text-right">Saldo pendiente</span>,
      cell: ({ row }) => {
        // Saldo en su moneda NATIVA (USD-nato invariante a TC, o ARS) → se
        // convierte a la moneda de presentación al TC de cierre.
        const { valor, monedaNativa } = pickSaldoNativo(
          row.original.saldoPendiente,
          row.original.saldoPendienteUsd,
        );
        const num = Number(valor);
        return (
          <span className="block text-right font-mono text-sm font-semibold tabular-nums">
            {fmtMontoPres(valor, monedaNativa, moneda, tc)}{" "}
            <span className="text-xs text-muted-foreground">{moneda}</span>
            {num < 0 && <span className="ml-1 text-xs text-destructive">(neg.)</span>}
          </span>
        );
      },
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
            <span className="font-mono text-xs text-muted-foreground">Nº {a.numero}</span>
          </div>
        );
      },
    },
    {
      id: "acciones",
      header: () => <span className="sr-only">Acciones</span>,
      cell: ({ row }) => (
        <RowActions
          prestamo={row.original}
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
    if (!pending) return;
    const prestamoId = pending.id;
    startTransition(async () => {
      const result = await anularPrestamoAction(prestamoId);
      if (result.ok) {
        toast.success("Préstamo anulado.");
        setPending(null);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <>
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id}>
                  {flexRender(header.column.columnDef.header, header.getContext())}
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
                Todavía no hay préstamos registrados.
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
                <DialogTitle>Anular préstamo de {pending.prestamista}</DialogTitle>
                <DialogDescription>
                  Principal: {fmtMontoPres(pending.principal, pending.moneda, moneda, tc)} {moneda}.
                  Al anularlo, el asiento pasará a ANULADO y dejará de afectar los saldos. Las
                  amortizaciones registradas se mantienen. El número del asiento se conserva para
                  auditoría.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPending(null)} disabled={isSubmitting}>
                  Cancelar
                </Button>
                <Button variant="destructive" onClick={onConfirm} disabled={isSubmitting}>
                  {isSubmitting ? "Procesando…" : "Anular"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <PrestamoDetalleWorkWindow
        prestamoId={detalle?.id ?? null}
        open={detalle !== null}
        onOpenChange={(open) => {
          if (!open) setDetalle(null);
        }}
        moneda={moneda}
        tc={tc}
      />
    </>
  );
}

function RowActions({
  prestamo,
  onOpenDetalle,
  onAnular,
}: {
  prestamo: PrestamoRow;
  onOpenDetalle: () => void;
  onAnular: () => void;
}) {
  const router = useRouter();
  const puedeAmortizar = prestamo.asiento?.estado === "CONTABILIZADO";
  const puedeAnular = prestamo.asiento?.estado === "CONTABILIZADO";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Acciones" />}>
        <HugeiconsIcon icon={MoreHorizontalCircle01Icon} strokeWidth={2} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onOpenDetalle}>
          <HugeiconsIcon icon={ViewIcon} strokeWidth={2} />
          Ver detalles
        </DropdownMenuItem>
        {puedeAmortizar && (
          <DropdownMenuItem
            onClick={() =>
              router.push(
                `/tesoreria/movimientos/nuevo?prestamoId=${prestamo.id}&modo=amortizacion`,
              )
            }
          >
            <HugeiconsIcon icon={Coins01Icon} strokeWidth={2} />
            Amortizar
          </DropdownMenuItem>
        )}
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
