"use client";

import { useEffect, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Controller,
  useFieldArray,
  useForm,
  useWatch,
  type Control,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import Decimal from "decimal.js";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  Alert02Icon,
  Delete02Icon,
  InformationCircleIcon,
} from "@hugeicons/core-free-icons";

import {
  contabilizarGastoAction,
  guardarGastoAction,
  type CuentaGastoOption,
  type GastoDetalle,
  type ProveedorParaGasto,
} from "@/lib/actions/gastos";
import { fmtMoney } from "@/lib/format";
import { useCmdShortcut } from "@/lib/hooks/use-cmd-shortcut";
import {
  ProveedorCombobox,
  type ProveedorOption,
} from "@/components/proveedor-combobox";
import { CuentaCombobox } from "@/components/cuenta-combobox";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const moneyRegex = /^\d+(\.\d{1,2})?$/;
const rateRegex = /^\d+(\.\d{1,6})?$/;

const CONDICION_VALUES = [
  "CONTADO",
  "TRANSFERENCIA",
  "CHEQUE",
  "TARJETA",
  "CUENTA_CORRIENTE",
  "OTRO",
] as const;

const CONDICION_LABELS: Record<(typeof CONDICION_VALUES)[number], string> = {
  CONTADO: "Contado",
  TRANSFERENCIA: "Transferencia",
  CHEQUE: "Cheque",
  TARJETA: "Tarjeta",
  CUENTA_CORRIENTE: "Cuenta corriente",
  OTRO: "Otro",
};

const formSchema = z
  .object({
    numero: z.string().min(1, "Número requerido").max(32),
    proveedorId: z.string().uuid("Seleccione proveedor"),
    fecha: z.string().min(1, "Fecha requerida"),
    fechaVencimiento: z.string().optional(),
    condicionPago: z.enum(CONDICION_VALUES),
    moneda: z.enum(["ARS", "USD"]),
    tipoCambio: z.string().regex(rateRegex, "TC inválido"),
    facturaNumero: z.string().max(64).optional(),
    iva: z.string().regex(moneyRegex, "IVA inválido"),
    iibb: z.string().regex(moneyRegex, "IIBB inválido"),
    otros: z.string().regex(moneyRegex, "Otros inválido"),
    notas: z.string().max(500).optional(),
    lineas: z
      .array(
        z.object({
          cuentaContableGastoId: z.coerce
            .number()
            .int()
            .positive("Seleccione cuenta de gasto"),
          descripcion: z.string().min(1, "Descripción requerida").max(200),
          subtotal: z.string().regex(moneyRegex, "Subtotal inválido"),
        }),
      )
      .min(1, "Agregue al menos una línea"),
  })
  .superRefine((data, ctx) => {
    if (data.moneda === "ARS" && data.tipoCambio !== "1") {
      ctx.addIssue({
        code: "custom",
        path: ["tipoCambio"],
        message: "Para ARS, TC debe ser 1",
      });
    }
    if (
      data.fechaVencimiento &&
      data.fechaVencimiento.trim() !== "" &&
      new Date(data.fechaVencimiento) < new Date(data.fecha)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["fechaVencimiento"],
        message: "Vencimiento no puede ser anterior a la fecha",
      });
    }
  });

type FormValues = z.input<typeof formSchema>;

type Props = {
  mode: "create" | "edit";
  numeroSugerido?: string;
  initialData?: GastoDetalle;
  proveedores: ProveedorParaGasto[];
  cuentas: CuentaGastoOption[];
};

function todayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function GastoForm({
  mode,
  numeroSugerido,
  initialData,
  proveedores,
  cuentas,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const isEdit = mode === "edit";

  const proveedorOptions: ProveedorOption[] = proveedores.map((p) => ({
    id: p.id,
    nombre: p.nombre,
    pais: "AR",
  }));

  const defaultValues: FormValues = isEdit
    ? {
        numero: initialData!.numero,
        proveedorId: initialData!.proveedorId,
        fecha: initialData!.fecha.slice(0, 10),
        fechaVencimiento: initialData!.fechaVencimiento
          ? initialData!.fechaVencimiento.slice(0, 10)
          : "",
        condicionPago: initialData!.condicionPago,
        moneda: initialData!.moneda,
        tipoCambio: initialData!.tipoCambio,
        facturaNumero: initialData!.facturaNumero ?? "",
        iva: initialData!.iva,
        iibb: initialData!.iibb,
        otros: initialData!.otros,
        notas: initialData!.notas ?? "",
        lineas: initialData!.lineas.map((l) => ({
          cuentaContableGastoId: l.cuentaContableGastoId,
          descripcion: l.descripcion,
          subtotal: l.subtotal,
        })),
      }
    : {
        numero: numeroSugerido ?? "",
        proveedorId: "",
        fecha: todayISO(),
        fechaVencimiento: "",
        condicionPago: "CUENTA_CORRIENTE",
        moneda: "ARS",
        tipoCambio: "1",
        facturaNumero: "",
        iva: "0",
        iibb: "0",
        otros: "0",
        notas: "",
        lineas: [
          {
            cuentaContableGastoId: 0 as unknown as number,
            descripcion: "",
            subtotal: "0",
          },
        ],
      };

  const {
    control,
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    mode: "onBlur",
    defaultValues,
  });

  const { fields, append, remove } = useFieldArray({ control, name: "lineas" });

  const moneda = useWatch({ control, name: "moneda" });
  const fecha = useWatch({ control, name: "fecha" });
  const lineas = useWatch({ control, name: "lineas" }) ?? [];
  const iva = useWatch({ control, name: "iva" }) ?? "0";
  const iibb = useWatch({ control, name: "iibb" }) ?? "0";
  const otros = useWatch({ control, name: "otros" }) ?? "0";

  useEffect(() => {
    if (moneda === "ARS") {
      setValue("tipoCambio", "1", { shouldValidate: true });
    }
  }, [moneda, setValue]);

  const onProveedorChange = (id: string) => {
    setValue("proveedorId", id, { shouldValidate: true });
    if (isEdit) return;
    const p = proveedores.find((x) => x.id === id);
    if (!p) return;
    setValue("condicionPago", p.condicionPagoDefault, { shouldValidate: true });
    if (p.diasPagoDefault != null && fecha) {
      setValue("fechaVencimiento", addDays(fecha, p.diasPagoDefault), {
        shouldValidate: true,
      });
    }
    if (p.cuentaGastoContableId != null) {
      const firstLine = (lineas[0]?.cuentaContableGastoId as unknown as number) ?? 0;
      if (!firstLine) {
        setValue("lineas.0.cuentaContableGastoId", p.cuentaGastoContableId, {
          shouldValidate: true,
        });
      }
    }
  };

  const totals = useMemo(() => {
    let subtotal = new Decimal(0);
    for (const l of lineas) {
      subtotal = subtotal.plus(new Decimal(safe(l?.subtotal)));
    }
    const ivaD = new Decimal(safe(iva));
    const iibbD = new Decimal(safe(iibb));
    const otrosD = new Decimal(safe(otros));
    const total = subtotal.plus(ivaD).plus(iibbD).plus(otrosD);
    return {
      subtotal: subtotal.toDecimalPlaces(2),
      iva: ivaD.toDecimalPlaces(2),
      iibb: iibbD.toDecimalPlaces(2),
      otros: otrosD.toDecimalPlaces(2),
      total: total.toDecimalPlaces(2),
    };
  }, [lineas, iva, iibb, otros]);

  const ivaWarning = useMemo(() => {
    const sub = totals.subtotal;
    if (sub.lte(0) || totals.iva.lte(0)) return null;
    const expected = sub.times(0.21).toDecimalPlaces(2);
    const diff = totals.iva.minus(expected).abs();
    if (diff.lte(1)) return null;
    return `IVA esperado ≈ ${fmtMoney(expected.toString())} (21% del subtotal); ingresado ${fmtMoney(totals.iva.toString())}`;
  }, [totals]);

  const addLinea = () => {
    append(
      {
        cuentaContableGastoId: 0 as unknown as number,
        descripcion: "",
        subtotal: "0",
      },
      { shouldFocus: false },
    );
  };

  function buildPayload(values: FormValues) {
    return {
      id: isEdit ? initialData!.id : undefined,
      numero: values.numero,
      proveedorId: values.proveedorId,
      fecha: values.fecha,
      fechaVencimiento:
        values.fechaVencimiento && values.fechaVencimiento.trim() !== ""
          ? values.fechaVencimiento
          : undefined,
      condicionPago: values.condicionPago,
      moneda: values.moneda,
      tipoCambio: values.tipoCambio,
      facturaNumero:
        values.facturaNumero && values.facturaNumero.trim() !== ""
          ? values.facturaNumero
          : undefined,
      iva: values.iva,
      iibb: values.iibb,
      otros: values.otros,
      notas: values.notas,
      lineas: values.lineas.map((l) => ({
        cuentaContableGastoId: Number(l.cuentaContableGastoId),
        descripcion: l.descripcion,
        subtotal: l.subtotal,
      })),
    };
  }

  const submitGuardar = handleSubmit((values) => {
    startTransition(async () => {
      const result = await guardarGastoAction(buildPayload(values));
      if (result.ok) {
        toast.success(`Gasto ${result.numero} guardado (BORRADOR).`);
        router.push(`/gastos/${result.id}`);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  });

  useCmdShortcut("s", () => submitGuardar(), !isPending);

  const submitContabilizar = handleSubmit((values) => {
    startTransition(async () => {
      const saved = await guardarGastoAction(buildPayload(values));
      if (!saved.ok) {
        toast.error(saved.error);
        return;
      }
      const cont = await contabilizarGastoAction(saved.id);
      if (cont.ok) {
        toast.success(
          `Gasto ${saved.numero} contabilizado (asiento Nº ${cont.numeroAsiento}).`,
        );
        router.push(`/gastos/${saved.id}`);
        router.refresh();
      } else {
        toast.error(cont.error);
      }
    });
  });

  return (
    <form onSubmit={submitGuardar} className="flex flex-col gap-6 pb-32">
      <div className="flex flex-col gap-1">
        <h1 className="text-[15px] font-semibold tracking-tight">
          {isEdit ? `Editar gasto ${initialData!.numero}` : "Nuevo gasto"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {isEdit
            ? "Modifique los datos antes de contabilizar."
            : "Factura ad-hoc de proveedor con N líneas + IVA/IIBB. Al contabilizar, genera asiento."}
        </p>
      </div>

      <Card>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Field label="Número" error={errors.numero?.message}>
            <Input {...register("numero")} placeholder="G-2026-0001" />
          </Field>

          <Field label="Proveedor" error={errors.proveedorId?.message}>
            <Controller
              control={control}
              name="proveedorId"
              render={({ field }) => (
                <ProveedorCombobox
                  value={field.value || null}
                  onChange={onProveedorChange}
                  proveedores={proveedorOptions}
                />
              )}
            />
          </Field>

          <Field label="Fecha" error={errors.fecha?.message}>
            <Input type="date" {...register("fecha")} />
          </Field>

          <Field
            label="Vencimiento"
            error={errors.fechaVencimiento?.message}
            hint="Auto-calculado según proveedor"
          >
            <Input type="date" {...register("fechaVencimiento")} />
          </Field>

          <Field
            label="Nº factura"
            error={errors.facturaNumero?.message}
            hint="Ej: A-0001-00012345"
          >
            <Input {...register("facturaNumero")} placeholder="A-0001-..." />
          </Field>

          <Field label="Condición de pago">
            <Controller
              control={control}
              name="condicionPago"
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={(v) =>
                    field.onChange(v as (typeof CONDICION_VALUES)[number])
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONDICION_VALUES.map((v) => (
                      <SelectItem key={v} value={v}>
                        {CONDICION_LABELS[v]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>

          <Field label="Moneda">
            <Controller
              control={control}
              name="moneda"
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={(v) => field.onChange(v as "ARS" | "USD")}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ARS">ARS</SelectItem>
                    <SelectItem value="USD">USD</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </Field>

          <Field
            label="Tipo de cambio"
            error={errors.tipoCambio?.message}
            hint={moneda === "ARS" ? "ARS: TC = 1" : undefined}
          >
            <Input
              {...register("tipoCambio")}
              disabled={moneda === "ARS"}
              inputMode="decimal"
            />
          </Field>

          <Field label="IVA" error={errors.iva?.message}>
            <Input {...register("iva")} inputMode="decimal" />
          </Field>

          <Field label="IIBB" error={errors.iibb?.message}>
            <Input {...register("iibb")} inputMode="decimal" />
          </Field>

          <Field label="Otros" error={errors.otros?.message}>
            <Input {...register("otros")} inputMode="decimal" />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-medium">Líneas de gasto</h2>
              <p className="text-xs text-muted-foreground">
                Cada línea va a una cuenta contable de gasto distinta.
                IVA/IIBB se cargan a nivel header.
              </p>
            </div>
            <Button type="button" variant="outline" onClick={addLinea}>
              <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
              Agregar línea
            </Button>
          </div>

          {errors.lineas?.message && (
            <p className="text-sm text-destructive">{errors.lineas.message}</p>
          )}

          <div className="flex flex-col gap-3">
            {fields.map((f, index) => (
              <LineaRow
                key={f.id}
                index={index}
                control={control}
                cuentas={cuentas}
                onRemove={() => remove(index)}
                canRemove={fields.length > 1}
                register={register}
                errorCuenta={
                  errors.lineas?.[index]?.cuentaContableGastoId?.message
                }
                errorDescripcion={
                  errors.lineas?.[index]?.descripcion?.message
                }
                errorSubtotal={errors.lineas?.[index]?.subtotal?.message}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-2">
          <Label htmlFor="notas" className="text-xs uppercase tracking-wide">
            Notas
          </Label>
          <Textarea
            id="notas"
            rows={3}
            placeholder="Observaciones internas (opcional)"
            {...register("notas")}
          />
        </CardContent>
      </Card>

      {ivaWarning && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <HugeiconsIcon
            icon={Alert02Icon}
            strokeWidth={2}
            className="mt-0.5 size-4 shrink-0"
          />
          <span>
            <strong>Verifique IVA:</strong> {ivaWarning}
          </span>
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center justify-between gap-4 px-4 py-3 lg:px-8">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
            <Total label="Subtotal" value={totals.subtotal.toString()} />
            <Total label="IVA" value={totals.iva.toString()} />
            <Total label="IIBB" value={totals.iibb.toString()} />
            <Total label="Otros" value={totals.otros.toString()} />
            <div className="flex items-baseline gap-1">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                Total
              </span>
              <span className="font-mono text-lg font-semibold tabular-nums">
                {fmtMoney(totals.total.toString())} {moneda}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => router.back()}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={submitGuardar}
              disabled={isPending}
            >
              {isPending ? "Guardando…" : "Guardar borrador"}
            </Button>
            <Button
              type="button"
              variant="default"
              onClick={submitContabilizar}
              disabled={isPending}
            >
              {isPending ? "Procesando…" : "Guardar y contabilizar"}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}

function safe(v: unknown): string {
  if (v === undefined || v === null || v === "") return "0";
  return String(v);
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs uppercase tracking-wide">{label}</Label>
      {children}
      {error ? (
        <p className="flex items-center gap-1 text-xs text-destructive">
          <HugeiconsIcon
            icon={Alert02Icon}
            strokeWidth={2}
            className="size-3"
          />
          {error}
        </p>
      ) : hint ? (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <HugeiconsIcon
            icon={InformationCircleIcon}
            strokeWidth={2}
            className="size-3"
          />
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="font-mono text-sm tabular-nums">{fmtMoney(value)}</span>
    </div>
  );
}

type LineaRowProps = {
  index: number;
  control: Control<FormValues>;
  cuentas: CuentaGastoOption[];
  onRemove: () => void;
  canRemove: boolean;
  register: ReturnType<typeof useForm<FormValues>>["register"];
  errorCuenta?: string;
  errorDescripcion?: string;
  errorSubtotal?: string;
};

function LineaRow({
  index,
  control,
  cuentas,
  onRemove,
  canRemove,
  register,
  errorCuenta,
  errorDescripcion,
  errorSubtotal,
}: LineaRowProps) {
  const subtotal = useWatch({ control, name: `lineas.${index}.subtotal` });

  return (
    <div className="grid grid-cols-1 items-end gap-3 rounded-lg border bg-muted/20 p-3 md:grid-cols-12">
      <div className="md:col-span-5">
        <Label className="text-xs uppercase tracking-wide">Cuenta gasto</Label>
        <Controller
          control={control}
          name={`lineas.${index}.cuentaContableGastoId` as const}
          render={({ field }) => (
            <CuentaCombobox
              value={
                field.value && Number(field.value) > 0
                  ? Number(field.value)
                  : null
              }
              onChange={(id) => field.onChange(id)}
              cuentas={cuentas}
            />
          )}
        />
        {errorCuenta && (
          <p className="mt-1 text-xs text-destructive">{errorCuenta}</p>
        )}
      </div>

      <div className="md:col-span-5">
        <Label className="text-xs uppercase tracking-wide">Descripción</Label>
        <Input
          {...register(`lineas.${index}.descripcion` as const)}
          placeholder="Ej: Servicio mantenimiento mensual"
        />
        {errorDescripcion && (
          <p className="mt-1 text-xs text-destructive">{errorDescripcion}</p>
        )}
      </div>

      <div className="md:col-span-1">
        <Label className="text-xs uppercase tracking-wide">Subtotal</Label>
        <Input
          inputMode="decimal"
          {...register(`lineas.${index}.subtotal` as const)}
        />
        {errorSubtotal && (
          <p className="mt-1 text-xs text-destructive">{errorSubtotal}</p>
        )}
        <p className="mt-1 truncate font-mono text-xs text-muted-foreground tabular-nums">
          {fmtMoney(safe(subtotal))}
        </p>
      </div>

      <div className="flex justify-end md:col-span-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onRemove}
          disabled={!canRemove}
          aria-label="Eliminar línea"
        >
          <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
        </Button>
      </div>
    </div>
  );
}
