"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { CancelCircleIcon } from "@hugeicons/core-free-icons";

import { anularGastoAction, type GastoDetalle } from "@/lib/actions/gastos";
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
  gasto: GastoDetalle;
  proveedorNombre: string;
  cuentasMap: Record<number, { codigo: string; nombre: string }>;
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
  estado: GastoDetalle["estado"],
): "default" | "outline" | "secondary" | "destructive" {
  switch (estado) {
    case "BORRADOR":
      return "outline";
    case "CONTABILIZADO":
      return "default";
    case "ANULADO":
      return "destructive";
  }
}

export function GastoDetailView({
  gasto,
  proveedorNombre,
  cuentasMap,
  asientoNumero,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const puedeAnular =
    gasto.estado === "CONTABILIZADO" && gasto.asientoId !== null;

  const handleAnular = () => {
    startTransition(async () => {
      const result = await anularGastoAction(gasto.id);
      if (result.ok) {
        toast.success("Gasto anulado.");
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
              Gasto {gasto.numero}
            </h1>
            <Badge variant={estadoVariant(gasto.estado)}>{gasto.estado}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {proveedorNombre} · {fmtDate(new Date(gasto.fecha))} ·{" "}
            {CONDICION_LABELS[gasto.condicionPago] ?? gasto.condicionPago}
            {gasto.facturaNumero && (
              <span className="ml-2 font-mono text-xs">
                Fact. {gasto.facturaNumero}
              </span>
            )}
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
        <Stat
          label="Subtotal"
          value={`${fmtMoney(gasto.subtotal)} ${gasto.moneda}`}
        />
        <Stat label="IVA" value={`${fmtMoney(gasto.iva)} ${gasto.moneda}`} />
        <Stat
          label="IIBB + Otros"
          value={`${fmtMoney(
            (Number(gasto.iibb) + Number(gasto.otros)).toFixed(2),
          )} ${gasto.moneda}`}
        />
        <Stat
          label="Total"
          value={`${fmtMoney(gasto.total)} ${gasto.moneda}`}
          emphasis
        />
      </div>

      <Card>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Fecha">{fmtDate(new Date(gasto.fecha))}</Field>
          <Field label="Vencimiento">
            <DateBadge fecha={gasto.fechaVencimiento} relative />
          </Field>
          <Field label="Tipo de cambio">
            {gasto.moneda === "ARS"
              ? "—"
              : `1 USD = ${fmtTipoCambio(gasto.tipoCambio)} ARS`}
          </Field>
          <Field label="Asiento contable">
            {asientoNumero != null ? (
              <span className="font-mono">Nº {asientoNumero}</span>
            ) : (
              <span className="text-muted-foreground">Sin asiento</span>
            )}
          </Field>
          {gasto.notas && (
            <Field label="Notas" wide>
              {gasto.notas}
            </Field>
          )}
        </CardContent>
      </Card>

      <Card className="py-0">
        <Table>
          <caption className="sr-only">
            Líneas del gasto {gasto.numero}
          </caption>
          <TableHeader>
            <TableRow>
              <TableHead>Cuenta</TableHead>
              <TableHead>Descripción</TableHead>
              <TableHead className="text-right">Subtotal</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {gasto.lineas.map((l) => {
              const c = cuentasMap[l.cuentaContableGastoId];
              return (
                <TableRow key={l.id}>
                  <TableCell>
                    {c ? (
                      <span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {c.codigo}
                        </span>{" "}
                        {c.nombre}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{l.descripcion}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {fmtMoney(l.subtotal)}
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
            <DialogTitle>Anular gasto {gasto.numero}</DialogTitle>
            <DialogDescription>
              Esta acción anula el asiento contable, marca el gasto como
              ANULADO y desvincula el asiento original. El número de gasto se
              mantiene para auditoría.
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
