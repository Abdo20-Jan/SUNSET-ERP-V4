"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";

import type { EstadoAnticipo } from "@/generated/prisma/client";
import {
  type AnticipoDetalle,
  type FacturaAplicableOption,
  anularAnticipoProveedorAction,
  aplicarAnticipoProveedorAction,
  getAnticipoDetalle,
  listarFacturasAplicablesProveedor,
} from "@/lib/actions/anticipos-proveedor";
import { toast } from "sonner";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  anticipoId: string | null;
  proveedorId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

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

function formatMoney(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return n.toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function AnticipoDetalleSheet({ anticipoId, proveedorId, open, onOpenChange }: Props) {
  const router = useRouter();
  const [detalle, setDetalle] = useState<AnticipoDetalle | null>(null);
  const [facturas, setFacturas] = useState<FacturaAplicableOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [, startLoad] = useTransition();

  const [facturaSel, setFacturaSel] = useState<string>("");
  const [montoAplicar, setMontoAplicar] = useState<string>("");
  const [isApplying, startApply] = useTransition();

  const [confirmAnular, setConfirmAnular] = useState(false);
  const [isAnulando, startAnular] = useTransition();

  // TODO(fase-4): substituir por `key={anticipoId}` no parent.
  useEffect(() => {
    if (!open || !anticipoId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset antes de fetch
    setDetalle(null);
    setError(null);
    setFacturaSel("");
    setMontoAplicar("");
    startLoad(async () => {
      const result = await getAnticipoDetalle(anticipoId);
      if (result) {
        setDetalle(result);
        setMontoAplicar(result.saldoPendienteArs);
        if (result.estado === "VIGENTE" && proveedorId) {
          const fs = await listarFacturasAplicablesProveedor(proveedorId);
          setFacturas(fs);
        } else {
          setFacturas([]);
        }
      } else {
        setError("Anticipo no encontrado.");
      }
    });
  }, [open, anticipoId, proveedorId]);

  const puedeAplicar = detalle?.estado === "VIGENTE" && Number(detalle.saldoPendienteArs) > 0;
  const puedeAnular = detalle?.estado === "VIGENTE" && Number(detalle.saldoAplicadoArs) === 0;

  const onAplicar = () => {
    if (!detalle || !facturaSel) return;
    const factura = facturas.find((f) => `${f.tipo}:${f.id}` === facturaSel);
    if (!factura) return;
    startApply(async () => {
      const result = await aplicarAnticipoProveedorAction({
        anticipoId: detalle.id,
        compraId: factura.tipo === "compra" ? factura.id : null,
        gastoId: factura.tipo === "gasto" ? factura.id : null,
        montoArs: montoAplicar,
      });
      if (result.ok) {
        toast.success(`Anticipo aplicado — Asiento Nº ${result.asientoNumero}`);
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const onAnular = () => {
    if (!detalle) return;
    startAnular(async () => {
      const result = await anularAnticipoProveedorAction({ anticipoId: detalle.id });
      if (result.ok) {
        toast.success("Anticipo anulado.");
        setConfirmAnular(false);
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto sm:!max-w-2xl"
      >
        <SheetHeader className="gap-2">
          <div className="flex items-center gap-3">
            <SheetTitle>{detalle ? `Anticipo ${detalle.numero}` : "Anticipo"}</SheetTitle>
            {detalle && (
              <Badge variant={estadoVariant(detalle.estado)}>{ESTADO_LABEL[detalle.estado]}</Badge>
            )}
            {detalle?.asiento && (
              <Badge variant="outline" className="font-mono text-xs">
                Nº {detalle.asiento.numero}
              </Badge>
            )}
          </div>
          <SheetDescription>
            Detalle del anticipo, aplicaciones a facturas y acciones disponibles.
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
                  Datos del anticipo
                </h3>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                  <InfoRow label="Proveedor" value={detalle.proveedor.nombre} />
                  <InfoRow label="Fecha" value={format(new Date(detalle.fecha), "dd/MM/yyyy")} />
                  <InfoRow
                    label="Cuenta de anticipo"
                    value={`${detalle.cuentaContable.codigo} — ${detalle.cuentaContable.nombre}`}
                  />
                  <InfoRow
                    label="Cuenta bancaria"
                    value={`${detalle.cuentaBancaria.banco} · ${detalle.cuentaBancaria.numero ?? "—"}`}
                  />
                  <InfoRow
                    label="Monto"
                    value={`${formatMoney(detalle.montoArs)} ${detalle.moneda}`}
                  />
                  <InfoRow label="Aplicado" value={formatMoney(detalle.saldoAplicadoArs)} />
                  <InfoRow
                    label="Saldo pendiente"
                    value={formatMoney(detalle.saldoPendienteArs)}
                    highlight
                  />
                  {detalle.descripcion && (
                    <InfoRow label="Descripción" value={detalle.descripcion} />
                  )}
                </dl>
              </section>

              <Separator />

              <section className="flex flex-col gap-3">
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Aplicaciones registradas
                </h3>
                {detalle.aplicaciones.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sin aplicaciones registradas.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Fecha</TableHead>
                          <TableHead>Factura</TableHead>
                          <TableHead className="text-right">Monto</TableHead>
                          <TableHead>Asiento</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detalle.aplicaciones.map((ap) => (
                          <TableRow key={ap.id}>
                            <TableCell className="text-sm tabular-nums">
                              {format(new Date(ap.fecha), "dd/MM/yyyy")}
                            </TableCell>
                            <TableCell className="text-sm">
                              {ap.factura ? (
                                <span>
                                  <span className="text-xs uppercase text-muted-foreground">
                                    {ap.factura.tipo}
                                  </span>{" "}
                                  {ap.factura.numero}
                                </span>
                              ) : (
                                "—"
                              )}
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm tabular-nums">
                              {formatMoney(ap.montoArs)}
                            </TableCell>
                            <TableCell className="font-mono text-xs text-muted-foreground">
                              {ap.asientoNumero ? `Nº ${ap.asientoNumero}` : "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </section>

              {puedeAplicar && (
                <>
                  <Separator />
                  <section className="flex flex-col gap-3">
                    <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Aplicar a factura
                    </h3>
                    {facturas.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        El proveedor no tiene facturas emitidas/contabilizadas disponibles para
                        aplicar.
                      </p>
                    ) : (
                      <div className="flex flex-col gap-4 rounded-md border bg-muted/20 p-4">
                        <div className="flex flex-col gap-2">
                          <Label>Factura</Label>
                          <Select value={facturaSel} onValueChange={(v) => setFacturaSel(v ?? "")}>
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Seleccione la factura a cancelar" />
                            </SelectTrigger>
                            <SelectContent>
                              {facturas.map((f) => (
                                <SelectItem key={`${f.tipo}:${f.id}`} value={`${f.tipo}:${f.id}`}>
                                  <span className="text-xs uppercase text-muted-foreground">
                                    {f.tipo}
                                  </span>{" "}
                                  {f.numero} · {formatMoney(f.total)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex flex-col gap-2">
                          <Label htmlFor="montoAplicar">Monto a aplicar (ARS)</Label>
                          <Input
                            id="montoAplicar"
                            inputMode="decimal"
                            className="text-right tabular-nums"
                            value={montoAplicar}
                            onChange={(e) => setMontoAplicar(e.target.value)}
                          />
                          <p className="text-xs text-muted-foreground">
                            Saldo pendiente: {formatMoney(detalle.saldoPendienteArs)}
                          </p>
                        </div>
                        <div className="flex justify-end">
                          <Button onClick={onAplicar} disabled={isApplying || !facturaSel}>
                            {isApplying ? "Aplicando…" : "Aplicar"}
                          </Button>
                        </div>
                      </div>
                    )}
                  </section>
                </>
              )}

              {puedeAnular && (
                <>
                  <Separator />
                  <section className="flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">
                      Anular revierte el asiento de la salida de dinero. Sólo disponible mientras el
                      anticipo no tenga aplicaciones.
                    </p>
                    <Button variant="destructive" onClick={() => setConfirmAnular(true)}>
                      Anular anticipo
                    </Button>
                  </section>
                </>
              )}
            </>
          )}
        </div>
      </SheetContent>

      <Dialog
        open={confirmAnular}
        onOpenChange={(o) => {
          if (!o && !isAnulando) setConfirmAnular(false);
        }}
      >
        <DialogContent>
          {detalle && (
            <>
              <DialogHeader>
                <DialogTitle>Anular anticipo {detalle.numero}</DialogTitle>
                <DialogDescription>
                  Monto: {formatMoney(detalle.montoArs)} {detalle.moneda}. Al anularlo, el asiento
                  de la salida de dinero pasará a ANULADO y el banco vuelve a su saldo previo. El
                  número del asiento se conserva para auditoría.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setConfirmAnular(false)}
                  disabled={isAnulando}
                >
                  Cancelar
                </Button>
                <Button variant="destructive" onClick={onAnular} disabled={isAnulando}>
                  {isAnulando ? "Procesando…" : "Anular"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
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
      <dd className={highlight ? "font-mono text-sm font-semibold" : "font-mono text-sm"}>
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
