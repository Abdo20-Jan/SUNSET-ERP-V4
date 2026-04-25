"use client";

import { useEffect, useState, useTransition } from "react";
import { format } from "date-fns";

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

type Props = {
  asientoId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function estadoVariant(
  estado: AsientoDetalle["estado"],
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

export function AsientoDetalleSheet({ asientoId, open, onOpenChange }: Props) {
  const [detalle, setDetalle] = useState<AsientoDetalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!open || !asientoId) {
      return;
    }
    setDetalle(null);
    setError(null);
    startTransition(async () => {
      const result = await getAsientoDetalle(asientoId);
      if (result.ok) {
        setDetalle(result.detalle);
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
              {detalle ? `Asiento Nº ${detalle.numero}` : "Asiento"}
            </SheetTitle>
            {detalle && (
              <>
                <Badge variant="outline" className="font-mono text-xs">
                  {detalle.periodoCodigo}
                </Badge>
                <Badge variant={estadoVariant(detalle.estado)}>
                  {detalle.estado}
                </Badge>
              </>
            )}
          </div>
          <SheetDescription>
            {detalle
              ? detalle.descripcion
              : error
                ? "No se pudo cargar el detalle."
                : "Cargando detalle del asiento…"}
          </SheetDescription>
        </SheetHeader>

        <Separator />

        <div className="flex flex-col gap-6 p-6">
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          {!detalle && !error && <DetalleSkeleton />}

          {detalle && (
            <>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <InfoRow label="Fecha" value={format(detalle.fecha, "dd/MM/yyyy")} />
                <InfoRow label="Origen" value={detalle.origen} />
                <InfoRow label="Moneda" value={detalle.moneda} />
                <InfoRow
                  label="Tipo de cambio"
                  value={Number(detalle.tipoCambio).toFixed(
                    detalle.moneda === "ARS" ? 2 : 6,
                  )}
                />
              </dl>

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
                    {detalle.lineas.map((l) => (
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
                      <TableCell colSpan={3} className="text-right text-sm font-medium">
                        Totales
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm font-semibold tabular-nums">
                        {detalle.totalDebe}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm font-semibold tabular-nums">
                        {detalle.totalHaber}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </>
          )}
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

function DetalleSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
      <Skeleton className="h-48" />
    </div>
  );
}
