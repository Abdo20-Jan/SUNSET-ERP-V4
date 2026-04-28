"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { CancelCircleIcon } from "@hugeicons/core-free-icons";

import { anularCompraAction, type CompraDetalle } from "@/lib/actions/compras";
import { fmtDate, fmtMoney, fmtTipoCambio } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DateBadge } from "@/components/ui/date-badge";
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

type Props = {
  compra: CompraDetalle;
  proveedorNombre: string;
  productosMap: Record<string, { codigo: string; nombre: string }>;
  asientoNumero: number | null;
};

const CONDICION_LABELS: Record<string, string> = {
  CONTADO: "Contado",
  TRANSFERENCIA: "Transferencia",
  CHEQUE: "Cheque",
  TARJETA: "Tarjeta",
  CUENTA_CORRIENTE: "Cuenta corriente",
  OTRO: "Otro",
};

function estadoVariant(
  estado: CompraDetalle["estado"],
): "default" | "outline" | "secondary" | "destructive" {
  switch (estado) {
    case "BORRADOR":
      return "outline";
    case "EMITIDA":
      return "default";
    case "RECIBIDA":
      return "secondary";
    case "CANCELADA":
      return "destructive";
  }
}

export function CompraDetailView({
  compra,
  proveedorNombre,
  productosMap,
  asientoNumero,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const puedeAnular = compra.estado === "EMITIDA" && compra.asientoId !== null;

  const handleAnular = () => {
    startTransition(async () => {
      const result = await anularCompraAction(compra.id);
      if (result.ok) {
        toast.success("Compra anulada.");
        setConfirmOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <h1 className="text-[15px] font-semibold tracking-tight">
              Compra {compra.numero}
            </h1>
            <Badge variant={estadoVariant(compra.estado)}>
              {compra.estado}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {proveedorNombre} · {fmtDate(new Date(compra.fecha))} ·{" "}
            {CONDICION_LABELS[compra.condicionPago] ?? compra.condicionPago}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {puedeAnular && (
            <Button
              variant="destructive"
              onClick={() => setConfirmOpen(true)}
              disabled={isPending}
            >
              <HugeiconsIcon icon={CancelCircleIcon} strokeWidth={2} />
              Anular
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Stat label="Subtotal" value={`${fmtMoney(compra.subtotal)} ${compra.moneda}`} />
        <Stat label="IVA" value={`${fmtMoney(compra.iva)} ${compra.moneda}`} />
        <Stat
          label="IIBB + Otros"
          value={`${fmtMoney(
            (Number(compra.iibb) + Number(compra.otros)).toFixed(2),
          )} ${compra.moneda}`}
        />
        <Stat
          label="Total"
          value={`${fmtMoney(compra.total)} ${compra.moneda}`}
          emphasis
        />
      </div>

      <Card>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Fecha">{fmtDate(new Date(compra.fecha))}</Field>
          <Field label="Vencimiento">
            <DateBadge fecha={compra.fechaVencimiento} relative />
          </Field>
          <Field label="Tipo de cambio">
            {compra.moneda === "ARS"
              ? "—"
              : `1 USD = ${fmtTipoCambio(compra.tipoCambio)} ARS`}
          </Field>
          <Field label="Asiento contable">
            {asientoNumero != null ? (
              <span className="font-mono">Nº {asientoNumero}</span>
            ) : (
              <span className="text-muted-foreground">Sin asiento</span>
            )}
          </Field>
          {compra.notas && (
            <Field label="Notas" wide>
              {compra.notas}
            </Field>
          )}
        </CardContent>
      </Card>

      <Card className="py-0">
        <Table>
          <caption className="sr-only">
            Ítems de la compra {compra.numero}
          </caption>
          <TableHeader>
            <TableRow>
              <TableHead>Producto</TableHead>
              <TableHead className="text-right">Cant.</TableHead>
              <TableHead className="text-right">P. unit.</TableHead>
              <TableHead className="text-right">Subtotal</TableHead>
              <TableHead className="text-right">IVA</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {compra.items.map((it) => {
              const p = productosMap[it.productoId];
              return (
                <TableRow key={it.id}>
                  <TableCell>
                    {p ? (
                      <span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {p.codigo}
                        </span>{" "}
                        {p.nombre}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {it.cantidad}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {fmtMoney(it.precioUnitario)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {fmtMoney(it.subtotal)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {fmtMoney(it.iva)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {fmtMoney(it.total)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <Dialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!open && !isPending) setConfirmOpen(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Anular compra {compra.numero}</DialogTitle>
            <DialogDescription>
              Esta acción genera un asiento de reverso, marca la compra como
              CANCELADA y desvincula el asiento original. El número de compra
              se mantiene para auditoría.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleAnular}
              disabled={isPending}
            >
              {isPending ? "Procesando…" : "Anular"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span
          className={
            emphasis
              ? "font-mono text-xl font-semibold tabular-nums"
              : "font-mono text-base tabular-nums"
          }
        >
          {value}
        </span>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className={
        wide
          ? "col-span-1 flex flex-col gap-1 md:col-span-3"
          : "flex flex-col gap-1"
      }
    >
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div className="text-sm">{children}</div>
    </div>
  );
}
