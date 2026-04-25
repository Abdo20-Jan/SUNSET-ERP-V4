"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { format } from "date-fns";

import type { AsientoEstado } from "@/generated/prisma/client";
import {
  getAsientoDetalle,
  type AsientoDetalle,
} from "@/lib/actions/asientos";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import type { MovimientoRow } from "./movimientos-table";

type Props = {
  movimiento: MovimientoRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

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

export function MovimientoDetalleSheet({
  movimiento,
  open,
  onOpenChange,
}: Props) {
  const [asiento, setAsiento] = useState<AsientoDetalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const asientoId = movimiento?.asiento?.id ?? null;

  useEffect(() => {
    if (!open || !asientoId) {
      return;
    }
    setAsiento(null);
    setError(null);
    startTransition(async () => {
      const result = await getAsientoDetalle(asientoId);
      if (result.ok) {
        setAsiento(result.detalle);
      } else {
        setError(result.error);
      }
    });
  }, [open, asientoId]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto sm:!max-w-2xl"
      >
        <SheetHeader className="gap-2">
          <div className="flex items-center gap-3">
            <SheetTitle>
              {movimiento ? `Movimiento ${movimiento.tipo}` : "Movimiento"}
            </SheetTitle>
            {movimiento?.asiento && (
              <>
                <Badge variant="outline" className="font-mono text-xs">
                  Nº {movimiento.asiento.numero}
                </Badge>
                <Badge variant={estadoVariant(movimiento.asiento.estado)}>
                  {movimiento.asiento.estado}
                </Badge>
              </>
            )}
          </div>
          <SheetDescription>
            {movimiento?.descripcion ?? "Detalle del movimiento y asiento generado."}
          </SheetDescription>
        </SheetHeader>

        <Separator />

        <div className="flex flex-col gap-6 p-6">
          {movimiento && (
            <section className="flex flex-col gap-3">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Datos del movimiento
              </h3>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <InfoRow
                  label="Fecha"
                  value={format(movimiento.fecha, "dd/MM/yyyy")}
                />
                <InfoRow label="Tipo" value={movimiento.tipo} />
                <InfoRow
                  label="Cuenta bancaria"
                  value={`${movimiento.cuentaBancaria.banco} · ${movimiento.cuentaBancaria.numero}`}
                />
                <InfoRow
                  label="Monto"
                  value={`${movimiento.monto} ${movimiento.moneda}`}
                />
                <InfoRow
                  label="Tipo de cambio"
                  value={Number(movimiento.tipoCambio).toFixed(
                    movimiento.moneda === "ARS" ? 2 : 6,
                  )}
                />
                <ContrapartidaRow movimiento={movimiento} />
                <InfoRow
                  label="Comprobante"
                  value={movimiento.comprobante ?? "—"}
                />
                {movimiento.asiento && (
                  <InfoRow
                    label="Período"
                    value={movimiento.asiento.periodoCodigo}
                  />
                )}
              </dl>
            </section>
          )}

          <Separator />

          <section className="flex flex-col gap-3">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Asiento generado
            </h3>

            {!asientoId && (
              <p className="text-sm text-muted-foreground">
                Este movimiento todavía no tiene asiento asociado.
              </p>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}

            {asientoId && !asiento && !error && <DetalleSkeleton />}

            {asiento && (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-24">Código</TableHead>
                      <TableHead>Cuenta</TableHead>
                      <TableHead>Referencia</TableHead>
                      <TableHead className="text-right">Debe</TableHead>
                      <TableHead className="text-right">Haber</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {asiento.lineas.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell className="font-mono text-xs">
                          {l.cuentaCodigo}
                        </TableCell>
                        <TableCell className="text-sm">
                          {l.cuentaNombre}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {l.descripcion ?? "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm tabular-nums">
                          {Number(l.debe) > 0 ? l.debe : ""}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm tabular-nums">
                          {Number(l.haber) > 0 ? l.haber : ""}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="border-t-2">
                      <TableCell
                        colSpan={3}
                        className="text-right text-sm font-medium"
                      >
                        Totales
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm font-semibold tabular-nums">
                        {asiento.totalDebe}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm font-semibold tabular-nums">
                        {asiento.totalHaber}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono text-sm">{value}</dd>
    </div>
  );
}

function ContrapartidaRow({ movimiento }: { movimiento: MovimientoRow }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">Contrapartida</dt>
      <dd className="font-mono text-sm">
        {movimiento.cuentaContable.codigo} — {movimiento.cuentaContable.nombre}
      </dd>
      {movimiento.prestamo && (
        <Link
          href={`/tesoreria/prestamos?prestamoId=${movimiento.prestamo.id}`}
          className="mt-0.5 text-xs text-primary underline-offset-4 hover:underline"
        >
          Ver préstamo asociado ({movimiento.prestamo.prestamista}) →
        </Link>
      )}
    </div>
  );
}

function DetalleSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-48" />
    </div>
  );
}
