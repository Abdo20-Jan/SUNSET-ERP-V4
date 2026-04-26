"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Alert02Icon, Calendar03Icon } from "@hugeicons/core-free-icons";

import {
  crearPrestamoAction,
  type CuentaPrestamoOption,
  type ProveedorPrestamistaOption,
} from "@/lib/actions/prestamos";
import type { CuentaBancariaOption } from "@/lib/actions/movimientos-tesoreria";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent } from "@/components/ui/card";
import { CuentaCombobox } from "@/components/cuenta-combobox";
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

const DECIMAL_RE = /^\d+(\.\d{1,2})?$/;
const FX_RE = /^\d+(\.\d{1,6})?$/;

const formSchema = z
  .object({
    prestamista: z
      .string()
      .trim()
      .min(1, "Prestamista requerido")
      .max(150, "Máx. 150 caracteres"),
    cuentaBancariaId: z
      .string()
      .uuid({ message: "Seleccione la cuenta bancaria" }),
    fecha: z.date({ message: "Seleccione la fecha" }),
    principal: z
      .string()
      .regex(DECIMAL_RE, "Principal inválido (máx. 2 decimales)"),
    moneda: z.enum(["ARS", "USD"]),
    tipoCambio: z.string().regex(FX_RE, "Tipo de cambio inválido"),
    clasificacion: z.enum(["CORTO_PLAZO", "LARGO_PLAZO"]),
    cuentaContableId: z.number().int().positive().nullable(),
    crearCuentaAuto: z.boolean(),
  })
  .superRefine((data, ctx) => {
    if (Number(data.principal) <= 0) {
      ctx.addIssue({
        path: ["principal"],
        code: z.ZodIssueCode.custom,
        message: "El principal debe ser mayor a 0",
      });
    }
    const tc = Number(data.tipoCambio);
    if (data.moneda === "ARS" && tc !== 1) {
      ctx.addIssue({
        path: ["tipoCambio"],
        code: z.ZodIssueCode.custom,
        message: "TC debe ser 1 cuando moneda=ARS",
      });
    }
    if (data.moneda === "USD" && (!Number.isFinite(tc) || tc <= 0)) {
      ctx.addIssue({
        path: ["tipoCambio"],
        code: z.ZodIssueCode.custom,
        message: "TC debe ser mayor a cero",
      });
    }
    if (!data.crearCuentaAuto && data.cuentaContableId === null) {
      ctx.addIssue({
        path: ["cuentaContableId"],
        code: z.ZodIssueCode.custom,
        message: "Seleccione la cuenta de pasivo o active auto-creación.",
      });
    }
  });

type FormValues = z.infer<typeof formSchema>;

