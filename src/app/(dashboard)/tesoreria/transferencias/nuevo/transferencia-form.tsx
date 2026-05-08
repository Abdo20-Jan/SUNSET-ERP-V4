"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Controller,
  useForm,
  useWatch,
  type Control,
  type FieldErrors,
  type UseFormRegister,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Alert02Icon, ArrowRight02Icon, Calendar03Icon } from "@hugeicons/core-free-icons";

import {
  crearTransferenciaAction,
  type CuentaBancariaOption,
} from "@/lib/actions/movimientos-tesoreria";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { parseDefaultFecha } from "@/lib/utils/parse-default-fecha";

const DECIMAL_RE = /^\d+(\.\d{1,2})?$/;
const FX_RE = /^\d+(\.\d{1,6})?$/;

const formSchema = z
  .object({
    cuentaBancariaOrigenId: z.string().uuid({ message: "Seleccione la cuenta origen" }),
    cuentaBancariaDestinoId: z.string().uuid({ message: "Seleccione la cuenta destino" }),
    fecha: z.date({ message: "Seleccione la fecha de pago" }),
    fechaDestino: z.date({ message: "Seleccione la fecha de recepción" }),
    referenciaBancoOrigen: z.string().trim().max(120).optional(),
    referenciaBancoDestino: z.string().trim().max(120).optional(),
    montoOrigen: z.string().regex(DECIMAL_RE, "Monto origen inválido (máx. 2 decimales)"),
    montoDestino: z.string().regex(DECIMAL_RE, "Monto destino inválido (máx. 2 decimales)"),
    tipoCambioOrigen: z.string().regex(FX_RE, "Tipo de cambio origen inválido"),
    tipoCambioDestino: z.string().regex(FX_RE, "Tipo de cambio destino inválido"),
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
  defaultFecha,
}: {
  cuentasBancarias: CuentaBancariaOption[];
  defaultFecha?: string;
}) {
  const router = useRouter();
  const [isSubmitting, startTransition] = useTransition();

  const initialFecha = parseDefaultFecha(defaultFecha) as Date;

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
      fecha: initialFecha,
      fechaDestino: initialFecha,
      referenciaBancoOrigen: "",
      referenciaBancoDestino: "",
      montoOrigen: "0",
      montoDestino: "0",
      tipoCambioOrigen: "1",
      tipoCambioDestino: "1",
      descripcion: "",
    },
  });

  const origenId = useWatch({ control, name: "cuentaBancariaOrigenId" });
  const destinoId = useWatch({ control, name: "cuentaBancariaDestinoId" });
  const fechaPago = useWatch({ control, name: "fecha" });
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
      setValue("tipoCambioOrigen", "1");
    }
  }, [origen?.moneda, setValue]);

  useEffect(() => {
    if (destino?.moneda === "ARS") {
      setValue("tipoCambioDestino", "1");
    }
  }, [destino?.moneda, setValue]);

  const sameCurrency = !!origen && !!destino && origen.moneda === destino.moneda;

  const userTouchedDestinoMonto = useRef(false);
  useEffect(() => {
    if (sameCurrency && !userTouchedDestinoMonto.current) {
      setValue("montoDestino", montoOrigen);
    }
  }, [sameCurrency, montoOrigen, setValue]);

  const userTouchedFechaDestino = useRef(false);
  // RHF clona Date a cada read (useWatch), gerando ref nova por render. Usar
  // primitive `.getTime()` como dep evita loop infinito de re-render.
  const fechaPagoTime = fechaPago instanceof Date ? fechaPago.getTime() : null;
  useEffect(() => {
    if (!userTouchedFechaDestino.current && fechaPagoTime !== null) {
      setValue("fechaDestino", new Date(fechaPagoTime));
    }
  }, [fechaPagoTime, setValue]);

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
        fechaDestino: values.fechaDestino,
        montoOrigen: values.montoOrigen,
        montoDestino: values.montoDestino,
        tipoCambioOrigen: values.tipoCambioOrigen,
        tipoCambioDestino: values.tipoCambioDestino,
        referenciaBancoOrigen: values.referenciaBancoOrigen,
        referenciaBancoDestino: values.referenciaBancoDestino,
        descripcion: values.descripcion,
      });

      if (result.ok) {
        toast.success(`Transferencia registrada — Asiento Nº ${result.asientoNumero}`);
        router.push("/tesoreria/movimientos");
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
            <CuentaSideCard
              lado="origen"
              cuenta={origen}
              cuentaOptions={cuentasBancarias}
              previewArs={preview?.origenArs}
              control={control}
              register={register}
              errors={errors}
              onMontoChange={() => {
                /* origen change does not reset destino-touched flag */
              }}
              onFechaChange={() => {
                /* origen fecha change does not reset destino-touched flag */
              }}
            />

            <div className="flex items-center justify-center pt-12 text-muted-foreground">
              <HugeiconsIcon icon={ArrowRight02Icon} strokeWidth={2} />
            </div>

            <CuentaSideCard
              lado="destino"
              cuenta={destino}
              cuentaOptions={destinoOptions}
              previewArs={preview?.destinoArs}
              control={control}
              register={register}
              errors={errors}
              onMontoChange={() => {
                userTouchedDestinoMonto.current = true;
              }}
              onFechaChange={() => {
                userTouchedFechaDestino.current = true;
              }}
              autoFillHint={
                sameCurrency
                  ? "Auto-completa con el monto de origen (misma moneda). Edite manualmente para registrar comisiones."
                  : null
              }
            />
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
          <AsientoPreview origen={origen} destino={destino} preview={preview} />
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

type CuentaSideRole = "origen" | "destino";

type CuentaSideCardProps = {
  lado: CuentaSideRole;
  cuenta: CuentaBancariaOption | null;
  cuentaOptions: CuentaBancariaOption[];
  previewArs?: number;
  control: Control<FormValues>;
  register: UseFormRegister<FormValues>;
  errors: FieldErrors<FormValues>;
  onMontoChange: () => void;
  onFechaChange: () => void;
  autoFillHint?: string | null;
};

const FIELD_NAMES_ORIGEN = {
  cuenta: "cuentaBancariaOrigenId",
  fecha: "fecha",
  ref: "referenciaBancoOrigen",
  monto: "montoOrigen",
  tc: "tipoCambioOrigen",
} as const;

const FIELD_NAMES_DESTINO = {
  cuenta: "cuentaBancariaDestinoId",
  fecha: "fechaDestino",
  ref: "referenciaBancoDestino",
  monto: "montoDestino",
  tc: "tipoCambioDestino",
} as const;

function CuentaSideCard(props: CuentaSideCardProps) {
  const {
    lado,
    cuenta,
    cuentaOptions,
    previewArs,
    control,
    register,
    errors,
    onMontoChange,
    onFechaChange,
    autoFillHint,
  } = props;

  const fields = lado === "origen" ? FIELD_NAMES_ORIGEN : FIELD_NAMES_DESTINO;
  const titulo = lado === "origen" ? "Origen" : "Destino";
  const cuentaLabel = lado === "origen" ? "Cuenta origen" : "Cuenta destino";
  const fechaLabel = lado === "origen" ? "Fecha de pago" : "Fecha de recepción";
  const refLabel =
    lado === "origen" ? "Referencia bancaria (origen)" : "Referencia bancaria (destino)";
  const refPlaceholder =
    lado === "origen"
      ? "Ej. ORD-2026-04823 / nº comprobante de pago"
      : "Ej. CRE-2026-77291 / nº comprobante de acreditación";
  const placeholderCuenta =
    lado === "origen" ? "Seleccione cuenta origen" : "Seleccione cuenta destino";

  const cuentaError = errors[fields.cuenta]?.message;
  const fechaError = errors[fields.fecha]?.message;
  const referenciaError = errors[fields.ref]?.message;
  const montoError = errors[fields.monto]?.message;
  const tcError = errors[fields.tc]?.message;
  const tcDisabled = cuenta?.moneda === "ARS";

  const montoRegister = register(fields.monto);
  const refRegister = register(fields.ref);

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">{titulo}</Label>
        {cuenta && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
            {cuenta.moneda}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label className="text-xs">{cuentaLabel}</Label>
        <Controller
          control={control}
          name={fields.cuenta}
          render={({ field }) => (
            <Select value={(field.value as string) || undefined} onValueChange={field.onChange}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={placeholderCuenta}>
                  {(value) => {
                    const c = cuentaOptions.find((c) => c.id === value);
                    return c ? `${c.banco} · ${c.numero} · ${c.moneda}` : placeholderCuenta;
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {cuentaOptions.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.banco} · {c.numero} · {c.moneda}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        {cuentaError && <FieldError message={cuentaError} />}
        {cuenta && (
          <p className="text-xs text-muted-foreground">
            <span className="font-mono">{cuenta.cuentaContableCodigo}</span> —{" "}
            {cuenta.cuentaContableNombre}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label className="text-xs">{fechaLabel}</Label>
        <Controller
          control={control}
          name={fields.fecha}
          render={({ field }) => (
            <DatePicker
              value={field.value as Date | undefined}
              onChange={(d) => {
                onFechaChange();
                field.onChange(d);
              }}
            />
          )}
        />
        {fechaError && <FieldError message={fechaError} />}
      </div>

      <div className="flex flex-col gap-2">
        <Label className="text-xs" htmlFor={fields.ref}>
          {refLabel}
        </Label>
        <Input
          id={fields.ref}
          placeholder={refPlaceholder}
          aria-invalid={!!referenciaError}
          {...refRegister}
        />
        {referenciaError && <FieldError message={referenciaError} />}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={fields.monto} className="text-xs">
          Monto {cuenta?.moneda ? `(${cuenta.moneda})` : ""}
        </Label>
        <Input
          id={fields.monto}
          inputMode="decimal"
          className="text-right tabular-nums"
          aria-invalid={!!montoError}
          {...montoRegister}
          onChange={(e) => {
            onMontoChange();
            montoRegister.onChange(e);
          }}
        />
        {montoError && <FieldError message={montoError} />}
        {autoFillHint && <p className="text-xs text-muted-foreground">{autoFillHint}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={fields.tc} className="text-xs">
          Tipo de cambio (→ ARS)
        </Label>
        <Input
          id={fields.tc}
          inputMode="decimal"
          className="tabular-nums"
          disabled={tcDisabled}
          aria-invalid={!!tcError}
          {...register(fields.tc)}
        />
        {tcError && <FieldError message={tcError} />}
        {tcDisabled && <p className="text-xs text-muted-foreground">Fijo en 1 para ARS.</p>}
      </div>

      {previewArs !== undefined && (
        <p className="text-xs text-muted-foreground">Equivalente ARS: {fmt(previewArs)}</p>
      )}
    </div>
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
              <td className="py-2 pl-3 text-xs text-muted-foreground">{r.role}</td>
              <td className="py-2 pl-3">
                <span className="font-mono text-xs text-muted-foreground">{r.codigo}</span>{" "}
                <span>{r.label}</span>
              </td>
              <td className="py-2 pr-3 text-right font-mono tabular-nums">{r.debe}</td>
              <td className="py-2 pr-3 text-right font-mono tabular-nums">{r.haber}</td>
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
          <Button type="button" variant="outline" className="w-full justify-start font-normal" />
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
