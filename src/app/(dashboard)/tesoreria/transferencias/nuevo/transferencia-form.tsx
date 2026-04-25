"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Alert02Icon,
  ArrowRight02Icon,
  Calendar03Icon,
} from "@hugeicons/core-free-icons";

import {
  crearTransferenciaAction,
  type CuentaBancariaOption,
} from "@/lib/actions/movimientos-tesoreria";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const DECIMAL_RE = /^\d+(\.\d{1,2})?$/;
const FX_RE = /^\d+(\.\d{1,6})?$/;

const formSchema = z
  .object({
    cuentaBancariaOrigenId: z
      .string()
      .uuid({ message: "Seleccione la cuenta origen" }),
    cuentaBancariaDestinoId: z
      .string()
      .uuid({ message: "Seleccione la cuenta destino" }),
    fecha: z.date({ message: "Seleccione la fecha" }),
    montoOrigen: z
      .string()
      .regex(DECIMAL_RE, "Monto origen inválido (máx. 2 decimales)"),
    montoDestino: z
      .string()
      .regex(DECIMAL_RE, "Monto destino inválido (máx. 2 decimales)"),
    tipoCambioOrigen: z
      .string()
      .regex(FX_RE, "Tipo de cambio origen inválido"),
    tipoCambioDestino: z
      .string()
      .regex(FX_RE, "Tipo de cambio destino inválido"),
    descripcion: z.string().trim().max(255).optional(),
  })
  .superRefine((data, ctx) => {
    if (
      data.cuentaBancariaOrigenId &&
      data.cuentaBancariaOrigenId === data.cuentaBancariaDestinoId
    ) {
      ctx.addIssue({
        path: ["cuentaBancariaDestinoId"],
        code: z.ZodIssueCode.custom,
        message: "La cuenta destino debe ser distinta de la origen",
      });
    }
    if (Number(data.montoOrigen) <= 0) {
      ctx.addIssue({
        path: ["montoOrigen"],
        code: z.ZodIssueCode.custom,
        message: "El monto debe ser mayor a 0",
      });
    }
    if (Number(data.montoDestino) <= 0) {
      ctx.addIssue({
        path: ["montoDestino"],
        code: z.ZodIssueCode.custom,
        message: "El monto debe ser mayor a 0",
      });
    }
    if (Number(data.tipoCambioOrigen) <= 0) {
      ctx.addIssue({
        path: ["tipoCambioOrigen"],
        code: z.ZodIssueCode.custom,
        message: "TC debe ser mayor a cero",
      });
    }
    if (Number(data.tipoCambioDestino) <= 0) {
      ctx.addIssue({
        path: ["tipoCambioDestino"],
        code: z.ZodIssueCode.custom,
        message: "TC debe ser mayor a cero",
      });
    }
  });

type FormValues = z.infer<typeof formSchema>;

