"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
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
import Decimal from "decimal.js";
import { format } from "date-fns";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  Alert02Icon,
  Calendar03Icon,
  CheckmarkCircle02Icon,
  Delete02Icon,
  UnfoldMoreIcon,
} from "@hugeicons/core-free-icons";

import { crearAsientoManualAction } from "@/lib/actions/asientos";
import { cn } from "@/lib/utils";

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

function parseMoney(value: string): Decimal {
  if (!value || Number.isNaN(parseFloat(value))) return new Decimal(0);
  try {
    return new Decimal(value);
  } catch {
    return new Decimal(0);
  }
}

function sumColumn(values: string[]): Decimal {
  return values
    .reduce<Decimal>((acc, v) => acc.plus(parseMoney(v)), new Decimal(0))
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent } from "@/components/ui/card";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
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
import { Separator } from "@/components/ui/separator";

type Cuenta = { id: number; codigo: string; nombre: string };

const DECIMAL_RE = /^\d+(\.\d{1,2})?$/;
const FX_RE = /^\d+(\.\d{1,6})?$/;

const lineaSchema = z
  .object({
    cuentaId: z
      .number()
      .int()
      .positive({ message: "Seleccione una cuenta" }),
    debe: z.string().regex(DECIMAL_RE, "Valor inválido"),
    haber: z.string().regex(DECIMAL_RE, "Valor inválido"),
    referencia: z.string().optional(),
  })
  .refine(
    (l) => {
      const debe = parseFloat(l.debe) || 0;
      const haber = parseFloat(l.haber) || 0;
      return (debe > 0) !== (haber > 0);
    },
    { message: "Complete Debe o Haber (no ambos)", path: ["debe"] },
  );

const formSchema = z
  .object({
    fecha: z.date(),
    moneda: z.enum(["ARS", "USD"]),
    tipoCambio: z.string().regex(FX_RE, "Tipo de cambio inválido"),
    descripcion: z.string().min(1, "Descripción obligatoria"),
    lineas: z.array(lineaSchema).min(2, "Mínimo 2 líneas"),
  })
  .superRefine((data, ctx) => {
    const tc = parseFloat(data.tipoCambio);
    if (data.moneda === "ARS" && tc !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tipoCambio"],
        message: "TC debe ser 1 cuando moneda=ARS",
      });
    }
    if (data.moneda === "USD" && (!Number.isFinite(tc) || tc <= 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tipoCambio"],
        message: "TC debe ser mayor a cero",
      });
    }
    const debeSum = data.lineas.reduce(
      (s, l) => s + (parseFloat(l.debe) || 0),
      0,
    );
    const haberSum = data.lineas.reduce(
      (s, l) => s + (parseFloat(l.haber) || 0),
      0,
    );
    if (Math.abs(debeSum - haberSum) > 0.009) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lineas"],
        message: "La suma del Debe debe igualar la del Haber",
      });
    }
  });

type FormValues = z.infer<typeof formSchema>;

const EMPTY_LINEA = {
  cuentaId: 0,
  debe: "0",
  haber: "0",
  referencia: "",
} as const;