export function PrestamoForm({
  cuentasBancarias,
  cuentasCortoPlazo,
  cuentasLargoPlazo,
  proveedoresExterior,
}: {
  cuentasBancarias: CuentaBancariaOption[];
  cuentasCortoPlazo: CuentaPrestamoOption[];
  cuentasLargoPlazo: CuentaPrestamoOption[];
  proveedoresExterior: ProveedorPrestamistaOption[];
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
      prestamista: "",
      cuentaBancariaId: "",
      fecha: new Date(),
      principal: "0",
      moneda: "ARS",
      tipoCambio: "1",
      clasificacion: "CORTO_PLAZO",
      cuentaContableId: null,
      crearCuentaAuto: true,
    },
  });

  const moneda = useWatch({ control, name: "moneda" });
  const cuentaBancariaId = useWatch({ control, name: "cuentaBancariaId" });
  const principal = useWatch({ control, name: "principal" });
  const tipoCambio = useWatch({ control, name: "tipoCambio" });
  const clasificacion = useWatch({ control, name: "clasificacion" });
  const cuentaContableId = useWatch({ control, name: "cuentaContableId" });
  const crearCuentaAuto = useWatch({ control, name: "crearCuentaAuto" });

  const bancoSeleccionado = useMemo(
    () => cuentasBancarias.find((c) => c.id === cuentaBancariaId) ?? null,
    [cuentasBancarias, cuentaBancariaId],
  );

  useEffect(() => {
    if (moneda === "ARS") {
      setValue("tipoCambio", "1", { shouldValidate: true });
    }
  }, [moneda, setValue]);

  const cuentasPorClasificacion = useMemo(
    () =>
      clasificacion === "CORTO_PLAZO" ? cuentasCortoPlazo : cuentasLargoPlazo,
    [clasificacion, cuentasCortoPlazo, cuentasLargoPlazo],
  );

  // Si cambió la clasificación y la cuenta seleccionada ya no está disponible, resetear
  useEffect(() => {
    if (
      cuentaContableId &&
      !cuentasPorClasificacion.some((c) => c.id === cuentaContableId)
    ) {
      setValue("cuentaContableId", null, { shouldValidate: false });
    }
  }, [cuentasPorClasificacion, cuentaContableId, setValue]);

  const cuentaContableSeleccionada = useMemo(
    () =>
      cuentasPorClasificacion.find((c) => c.id === cuentaContableId) ?? null,
    [cuentasPorClasificacion, cuentaContableId],
  );

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      const result = await crearPrestamoAction({
        prestamista: values.prestamista,
        cuentaBancariaId: values.cuentaBancariaId,
        fecha: values.fecha,
        principal: values.principal,
        moneda: values.moneda,
        tipoCambio: values.tipoCambio,
        clasificacion: values.clasificacion,
        cuentaContableId: values.crearCuentaAuto
          ? null
          : values.cuentaContableId,
      });

      if (result.ok) {
        toast.success(
          `Préstamo registrado — Asiento Nº ${result.asientoNumero}`,
        );
        router.push("/tesoreria/prestamos");
      } else {
        toast.error(result.error);
      }
    });
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <Card>
        <CardContent className="flex flex-col gap-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label>Prestamista</Label>
              <Controller
                control={control}
                name="prestamista"
                render={({ field }) => (
                  <Select
                    value={field.value || undefined}
                    onValueChange={field.onChange}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Seleccione proveedor del exterior" />
                    </SelectTrigger>
                    <SelectContent>
                      {proveedoresExterior.length === 0 ? (
                        <SelectItem value="__none__" disabled>
                          Sin proveedores del exterior — créelos en Maestros
                        </SelectItem>
                      ) : (
                        proveedoresExterior.map((p) => (
                          <SelectItem key={p.id} value={p.nombre}>
                            {p.nombre}{" "}
                            <span className="text-xs text-muted-foreground">
                              · {p.pais}
                            </span>
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.prestamista && (
                <FieldError message={errors.prestamista.message} />
              )}
              <p className="text-xs text-muted-foreground">
                Solo proveedores con país ≠ Argentina (cargados en Maestros).
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="fecha">Fecha del préstamo</Label>
              <Controller
                control={control}
                name="fecha"
                render={({ field }) => (
                  <DatePicker value={field.value} onChange={field.onChange} />
                )}
              />
              {errors.fecha && <FieldError message={errors.fecha.message} />}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Cuenta bancaria destino</Label>
            <Controller
              control={control}
              name="cuentaBancariaId"
              render={({ field }) => (
                <Select
                  value={field.value || undefined}
                  onValueChange={field.onChange}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Seleccione la cuenta donde entra el dinero">
                      {(value) => {
                        const c = cuentasBancarias.find((c) => c.id === value);
                        return c
                          ? `${c.banco} · ${c.numero} · ${c.moneda}`
                          : "Seleccione la cuenta donde entra el dinero";
                      }}
                    </SelectValue>
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
            {errors.cuentaBancariaId && (
              <FieldError message={errors.cuentaBancariaId.message} />
            )}
            {bancoSeleccionado && (
              <p className="text-xs text-muted-foreground">
                Cuenta contable:{" "}
                <span className="font-mono">
                  {bancoSeleccionado.cuentaContableCodigo}
                </span>{" "}
                — {bancoSeleccionado.cuentaContableNombre}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="principal">Principal</Label>
              <Input
                id="principal"
                inputMode="decimal"
                className="text-right tabular-nums"
                aria-invalid={!!errors.principal}
                {...register("principal")}
              />
              {errors.principal && (
                <FieldError message={errors.principal.message} />
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
                    onValueChange={field.onChange}
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
              {bancoSeleccionado && moneda !== bancoSeleccionado.moneda && (
                <p className="text-xs text-muted-foreground">
                  El préstamo se liquida a {bancoSeleccionado.moneda} aplicando
                  el tipo de cambio.
                </p>
              )}
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

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label>Clasificación</Label>
              <Controller
                control={control}
                name="clasificacion"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CORTO_PLAZO">
                        Corto plazo (2.1.7.*)
                      </SelectItem>
                      <SelectItem value="LARGO_PLAZO">
                        Largo plazo (2.2.1.*)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="flex flex-col gap-3 rounded-md border bg-muted/20 p-3">
              <Label className="text-sm">Cuenta de pasivo</Label>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  {...register("crearCuentaAuto")}
                />
                <span>
                  <span className="font-medium">Crear automáticamente</span>{" "}
                  una cuenta analítica para este préstamo
                  <span className="ml-1 text-xs text-muted-foreground">
                    (rango{" "}
                    {clasificacion === "CORTO_PLAZO" ? "2.1.7.10–99" : "2.2.1.10–99"}
                    )
                  </span>
                </span>
              </label>
              {!crearCuentaAuto && (
                <Controller
                  control={control}
                  name="cuentaContableId"
                  render={({ field }) => (
                    <CuentaCombobox
                      value={field.value || null}
                      onChange={field.onChange}
                      cuentas={cuentasPorClasificacion}
                      placeholder="Seleccione la cuenta analítica de pasivo"
                      emptyMessage="Sin cuentas disponibles para esta clasificación."
                    />
                  )}
                />
              )}
              {errors.cuentaContableId && (
                <FieldError message={errors.cuentaContableId.message} />
              )}
            </div>
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
            principal={principal}
            tipoCambio={tipoCambio}
            moneda={moneda}
            banco={bancoSeleccionado}
            cuentaContable={cuentaContableSeleccionada}
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
          {isSubmitting ? "Guardando…" : "Registrar préstamo"}
        </Button>
      </div>
    </form>
  );
}

function AsientoPreview({
  principal,
  tipoCambio,
  moneda,
  banco,
  cuentaContable,
}: {
  principal: string;
  tipoCambio: string;
  moneda: "ARS" | "USD";
  banco: CuentaBancariaOption | null;
  cuentaContable: CuentaPrestamoOption | null;
}) {
  const p = Number(principal);
  const tc = Number(tipoCambio);
  const valor =
    Number.isFinite(p) && Number.isFinite(tc) && p > 0 && tc > 0 ? p * tc : 0;
  const valorFmt =
    valor > 0
      ? valor.toLocaleString("es-AR", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : "—";

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
          <tr className="border-t">
            <td className="py-2 pl-3 text-xs text-muted-foreground">DEBE</td>
            <td className="py-2 pl-3">
              {banco ? (
                <span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {banco.cuentaContableCodigo}
                  </span>{" "}
                  <span>{banco.cuentaContableNombre}</span>
                </span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </td>
            <td className="py-2 pr-3 text-right font-mono tabular-nums">
              {valorFmt}
            </td>
            <td className="py-2 pr-3 text-right font-mono tabular-nums">—</td>
          </tr>
          <tr className="border-t">
            <td className="py-2 pl-3 text-xs text-muted-foreground">HABER</td>
            <td className="py-2 pl-3">
              {cuentaContable ? (
                <span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {cuentaContable.codigo}
                  </span>{" "}
                  <span>{cuentaContable.nombre}</span>
                </span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </td>
            <td className="py-2 pr-3 text-right font-mono tabular-nums">—</td>
            <td className="py-2 pr-3 text-right font-mono tabular-nums">
              {valorFmt}
            </td>
          </tr>
        </tbody>
        <tfoot className="border-t bg-muted/30 text-xs">
          <tr>
            <td colSpan={2} className="py-2 pl-3 text-muted-foreground">
              Moneda: {moneda} · Principal × TC = Valor en ARS
            </td>
            <td className="py-2 pr-3 text-right font-mono tabular-nums">
              {valorFmt}
            </td>
            <td className="py-2 pr-3 text-right font-mono tabular-nums">
              {valorFmt}
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
