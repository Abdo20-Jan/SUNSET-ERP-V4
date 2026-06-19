"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { format } from "date-fns";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  CancelCircleIcon,
  Coins01Icon,
  MoreHorizontalCircle01Icon,
  ViewIcon,
} from "@hugeicons/core-free-icons";

import type { EstadoAnticipo } from "@/generated/prisma/client";
import { type AnticipoRow, anularAnticipoProveedorAction } from "@/lib/actions/anticipos-proveedor";
import { fmtMontoPres } from "@/lib/format";
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
import { AnticipoDetalleSheet } from "./anticipo-detalle-sheet";

const ESTADO_LABEL: Record<EstadoAnticipo, string> = {
  VIGENTE: "Vigente",
  APLICADO_TOTAL: "Aplicado total",
  ANULADO: "Anulado",
};

function estadoVariant(estado: EstadoAnticipo): "default" | "outline" | "secondary" {
  switch (estado) {
    case "VIGENTE":
      return "default";
    case "APLICADO_TOTAL":
      return "secondary";
    case "ANULADO":
      return "outline";
  }
}

export function AnticiposTable({
  data,
  anticipoInicial,
  moneda,
  tc,
}: {
  data: AnticipoRow[];
  anticipoInicial?: AnticipoRow | null;
  moneda: Moneda;
  tc: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<AnticipoRow | null>(null);
  const [detalle, setDetalle] = useState<AnticipoRow | null>(anticipoInicial ?? null);
  const [isSubmitting, startTransition] = useTransition();

  const columns: ColumnDef<AnticipoRow>[] = [
    {
      id: "numero",
      header: "Número",
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">{row.original.numero}</span>
      ),
    },
    {
      id: "proveedor",
      header: "Proveedor",
      cell: ({ row }) => (
        <span className="text-sm font-medium">{row.original.proveedor.nombre}</span>
      ),
    },
    {
      id: "cuentaContable",
      header: "Cuenta",
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
      id: "cuentaBancaria",
      header: "Banco",
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
      id: "fecha",
      header: "Fecha",
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">
          {format(new Date(row.original.fecha), "dd/MM/yyyy")}
        </span>
      ),
    },
    {
      id: "monto",
      header: () => <span className="block text-right">Monto</span>,
      cell: ({ row }) => (
        <span className="block text-right font-mono text-sm tabular-nums">
          {fmtMontoPres(row.original.montoArs, "ARS", moneda, tc)}{" "}
          <span className="text-xs text-muted-foreground">{moneda}</span>
        </span>
      ),
    },
    {
      id: "saldo",
      header: () => <span className="block text-right">Saldo pendiente</span>,
      cell: ({ row }) => (
        <span className="block text-right font-mono text-sm font-semibold tabular-nums">
          {fmtMontoPres(row.original.saldoPendienteArs, "ARS", moneda, tc)}{" "}
          <span className="text-xs text-muted-foreground">{moneda}</span>
        </span>
      ),
    },
    {
      id: "estado",
      header: "Estado",
      cell: ({ row }) => (
        <Badge variant={estadoVariant(row.original.estado)}>
          {ESTADO_LABEL[row.original.estado]}
        </Badge>
      ),
    },
    {
      id: "acciones",
      header: () => <span className="sr-only">Acciones</span>,
      cell: ({ row }) => (
        <RowActions
          anticipo={row.original}
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
    const anticipoId = pending.id;
    startTransition(async () => {
      const result = await anularAnticipoProveedorAction({ anticipoId });
      if (result.ok) {
        toast.success("Anticipo anulado.");
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
                Todavía no hay anticipos registrados.
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
                <DialogTitle>Anular anticipo {pending.numero}</DialogTitle>
                <DialogDescription>
                  Monto: {fmtMontoPres(pending.montoArs, "ARS", moneda, tc)} {moneda}. Al anularlo,
                  el asiento de la salida de dinero pasará a ANULADO y el banco vuelve a su saldo
                  previo. El número del asiento se conserva para auditoría.
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

      <AnticipoDetalleSheet
        anticipoId={detalle?.id ?? null}
        proveedorId={detalle?.proveedor.id ?? null}
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
  anticipo,
  onOpenDetalle,
  onAnular,
}: {
  anticipo: AnticipoRow;
  onOpenDetalle: () => void;
  onAnular: () => void;
}) {
  const router = useRouter();
  const puedeAplicar = anticipo.estado === "VIGENTE" && Number(anticipo.saldoPendienteArs) > 0;
  const puedeAnular = anticipo.estado === "VIGENTE" && Number(anticipo.saldoAplicadoArs) === 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Acciones" />}>
        <HugeiconsIcon icon={MoreHorizontalCircle01Icon} strokeWidth={2} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onOpenDetalle}>
          <HugeiconsIcon icon={ViewIcon} strokeWidth={2} />
          Ver detalle
        </DropdownMenuItem>
        {puedeAplicar && (
          <DropdownMenuItem
            onClick={() => router.push(`/tesoreria/anticipos?anticipoId=${anticipo.id}`)}
          >
            <HugeiconsIcon icon={Coins01Icon} strokeWidth={2} />
            Aplicar a factura
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