export function AsientoForm({ cuentas }: { cuentas: Cuenta[] }) {
  const router = useRouter();
  const [isSubmitting, startTransition] = useTransition();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    mode: "onBlur",
    defaultValues: {
      fecha: new Date(),
      moneda: "ARS",
      tipoCambio: "1",
      descripcion: "",
      lineas: [{ ...EMPTY_LINEA }, { ...EMPTY_LINEA }],
    },
  });

  const {
    control,
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = form;

  const { fields, append, remove } = useFieldArray({
    control,
    name: "lineas",
  });

  const moneda = useWatch({ control, name: "moneda" });

  useEffect(() => {
    if (moneda === "ARS") {
      setValue("tipoCambio", "1", { shouldValidate: true });
    }
  }, [moneda, setValue]);

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      const result = await crearAsientoManualAction({
        fecha: values.fecha,
        descripcion: values.descripcion,
        moneda: values.moneda,
        tipoCambio: values.tipoCambio,
        lineas: values.lineas.map((l) => ({
          cuentaId: l.cuentaId,
          debe: l.debe,
          haber: l.haber,
          referencia: l.referencia,
        })),
      });

      if (result.ok) {
        toast.success(`Asiento Nº ${result.numero} creado (BORRADOR).`);
        router.push("/contabilidad/asientos");
      } else {
        toast.error(result.error);
      }
    });
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="fecha">Fecha</Label>
              <Controller
                control={control}
                name="fecha"
                render={({ field }) => (
                  <DatePicker value={field.value} onChange={field.onChange} />
                )}
              />
              {errors.fecha && (
                <FieldError message={errors.fecha.message} />
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="moneda">Moneda</Label>
              <Controller
                control={control}
                name="moneda"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={(v) => field.onChange(v)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ARS">ARS — Peso argentino</SelectItem>
                      <SelectItem value="USD">USD — Dólar</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="tipoCambio">Tipo de cambio</Label>
              <Input
                id="tipoCambio"
                inputMode="decimal"
                disabled={moneda === "ARS"}
                aria-invalid={!!errors.tipoCambio}
                {...register("tipoCambio")}
              />
              {errors.tipoCambio && (
                <FieldError message={errors.tipoCambio.message} />
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="descripcion">Descripción</Label>
            <Input
              id="descripcion"
              placeholder="Motivo del asiento"
              aria-invalid={!!errors.descripcion}
              {...register("descripcion")}
            />
            {errors.descripcion && (
              <FieldError message={errors.descripcion.message} />
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="py-0">
        <div className="flex items-center justify-between px-6 pt-6">
          <h2 className="text-base font-medium">Líneas</h2>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => append({ ...EMPTY_LINEA })}
          >
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
            Agregar línea
          </Button>
        </div>
        <div className="overflow-x-auto px-6 pb-6">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-3 font-medium">#</th>
                <th className="py-2 pr-3 font-medium">Cuenta</th>
                <th className="py-2 pr-3 text-right font-medium">Debe</th>
                <th className="py-2 pr-3 text-right font-medium">Haber</th>
                <th className="py-2 pr-3 font-medium">Referencia</th>
                <th className="w-10 py-2" />
              </tr>
            </thead>
            <tbody>
              {fields.map((field, index) => (
                <tr key={field.id} className="border-b align-top last:border-0">
                  <td className="py-2 pr-3 pt-3 text-muted-foreground tabular-nums">
                    {index + 1}
                  </td>
                  <td className="py-2 pr-3 pt-2 min-w-70">
                    <Controller
                      control={control}
                      name={`lineas.${index}.cuentaId`}
                      render={({ field: f }) => (
                        <CuentaCombobox
                          value={f.value}
                          onChange={f.onChange}
                          cuentas={cuentas}
                        />
                      )}
                    />
                    {errors.lineas?.[index]?.cuentaId && (
                      <FieldError
                        message={errors.lineas[index]?.cuentaId?.message}
                      />
                    )}
                  </td>
                  <td className="py-2 pr-3 pt-2 text-right">
                    <Input
                      inputMode="decimal"
                      className="text-right tabular-nums"
                      aria-invalid={!!errors.lineas?.[index]?.debe}
                      {...register(`lineas.${index}.debe`)}
                    />
                    {errors.lineas?.[index]?.debe && (
                      <FieldError
                        message={errors.lineas[index]?.debe?.message}
                      />
                    )}
                  </td>
                  <td className="py-2 pr-3 pt-2 text-right">
                    <Input
                      inputMode="decimal"
                      className="text-right tabular-nums"
                      aria-invalid={!!errors.lineas?.[index]?.haber}
                      {...register(`lineas.${index}.haber`)}
                    />
                    {errors.lineas?.[index]?.haber && (
                      <FieldError
                        message={errors.lineas[index]?.haber?.message}
                      />
                    )}
                  </td>
                  <td className="py-2 pr-3 pt-2">
                    <Input
                      placeholder="Opcional"
                      {...register(`lineas.${index}.referencia`)}
                    />
                  </td>
                  <td className="py-2 pt-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={fields.length <= 2}
                      onClick={() => remove(index)}
                      aria-label={`Eliminar línea ${index + 1}`}
                    >
                      <HugeiconsIcon
                        icon={Delete02Icon}
                        strokeWidth={2}
                        className="text-destructive"
                      />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardContent>
          <TotalsFooter control={control} />
          {typeof errors.lineas?.message === "string" && (
            <div className="mt-3">
              <FieldError message={errors.lineas.message} />
            </div>
          )}
          <Separator className="my-4" />
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
              {isSubmitting ? "Guardando…" : "Guardar asiento (BORRADOR)"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
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

function TotalsFooter({ control }: { control: Control<FormValues> }) {
  const lineas = useWatch({ control, name: "lineas" });

  const { debe, haber, diff, balanced } = useMemo(() => {
    const debeDec = sumColumn(lineas.map((l) => l.debe));
    const haberDec = sumColumn(lineas.map((l) => l.haber));
    const diffDec = debeDec.minus(haberDec);
    return {
      debe: debeDec.toFixed(2),
      haber: haberDec.toFixed(2),
      diff: diffDec.toFixed(2),
      balanced: debeDec.gt(0) && diffDec.abs().lt("0.005"),
    };
  }, [lineas]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="grid grid-cols-3 gap-6">
        <div>
          <p className="text-xs text-muted-foreground">Total Debe</p>
          <p className="font-mono text-base tabular-nums">{debe}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Total Haber</p>
          <p className="font-mono text-base tabular-nums">{haber}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Diferencia</p>
          <p
            className={cn(
              "font-mono text-base tabular-nums",
              balanced ? "text-muted-foreground" : "text-destructive",
            )}
          >
            {diff}
          </p>
        </div>
      </div>
      <div
        className={cn(
          "flex items-center gap-1.5 rounded-4xl px-3 py-1 text-xs font-medium",
          balanced
            ? "bg-primary/10 text-primary"
            : "bg-destructive/10 text-destructive",
        )}
      >
        <HugeiconsIcon
          icon={balanced ? CheckmarkCircle02Icon : Alert02Icon}
          strokeWidth={2}
          className="size-3.5"
        />
        {balanced ? "Balanceado" : "Desbalanceado"}
      </div>
    </div>
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
      <PopoverContent
        className="w-auto p-0"
        align="start"
      >
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

function CuentaCombobox({
  value,
  onChange,
  cuentas,
}: {
  value: number;
  onChange: (id: number) => void;
  cuentas: Cuenta[];
}) {
  const [open, setOpen] = useState(false);
  const selected = cuentas.find((c) => c.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            className="w-full justify-between font-normal"
          />
        }
      >
        <span
          className={cn(
            "truncate text-left",
            !selected && "text-muted-foreground",
          )}
        >
          {selected
            ? `${selected.codigo} — ${selected.nombre}`
            : "Seleccione cuenta analítica"}
        </span>
        <HugeiconsIcon
          icon={UnfoldMoreIcon}
          strokeWidth={2}
          className="size-4 shrink-0 text-muted-foreground"
        />
      </PopoverTrigger>
      <PopoverContent className="w-(--anchor-width) min-w-80 p-0">
        <Command>
          <CommandInput placeholder="Buscar por código o nombre…" />
          <CommandList>
            <CommandEmpty>Sin resultados.</CommandEmpty>
            {cuentas.map((c) => (
              <CommandItem
                key={c.id}
                value={`${c.codigo} ${c.nombre}`}
                onSelect={() => {
                  onChange(c.id);
                  setOpen(false);
                }}
              >
                <span className="font-mono text-xs text-muted-foreground">
                  {c.codigo}
                </span>
                <span className="truncate">{c.nombre}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
