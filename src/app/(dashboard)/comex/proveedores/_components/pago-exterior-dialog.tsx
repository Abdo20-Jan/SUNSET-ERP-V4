"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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

import { pagarFacturaExteriorAction } from "@/lib/actions/pago-exterior";
import type { CuentaBancariaOption } from "@/lib/actions/movimientos-tesoreria";

export type PagoExteriorFacturaInfo = {
  facturaOrigen: "compra" | "embarqueCosto";
  facturaId: string | number;
  facturaNumero: string;
  embarqueCodigo: string;
  proveedorNombre: string;
  saldoUsd: string;
  tcFactura: string;
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  factura: PagoExteriorFacturaInfo | null;
  cuentasBancariasArs: CuentaBancariaOption[];
  defaultFecha: string;
}

// Parser TC: acepta "1.147,50" (es-AR) o "1147.50" (canonical) y
// devuelve la forma canonical para enviar a la action.
function parseTcInput(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  // Si trae coma decimal, asumimos formato es-AR: quitar puntos de
  // miles y convertir coma → punto.
  const normalized = trimmed.includes(",") ? trimmed.replace(/\./g, "").replace(",", ".") : trimmed;
  return /^\d+(\.\d{1,6})?$/.test(normalized) ? normalized : "";
}

const formSchema = z.object({
  fecha: z.string().min(1, "Seleccione una fecha."),
  tipoCambioBancoRaw: z.string().min(1, "Ingrese el tipo de cambio del banco."),
  cuentaBancariaArsId: z.string().uuid("Seleccione una cuenta bancaria ARS."),
});

type FormValues = z.input<typeof formSchema>;

function fmtArs(n: number) {
  return n.toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function PagoExteriorDialog({
  open,
  onOpenChange,
  factura,
  cuentasBancariasArs,
  defaultFecha,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const { control, handleSubmit, reset, formState } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      fecha: defaultFecha,
      tipoCambioBancoRaw: "",
      cuentaBancariaArsId: "",
    },
  });

  // Reset al abrir con nueva factura (evita arrastrar valores entre pagos).
  useEffect(() => {
    if (open && factura) {
      reset({
        fecha: defaultFecha,
        tipoCambioBancoRaw: "",
        cuentaBancariaArsId: cuentasBancariasArs.length === 1 ? cuentasBancariasArs[0]!.id : "",
      });
    }
  }, [open, factura, defaultFecha, cuentasBancariasArs, reset]);

  const tcRaw = useWatch({ control, name: "tipoCambioBancoRaw" });

  const saldoUsdNum = factura ? Number(factura.saldoUsd) : 0;
  const tcFacturaNum = factura ? Number(factura.tcFactura) : 0;
  const tcBancoCanonical = parseTcInput(tcRaw ?? "");
  const tcBancoNum = tcBancoCanonical ? Number(tcBancoCanonical) : 0;

  const montoArsProveedor = saldoUsdNum * tcFacturaNum;
  const montoArsBanco = saldoUsdNum * tcBancoNum;
  const diff = montoArsProveedor - montoArsBanco;
  const tipoDiff: "ganancia" | "perdida" | "exacto" =
    tcBancoNum <= 0 || Math.abs(diff) < 0.005 ? "exacto" : diff > 0 ? "ganancia" : "perdida";

  function onSubmit(values: FormValues) {
    if (!factura) return;
    const tcCanonical = parseTcInput(values.tipoCambioBancoRaw);
    if (!tcCanonical) {
      toast.error("Tipo de cambio inválido. Use formato 1147,50 o 1147.50.");
      return;
    }

    startTransition(async () => {
      const res = await pagarFacturaExteriorAction({
        facturaOrigen: factura.facturaOrigen,
        facturaId: factura.facturaId,
        cuentaBancariaArsId: values.cuentaBancariaArsId,
        tipoCambioBanco: tcCanonical,
        fecha: values.fecha,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Pago registrado. Asiento #${res.asientoNumero}.`);
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pagar factura {factura?.facturaNumero ?? ""}</DialogTitle>
        </DialogHeader>

        {factura && (
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3 text-sm">
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md bg-muted/40 p-3">
              <span className="text-muted-foreground">Proveedor</span>
              <span className="font-medium">{factura.proveedorNombre}</span>
              <span className="text-muted-foreground">Embarque</span>
              <span className="font-mono">{factura.embarqueCodigo}</span>
              <span className="text-muted-foreground">Saldo USD</span>
              <span className="font-mono font-medium tabular-nums">{fmtArs(saldoUsdNum)}</span>
              <span className="text-muted-foreground">TC original</span>
              <span className="font-mono tabular-nums">{factura.tcFactura}</span>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="fecha">Fecha del pago</Label>
              <Controller
                control={control}
                name="fecha"
                render={({ field }) => <Input id="fecha" type="date" {...field} />}
              />
              {formState.errors.fecha && (
                <p className="text-xs text-destructive">{formState.errors.fecha.message}</p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tcBanco">Tipo de cambio del banco</Label>
              <Controller
                control={control}
                name="tipoCambioBancoRaw"
                render={({ field }) => (
                  <Input
                    id="tcBanco"
                    inputMode="decimal"
                    placeholder="1147,50"
                    autoComplete="off"
                    {...field}
                  />
                )}
              />
              {formState.errors.tipoCambioBancoRaw && (
                <p className="text-xs text-destructive">
                  {formState.errors.tipoCambioBancoRaw.message}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cuentaBanc">Cuenta bancaria ARS</Label>
              <Controller
                control={control}
                name="cuentaBancariaArsId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="cuentaBanc">
                      <SelectValue placeholder="Seleccione cuenta…" />
                    </SelectTrigger>
                    <SelectContent>
                      {cuentasBancariasArs.length === 0 && (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground">
                          No hay cuentas bancarias ARS configuradas.
                        </div>
                      )}
                      {cuentasBancariasArs.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.banco}
                          {c.numero ? ` · ${c.numero}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {formState.errors.cuentaBancariaArsId && (
                <p className="text-xs text-destructive">
                  {formState.errors.cuentaBancariaArsId.message}
                </p>
              )}
            </div>

            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md border p-3 text-xs">
              <span className="text-muted-foreground">Cancela pasivo (ARS)</span>
              <span className="text-right font-mono tabular-nums">{fmtArs(montoArsProveedor)}</span>
              <span className="text-muted-foreground">Sale del banco (ARS)</span>
              <span className="text-right font-mono tabular-nums">
                {tcBancoNum > 0 ? fmtArs(montoArsBanco) : "—"}
              </span>
              {tcBancoNum > 0 && tipoDiff !== "exacto" && (
                <>
                  <span className="text-muted-foreground">
                    {tipoDiff === "ganancia"
                      ? "Ganancia cambial (4.3.1.01)"
                      : "Pérdida cambial (5.8.2.01)"}
                  </span>
                  <span
                    className={`text-right font-mono tabular-nums ${
                      tipoDiff === "ganancia" ? "text-emerald-600" : "text-destructive"
                    }`}
                  >
                    {fmtArs(Math.abs(diff))}
                  </span>
                </>
              )}
            </div>

            <DialogFooter className="mt-1">
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={isPending}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Registrando…" : "Confirmar pago"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
