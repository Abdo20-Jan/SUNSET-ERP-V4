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
  // "embarqueFob" = factura virtual derivada del Embarque + ItemEmbarque
  // (sin Compra ni EmbarqueCosto; aplica al flujo Modelo Y bonded).
  facturaOrigen: "compra" | "embarqueCosto" | "embarqueFob";
  facturaId: string | number;
  facturaNumero: string;
  embarqueCodigo: string;
  proveedorNombre: string;
  saldoUsd: string;
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  factura: PagoExteriorFacturaInfo | null;
  cuentasBancariasArs: CuentaBancariaOption[];
  defaultFecha: string;
}

// Parser de números con coma decimal es-AR ("1.147,50" → "1147.50").
function parseNumberInput(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  const normalized = trimmed.includes(",") ? trimmed.replace(/\./g, "").replace(",", ".") : trimmed;
  return /^\d+(\.\d+)?$/.test(normalized) ? normalized : "";
}

const formSchema = z
  .object({
    fecha: z.string().min(1, "Seleccione una fecha."),
    cuentaBancariaArsId: z.string().uuid("Seleccione una cuenta bancaria ARS."),
    comprobante: z.string().max(100).optional(),
    referenciaBanco: z.string().max(100).optional(),
    montoUsdAPagar: z.string().min(1, "Ingrese el monto USD a pagar."),
    // El usuario llena UNO de los dos — sincronizamos visualmente y validamos
    // que al menos uno tenga valor numérico válido.
    tipoCambioBancoRaw: z.string().optional(),
    montoArsRaw: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    const tc = parseNumberInput(data.tipoCambioBancoRaw ?? "");
    const ars = parseNumberInput(data.montoArsRaw ?? "");
    if (tc === "" && ars === "") {
      ctx.addIssue({
        path: ["tipoCambioBancoRaw"],
        code: "custom",
        message: "Ingrese el tipo de cambio del banco O el monto ARS.",
      });
    }
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

  const { control, handleSubmit, reset, setValue, formState } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      fecha: defaultFecha,
      cuentaBancariaArsId: "",
      comprobante: "",
      referenciaBanco: "",
      montoUsdAPagar: "",
      tipoCambioBancoRaw: "",
      montoArsRaw: "",
    },
  });

  // Al abrir con nueva factura: pre-fill montoUsd = saldo, seleccionar
  // cuenta bancaria si hay sólo una.
  useEffect(() => {
    if (open && factura) {
      reset({
        fecha: defaultFecha,
        cuentaBancariaArsId: cuentasBancariasArs.length === 1 ? cuentasBancariasArs[0]!.id : "",
        comprobante: "",
        referenciaBanco: "",
        montoUsdAPagar: factura.saldoUsd,
        tipoCambioBancoRaw: "",
        montoArsRaw: "",
      });
    }
  }, [open, factura, defaultFecha, cuentasBancariasArs, reset]);

  const tcRaw = useWatch({ control, name: "tipoCambioBancoRaw" });
  const arsRaw = useWatch({ control, name: "montoArsRaw" });
  const montoUsdRaw = useWatch({ control, name: "montoUsdAPagar" });

  const montoUsdNum = Number(parseNumberInput(montoUsdRaw ?? "")) || 0;
  const tcParsed = parseNumberInput(tcRaw ?? "");
  const arsParsed = parseNumberInput(arsRaw ?? "");

  // Sync TC → ARS y ARS → TC. Usa setValue con shouldDirty=false para no
  // disparar el watch en loop (sólo actualiza si el otro campo está vacío
  // o si el cálculo difiere del valor mostrado).
  useEffect(() => {
    if (montoUsdNum <= 0) return;
    if (tcParsed !== "" && arsParsed === "") {
      const ars = (Number(tcParsed) * montoUsdNum).toFixed(2);
      setValue("montoArsRaw", ars, { shouldDirty: false });
    } else if (arsParsed !== "" && tcParsed === "") {
      const tc = (Number(arsParsed) / montoUsdNum).toFixed(6);
      setValue("tipoCambioBancoRaw", tc, { shouldDirty: false });
    }
  }, [tcParsed, arsParsed, montoUsdNum, setValue]);

  function onSubmit(values: FormValues) {
    if (!factura) return;
    const tcCanonical = parseNumberInput(values.tipoCambioBancoRaw ?? "");
    const arsCanonical = parseNumberInput(values.montoArsRaw ?? "");
    if (tcCanonical === "" && arsCanonical === "") {
      toast.error("Ingrese tipo de cambio o monto ARS.");
      return;
    }

    // Enviamos sólo UNO de los dos (el que el usuario llenó primero
    // tiene prioridad — si llenó ambos pasamos sólo TC por convención).
    const sendTc = tcCanonical !== "";
    const usdCanonical = parseNumberInput(values.montoUsdAPagar);
    if (usdCanonical === "" || Number(usdCanonical) <= 0) {
      toast.error("Ingrese un monto USD válido.");
      return;
    }

    startTransition(async () => {
      const res = await pagarFacturaExteriorAction({
        facturaOrigen: factura.facturaOrigen,
        facturaId: factura.facturaId,
        cuentaBancariaArsId: values.cuentaBancariaArsId,
        fecha: values.fecha,
        montoUsdAPagar: usdCanonical,
        ...(sendTc ? { tipoCambioBanco: tcCanonical } : { montoArs: arsCanonical }),
        comprobante:
          values.comprobante && values.comprobante.trim() !== ""
            ? values.comprobante.trim()
            : undefined,
        referenciaBanco:
          values.referenciaBanco && values.referenciaBanco.trim() !== ""
            ? values.referenciaBanco.trim()
            : undefined,
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
              <span className="font-mono font-medium tabular-nums">
                {fmtArs(Number(factura.saldoUsd))}
              </span>
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
              <Label htmlFor="cuentaBanc">Cuenta bancaria (banco)</Label>
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

            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="comprobante">Comprobante</Label>
                <Controller
                  control={control}
                  name="comprobante"
                  render={({ field }) => (
                    <Input id="comprobante" placeholder="OP-12345" {...field} />
                  )}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="referencia">Ref. banco</Label>
                <Controller
                  control={control}
                  name="referenciaBanco"
                  render={({ field }) => <Input id="referencia" placeholder="TRF-ABC" {...field} />}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="usd">Pagar USD</Label>
              <Controller
                control={control}
                name="montoUsdAPagar"
                render={({ field }) => (
                  <Input id="usd" inputMode="decimal" placeholder={factura.saldoUsd} {...field} />
                )}
              />
              {formState.errors.montoUsdAPagar && (
                <p className="text-xs text-destructive">
                  {formState.errors.montoUsdAPagar.message}
                </p>
              )}
            </div>

            <div className="rounded-md border p-3">
              <p className="mb-2 text-xs text-muted-foreground">
                Llene <strong>uno</strong> de los dos — el otro se calcula automáticamente:
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="tcBanco">TC del banco</Label>
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
                        onChange={(e) => {
                          field.onChange(e);
                          // Al editar TC, limpiar ARS para que el sync calcule.
                          setValue("montoArsRaw", "", { shouldDirty: false });
                        }}
                      />
                    )}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="arsBanco">ARS a debitar del banco</Label>
                  <Controller
                    control={control}
                    name="montoArsRaw"
                    render={({ field }) => (
                      <Input
                        id="arsBanco"
                        inputMode="decimal"
                        placeholder="25245000,00"
                        autoComplete="off"
                        {...field}
                        onChange={(e) => {
                          field.onChange(e);
                          setValue("tipoCambioBancoRaw", "", { shouldDirty: false });
                        }}
                      />
                    )}
                  />
                </div>
              </div>
              {formState.errors.tipoCambioBancoRaw && (
                <p className="mt-1 text-xs text-destructive">
                  {formState.errors.tipoCambioBancoRaw.message}
                </p>
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
