"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon } from "@hugeicons/core-free-icons";

import type { AsientoEstado } from "@/generated/prisma/client";
import {
  obtenerPrestamoDetalle,
  type PrestamoDetalle,
} from "@/lib/actions/prestamos";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
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
  prestamoId: string | null;
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

function formatMoney(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return n.toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function PrestamoDetalleSheet({
  prestamoId,
  open,
  onOpenChange,
}: Props) {
  const [detalle, setDetalle] = useState<PrestamoDetalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!open || !prestamoId) {
      return;
    }
    setDetalle(null);
    setError(null);
    startTransition(async () => {
      const result = await obtenerPrestamoDetalle(prestamoId);
      if (result) {
        setDetalle(result);
      } else {
        setError("Préstamo no encontrado.");
      }
    });
  }, [open, prestamoId]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto sm:!max-w-2xl"
      >
        <SheetHeader className="gap-2">
          <div className="flex items-center gap-3">
            <SheetTitle>
              {detalle ? `Préstamo · ${detalle.prestamista}` : "Préstamo"}
            </SheetTitle>
            {detalle?.asiento && (
              <>
                <Badge variant="outline" className="font-mono text-xs">
                  Nº {detalle.asiento.numero}
                </Badge>
                <Badge variant={estadoVariant(detalle.asiento.estado)}>
                  {detalle.asiento.estado}
                </Badge>
              </>
            )}
          </div>
          <SheetDescription>
            Detalle del préstamo, asiento de recepción y amortizaciones
            registradas.
          </SheetDescription>
        </SheetHeader>

        <Separator />

        <div className="flex flex-col gap-6 p-6">
          {error && <p className="text-sm text-destructive">{error}</p>}

          {!detalle && !error && <DetalleSkeleton />}

          {detalle && (
            <>
              <section className="flex flex-col gap-3">
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Datos del préstamo
                </h3>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                  <InfoRow label="Prestamista" value={detalle.prestamista} />
                  <InfoRow
                    label="Clasificación"
                    value={
                      detalle.clasificacion === "CORTO_PLAZO"
                        ? "Corto plazo"
                        : "Largo plazo"
                    }
                  />
                  <InfoRow
                    label="Cuenta bancaria"
                    value={`${detalle.cuentaBancaria.banco} · ${detalle.cuentaBancaria.numero}`}
                  />
                  <InfoRow
                    label="Cuenta contable"
                    value={`${detalle.cuentaContable.codigo} — ${detalle.cuentaContable.nombre}`}
                  />
                  <InfoRow
                    label="Principal"
                    value={`${formatMoney(detalle.principal)} ${detalle.moneda}`}
                  />
                  <InfoRow
                    label="Tipo de cambio"
                    value={Number(detalle.tipoCambio).toFixed(
                      detalle.moneda === "ARS" ? 2 : 6,
                    )}
                  />
                  <InfoRow
                    label="Valor en ARS"
                    value={formatMoney(detalle.valorArs)}
                  />
                  <InfoRow
                    label="Saldo pendiente"
                    value={formatMoney(detalle.saldoPendiente)}
                    highlight
                  />
                </dl>
              </section>

              <Separator />

              <section className="flex flex-col gap-3">
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Asiento de recepción
                </h3>
                {!detalle.asiento ? (
                  <p className="text-sm text-muted-foreground">
                    Este préstamo todavía no tiene asiento asociado.
                  </p>
                ) : (
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
                        {detalle.asiento.lineas.map((l, i) => (
                          <TableRow key={i}>
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
                              {Number(l.debe) > 0 ? formatMoney(l.debe) : ""}
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm tabular-nums">
                              {Number(l.haber) > 0 ? formatMoney(l.haber) : ""}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </section>

              <Separator />

              <section className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Amortizaciones (pagos contabilizados)
                  </h3>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">
                      {detalle.amortizaciones.length} registrada
                      {detalle.amortizaciones.length === 1 ? "" : "s"}
                    </span>
                    <AmortizacionCTA detalle={detalle} />
                  </div>
                </div>
                {detalle.amortizaciones.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Sin amortizaciones registradas. Use el botón{" "}
                    <span className="font-medium">Registrar amortización</span>{" "}
                    para generar un pago con contrapartida en la cuenta{" "}
                    <span className="font-mono">
                      {detalle.cuentaContable.codigo}
                    </span>
                    .
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Fecha</TableHead>
                          <TableHead>Cuenta bancaria</TableHead>
                          <TableHead className="text-right">Monto</TableHead>
                          <TableHead>Asiento</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detalle.amortizaciones.map((a) => (
                          <TableRow key={a.movimientoId}>
                            <TableCell className="text-sm tabular-nums">
                              {format(new Date(a.fecha), "dd/MM/yyyy")}
                            </TableCell>
                            <TableCell className="text-sm">
                              {a.cuentaBancaria}
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm tabular-nums">
                              {formatMoney(a.monto)}{" "}
                              <span className="text-xs text-muted-foreground">
                                {a.moneda}
                              </span>
                            </TableCell>
                            <TableCell className="font-mono text-xs text-muted-foreground">
                              {a.asientoNumero ? `Nº ${a.asientoNumero}` : "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function InfoRow({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={
          highlight
            ? "font-mono text-sm font-semibold"
            : "font-mono text-sm"
        }
      >
        {value}
      </dd>
    </div>
  );
}

function DetalleSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-48" />
      <Skeleton className="h-32" />
    </div>
  );
}

function AmortizacionCTA({ detalle }: { detalle: PrestamoDetalle }) {
  if (detalle.asiento?.estado !== "CONTABILIZADO") {
    return (
      <span className="text-xs text-muted-foreground">
        Asiento {detalle.asiento?.estado.toLowerCase() ?? "sin registrar"} — no
        se puede amortizar
      </span>
    );
  }
  const href = `/tesoreria/movimientos/nuevo?prestamoId=${detalle.id}&modo=amortizacion`;
  return (
    <Link
      href={href}
      className={buttonVariants({ variant: "default", size: "sm" })}
    >
      <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
      Registrar amortización
    </Link>
  );
}