export function TransferenciaForm({
  cuentasBancarias,
}: {
  cuentasBancarias: CuentaBancariaOption[];
}) {
  const router = useRouter();
  const [isSubmitting, startTransition] = useTransition();

  const {
    control,
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    mode: "onBlur",
    defaultValues: {
      cuentaBancariaOrigenId: "",
      cuentaBancariaDestinoId: "",
      fecha: new Date(),
      montoOrigen: "0",
      montoDestino: "0",
      tipoCambioOrigen: "1",
      tipoCambioDestino: "1",
      descripcion: "",
    },
  });

  const origenId = useWatch({ control, name: "cuentaBancariaOrigenId" });
  const destinoId = useWatch({ control, name: "cuentaBancariaDestinoId" });
  const montoOrigen = useWatch({ control, name: "montoOrigen" });
  const montoDestino = useWatch({ control, name: "montoDestino" });
  const tcOrigen = useWatch({ control, name: "tipoCambioOrigen" });
  const tcDestino = useWatch({ control, name: "tipoCambioDestino" });

  const origen = useMemo(
    () => cuentasBancarias.find((c) => c.id === origenId) ?? null,
    [cuentasBancarias, origenId],
  );
  const destino = useMemo(
    () => cuentasBancarias.find((c) => c.id === destinoId) ?? null,
    [cuentasBancarias, destinoId],
  );

  useEffect(() => {
    if (origen?.moneda === "ARS") {
      setValue("tipoCambioOrigen", "1", { shouldValidate: true });
    }
  }, [origen?.moneda, setValue]);

  useEffect(() => {
    if (destino?.moneda === "ARS") {
      setValue("tipoCambioDestino", "1", { shouldValidate: true });
    }
  }, [destino?.moneda, setValue]);

  const destinoOptions = useMemo(
    () => cuentasBancarias.filter((c) => c.id !== origenId),
    [cuentasBancarias, origenId],
  );

  const preview = useMemo(() => {
    const mo = Number(montoOrigen);
    const md = Number(montoDestino);
    const tco = Number(tcOrigen);
    const tcd = Number(tcDestino);
    if (!Number.isFinite(mo) || !Number.isFinite(md)) return null;
    if (!Number.isFinite(tco) || !Number.isFinite(tcd)) return null;
    if (mo <= 0 || md <= 0 || tco <= 0 || tcd <= 0) return null;
    const origenArs = round2(mo * tco);
    const destinoArs = round2(md * tcd);
    const diff = round2(destinoArs - origenArs);
    return { origenArs, destinoArs, diff };
  }, [montoOrigen, montoDestino, tcOrigen, tcDestino]);

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      const result = await crearTransferenciaAction({
        cuentaBancariaOrigenId: values.cuentaBancariaOrigenId,
        cuentaBancariaDestinoId: values.cuentaBancariaDestinoId,
        fecha: values.fecha,
        montoOrigen: values.montoOrigen,
        montoDestino: values.montoDestino,
        tipoCambioOrigen: values.tipoCambioOrigen,
        tipoCambioDestino: values.tipoCambioDestino,
        descripcion: values.descripcion,
      });

      if (result.ok) {
        toast.success(
          `Transferencia registrada — Asiento Nº ${result.asientoNumero}`,
        );
        router.push("/tesoreria/cuentas");
      } else {
        toast.error(result.error);
      }
    });
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <Card>
        <CardContent className="flex flex-col gap-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_auto_1fr]">
            <div className="flex flex-col gap-2">
              <Label>Cuenta origen</Label>
              <Controller
                control={control}
                name="cuentaBancariaOrigenId"
                render={({ field }) => (
                  <Select
                    value={field.value || undefined}
                    onValueChange={field.onChange}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Seleccione cuenta" />
                    </SelectTrigger>
                    <SelectContent>
                      {cuentasBancarias.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.banco} · {c.numero} · {c.moneda}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.cuentaBancariaOrigenId && (
                <FieldError
                  message={errors.cuentaBancariaOrigenId.message}
                />
              )}
              {origen && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-mono">
                    {origen.cuentaContableCodigo}
                  </span>{" "}
                  — {origen.cuentaContableNombre}
                </p>
              )}
            </div>

            <div className="flex items-center justify-center pt-6 text-muted-foreground">
              <HugeiconsIcon icon={ArrowRight02Icon} strokeWidth={2} />
            </div>

            <div className="flex flex-col gap-2">
              <Label>Cuenta destino</Label>
              <Controller
                control={control}
                name="cuentaBancariaDestinoId"
                render={({ field }) => (
                  <Select
                    value={field.value || undefined}
                    onValueChange={field.onChange}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Seleccione cuenta" />
                    </SelectTrigger>
                    <SelectContent>
                      {destinoOptions.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.banco} · {c.numero} · {c.moneda}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.cuentaBancariaDestinoId && (
                <FieldError
                  message={errors.cuentaBancariaDestinoId.message}
                />
              )}
              {destino && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-mono">
                    {destino.cuentaContableCodigo}
                  </span>{" "}
                  — {destino.cuentaContableNombre}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Fecha</Label>
            <Controller
              control={control}
              name="fecha"
              render={({ field }) => (
                <DatePicker value={field.value} onChange={field.onChange} />
              )}
            />
            {errors.fecha && <FieldError message={errors.fecha.message} />}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-3 rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Origen
                </Label>
                {origen && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                    {origen.moneda}
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="montoOrigen" className="text-xs">
                  Monto {origen?.moneda ? `(${origen.moneda})` : ""}
                </Label>
                <Input
                  id="montoOrigen"
                  inputMode="decimal"
                  className="text-right tabular-nums"
                  aria-invalid={!!errors.montoOrigen}
                  {...register("montoOrigen")}
                />
                {errors.montoOrigen && (
                  <FieldError message={errors.montoOrigen.message} />
                )}
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="tipoCambioOrigen" className="text-xs">
                  Tipo de cambio (→ ARS)
                </Label>
                <Input
                  id="tipoCambioOrigen"
                  inputMode="decimal"
                  className="tabular-nums"
                  disabled={origen?.moneda === "ARS"}
                  aria-invalid={!!errors.tipoCambioOrigen}
                  {...register("tipoCambioOrigen")}
                />
                {errors.tipoCambioOrigen && (
                  <FieldError message={errors.tipoCambioOrigen.message} />
                )}
                {origen?.moneda === "ARS" && (
                  <p className="text-xs text-muted-foreground">
                    Fijo en 1 para ARS.
                  </p>
                )}
              </div>
              {preview && (
                <p className="text-xs text-muted-foreground">
                  Equivalente ARS: {fmt(preview.origenArs)}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-3 rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Destino
                </Label>
                {destino && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                    {destino.moneda}
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="montoDestino" className="text-xs">
                  Monto {destino?.moneda ? `(${destino.moneda})` : ""}
                </Label>
                <Input
                  id="montoDestino"
                  inputMode="decimal"
                  className="text-right tabular-nums"
                  aria-invalid={!!errors.montoDestino}
                  {...register("montoDestino")}
                />
                {errors.montoDestino && (
                  <FieldError message={errors.montoDestino.message} />
                )}
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="tipoCambioDestino" className="text-xs">
                  Tipo de cambio (→ ARS)
                </Label>
                <Input
                  id="tipoCambioDestino"
                  inputMode="decimal"
                  className="tabular-nums"
                  disabled={destino?.moneda === "ARS"}
                  aria-invalid={!!errors.tipoCambioDestino}
                  {...register("tipoCambioDestino")}
                />
                {errors.tipoCambioDestino && (
                  <FieldError message={errors.tipoCambioDestino.message} />
                )}
                {destino?.moneda === "ARS" && (
                  <p className="text-xs text-muted-foreground">
                    Fijo en 1 para ARS.
                  </p>
                )}
              </div>
              {preview && (
                <p className="text-xs text-muted-foreground">
                  Equivalente ARS: {fmt(preview.destinoArs)}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="descripcion">Descripción (opcional)</Label>
            <Textarea
              id="descripcion"
              placeholder="Detalle de la transferencia"
              rows={2}
              {...register("descripcion")}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">Vista previa del asiento</h2>
            <span className="text-xs text-muted-foreground">
              Partida doble · se generará en estado CONTABILIZADO
            </span>
          </div>
          <AsientoPreview
            origen={origen}
            destino={destino}
            preview={preview}
          />
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={isSubmitting}
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Guardando…" : "Registrar transferencia"}
        </Button>
      </div>
    </form>
  );
}

function AsientoPreview({
  origen,
  destino,
  preview,
}: {
  origen: CuentaBancariaOption | null;
  destino: CuentaBancariaOption | null;
  preview: { origenArs: number; destinoArs: number; diff: number } | null;
}) {
  const rows: Array<{
    role: string;
    label: string;
    codigo: string;
    debe: string;
    haber: string;
  }> = [];

  if (destino && preview) {
    rows.push({
      role: "DEBE",
      label: destino.cuentaContableNombre,
      codigo: destino.cuentaContableCodigo,
      debe: fmt(preview.destinoArs),
      haber: "—",
    });
  } else {
    rows.push({
      role: "DEBE",
      label: destino?.cuentaContableNombre ?? "—",
      codigo: destino?.cuentaContableCodigo ?? "",
      debe: "—",
      haber: "—",
    });
  }

  if (origen && preview) {
    rows.push({
      role: "HABER",
      label: origen.cuentaContableNombre,
      codigo: origen.cuentaContableCodigo,
      debe: "—",
      haber: fmt(preview.origenArs),
    });
  } else {
    rows.push({
      role: "HABER",
      label: origen?.cuentaContableNombre ?? "—",
      codigo: origen?.cuentaContableCodigo ?? "",
      debe: "—",
      haber: "—",
    });
  }

  if (preview && preview.diff !== 0) {
    const absDiff = Math.abs(preview.diff);
    if (preview.diff > 0) {
      rows.push({
        role: "HABER",
        label: "DIFERENCIA DE CAMBIO POSITIVA",
        codigo: "4.3.1.01",
        debe: "—",
        haber: fmt(absDiff),
      });
    } else {
      rows.push({
        role: "DEBE",
        label: "DIFERENCIA DE CAMBIO NEGATIVA",
        codigo: "5.8.2.01",
        debe: fmt(absDiff),
        haber: "—",
      });
    }
  }

  const totalDebe = preview
    ? preview.diff < 0
      ? preview.destinoArs + Math.abs(preview.diff)
      : preview.destinoArs
    : 0;
  const totalHaber = preview
    ? preview.diff > 0
      ? preview.origenArs + preview.diff
      : preview.origenArs
    : 0;

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs text-muted-foreground">
          <tr>
            <th className="w-16 py-2 pl-3 text-left font-medium">Posición</th>
            <th className="py-2 pl-3 text-left font-medium">Cuenta</th>
            <th className="py-2 pr-3 text-right font-medium">Debe</th>
            <th className="py-2 pr-3 text-right font-medium">Haber</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t">
              <td className="py-2 pl-3 text-xs text-muted-foreground">
                {r.role}
              </td>
              <td className="py-2 pl-3">
                <span className="font-mono text-xs text-muted-foreground">
                  {r.codigo}
                </span>{" "}
                <span>{r.label}</span>
              </td>
              <td className="py-2 pr-3 text-right font-mono tabular-nums">
                {r.debe}
              </td>
              <td className="py-2 pr-3 text-right font-mono tabular-nums">
                {r.haber}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t bg-muted/30 text-xs">
          <tr>
            <td colSpan={2} className="py-2 pl-3 text-muted-foreground">
              Moneda: ARS (valorización del asiento)
            </td>
            <td className="py-2 pr-3 text-right font-mono tabular-nums">
              {preview ? fmt(totalDebe) : "—"}
            </td>
            <td className="py-2 pr-3 text-right font-mono tabular-nums">
              {preview ? fmt(totalHaber) : "—"}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="mt-1 flex items-center gap-1 text-xs text-destructive">
      <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} className="size-3" />
      {message}
    </p>
  );
}

function DatePicker({
  value,
  onChange,
}: {
  value: Date | undefined;
  onChange: (d: Date | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            className="w-full justify-start font-normal"
          />
        }
      >
        <HugeiconsIcon
          icon={Calendar03Icon}
          strokeWidth={2}
          className="size-4 text-muted-foreground"
        />
        {value ? format(value, "dd/MM/yyyy") : "Seleccione fecha"}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={value}
          onSelect={(d) => {
            onChange(d);
            setOpen(false);
          }}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function fmt(n: number): string {
  return n.toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
