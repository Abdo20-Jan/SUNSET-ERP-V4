"use client";

import { useEffect, useState, useTransition } from "react";
import { format } from "date-fns";

import { getAsientoDetalle, type AsientoDetalle } from "@/lib/actions/asientos";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FloatingWorkWindow } from "@/components/record/floating-work-window";

/*
 * AsientoDetalleWorkWindow (CONT-01 · PR-028) — migra el drawer lateral
 * `asiento-detalle-sheet.tsx` (el 5º y último drawer de negocio) a
 * FloatingWorkWindow (G-04). Read-only: SÓLO cambia el contenedor
 * (Sheet → FWW). El body (dl Fecha/Origen/Moneda/TC + grilla de líneas +
 * Totales) y el fetch `getAsientoDetalle` (CALL, no se modifica) son
 * idénticos al sheet — precedente exacto: `movimiento-detalle-work-window`
 * (PR-025a). El superset USD por línea sigue siendo papel del record `[id]`.
 */

type Props = {
  asientoId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function estadoVariant(estado: AsientoDetalle["estado"]): "default" | "outline" | "secondary" {
  switch (estado) {
    case "BORRADOR":
      return "outline";
    case "CONTABILIZADO":
      return "default";
    case "ANULADO":
      return "secondary";
  }
}

export function AsientoDetalleWorkWindow({ asientoId, open, onOpenChange }: Props) {
  const [detalle, setDetalle] = useState<AsientoDetalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!open || !asientoId) {
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset state antes de fetch dependente de prop
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
    <FloatingWorkWindow
      open={open}
      onOpenChange={onOpenChange}
      title={
        <span className="flex items-center gap-3">
          <span>{detalle ? `Asiento Nº ${detalle.numero}` : "Asiento"}</span>
          {detalle && (
            <>
              <Badge variant="outline" className="font-mono text-xs">
                {detalle.periodoCodigo}
              </Badge>
              <Badge variant={estadoVariant(detalle.estado)}>{detalle.estado}</Badge>
            </>
          )}
        </span>
      }
      description={
        detalle
          ? detalle.descripcion
          : error
            ? "No se pudo cargar el detalle."
            : "Cargando detalle del asiento…"
      }
      initialWidth={760}
      initialHeight={560}
    >
      <Separator />

      <div className="flex flex-col gap-6 p-6">
        {error && <p className="text-sm text-destructive">{error}</p>}

        {!detalle && !error && <DetalleSkeleton />}

        {detalle && (
          <>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <InfoRow label="Fecha" value={format(detalle.fecha, "dd/MM/yyyy")} />
              <InfoRow label="Origen" value={detalle.origen} />
              <InfoRow label="Moneda" value={detalle.moneda} />
              <InfoRow
                label="Tipo de cambio"
                value={Number(detalle.tipoCambio).toFixed(detalle.moneda === "ARS" ? 2 : 6)}
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
                      <TableCell className="font-mono text-xs">{l.cuentaCodigo}</TableCell>
                      <TableCell className="text-sm">{l.cuentaNombre}</TableCell>
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
    </FloatingWorkWindow>
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
