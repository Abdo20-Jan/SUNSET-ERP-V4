"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Alert02Icon, Calendar03Icon } from "@hugeicons/core-free-icons";

import {
  type CuentaAnticipoOption,
  type ProveedorAnticipoOption,
  registrarAnticipoProveedorAction,
} from "@/lib/actions/anticipos-proveedor";
import type { CuentaBancariaOption } from "@/lib/actions/movimientos-tesoreria";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent } from "@/components/ui/card";
import { CuentaAnticipoCombobox } from "@/components/cuenta-anticipo-combobox";
import { ProveedorCombobox } from "@/components/proveedor-combobox";
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
import { parseDefaultFecha } from "@/lib/utils/parse-default-fecha";

const DECIMAL_RE = /^\d+(\.\d{1,2})?$/;

const formSchema = z
  .object({
    proveedorId: z.string().uuid({ message: "Seleccione un proveedor" }),
    cuentaBancariaId: z.string().uuid({ message: "Seleccione la cuenta bancaria" }),
    fecha: z.date({ message: "Seleccione la fecha" }),
    monto: z.string().regex(DECIMAL_RE, "Monto inválido (máx. 2 decimales)"),
    cuentaContableId: z.number({ message: "Seleccione la cuenta de anticipo" }).int().positive(),
    descripcion: z.string().trim().max(255, "Máx. 255 caracteres"),
  })
  .superRefine((data, ctx) => {
    if (Number(data.monto) <= 0) {
      ctx.addIssue({
        path: ["monto"],
        code: z.ZodIssueCode.custom,
        message: "El monto debe ser mayor a 0",
      });
    }
  });

type FormValues = z.infer<typeof formSchema>;

export function AnticipoForm({
  proveedores,
  cuentasBancarias,
  cuentasAnticipo,
  defaultFecha,
}: {
  proveedores: ProveedorAnticipoOption[];
  cuentasBancarias: CuentaBancariaOption[];
  cuentasAnticipo: CuentaAnticipoOption[];
  defaultFecha?: string;
}) {
  const router = useRouter();
  const [isSubmitting, startTransition] = useTransition();

  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    mode: "onBlur",
    defaultValues: {
      proveedorId: "",
      cuentaBancariaId: "",
      fecha: parseDefaultFecha(defaultFecha) as Date,
      monto: "0",
      cuentaContableId: undefined,
      descripcion: "",
    },
  });

  const cuentaBancariaId = useWatch({ control, name: "cuentaBancariaId" });
  const monto = useWatch({ control, name: "monto" });
  const cuentaContableId = useWatch({ control, name: "cuentaContableId" });

  // Sólo cuentas en ARS: el anticipo a proveedor local exige banco ARS (la
  // action rechaza otra moneda). Priorizamos/filtramos en el origen.
  const cuentasArs = useMemo(
    () => cuentasBancarias.filter((c) => c.moneda === "ARS"),
    [cuentasBancarias],
  );

  const proveedorOptions = useMemo(
    () => proveedores.map((p) => ({ id: p.id, nombre: p.nombre, pais: "Local" })),
    [proveedores],
  );

  const bancoSeleccionado = useMemo(
    () => cuentasArs.find((c) => c.id === cuentaBancariaId) ?? null,
    [cuentasArs, cuentaBancariaId],
  );

  const cuentaAnticipoSeleccionada = useMemo(
    () => cuentasAnticipo.find((c) => c.id === cuentaContableId) ?? null,
    [cuentasAnticipo, cuentaContableId],
  );

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      const result = await registrarAnticipoProveedorAction({
        proveedorId: values.proveedorId,
        cuentaContableId: values.cuentaContableId,
        cuentaBancariaId: values.cuentaBancariaId,
        fecha: values.fecha,
        monto: values.monto,
        descripcion: values.descripcion.length > 0 ? values.descripcion : null,
      });

      if (result.ok) {
        toast.success(`Anticipo ${result.numero} registrado — Asiento Nº ${result.asientoNumero}`);
        router.push("/tesoreria/anticipos");
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
              <Label>Proveedor</Label>
              <Controller
                control={control}
                name="proveedorId"
                render={({ field }) => (
                  <ProveedorCombobox
                    value={field.value || null}
                    onChange={field.onChange}
                    proveedores={proveedorOptions}
                    placeholder="Seleccione el proveedor"
                    emptyMessage="Sin proveedores activos — créelos en Maestros."
                  />
                )}
              />
              {errors.proveedorId && <FieldError message={errors.proveedorId.message} />}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="fecha">Fecha del anticipo</Label>
              <Controller
                control={control}
                name="fecha"
                render={({ field }) => <DatePicker value={field.value} onChange={field.onChange} />}
              />
              {errors.fecha && <FieldError message={errors.fecha.message} />}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Cuenta bancaria de origen (ARS)</Label>
            <Controller
              control={control}
              name="cuentaBancariaId"
              render={({ field }) => (
                <Select value={field.value || undefined} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Seleccione la cuenta de donde sale el dinero">
                      {(value) => {
                        const c = cuentasArs.find((c) => c.id === value);
                        return c
                          ? `${c.banco} · ${c.numero} · ${c.moneda}`
                          : "Seleccione la cuenta de donde sale el dinero";
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {cuentasArs.length === 0 ? (
                      <SelectItem value="__none__" disabled>
                        Sin cuentas en ARS — créelas en Tesorería
                      </SelectItem>
                    ) : (
                      cuentasArs.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.banco} · {c.numero} · {c.moneda}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.cuentaBancariaId && <FieldError message={errors.cuentaBancariaId.message} />}
            {bancoSeleccionado && (
              <p className="text-xs text-muted-foreground">
                Cuenta contable:{" "}
                <span className="font-mono">{bancoSeleccionado.cuentaContableCodigo}</span> —{" "}
                {bancoSeleccionado.cuentaContableNombre}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="monto">Monto (ARS)</Label>
              <Input
                id="monto"
                inputMode="decimal"
                className="text-right tabular-nums"
                aria-invalid={!!errors.monto}
                {...register("monto")}
              />
              {errors.monto && <FieldError message={errors.monto.message} />}
            </div>

            <div className="flex flex-col gap-2">
              <Label>Cuenta de anticipo</Label>
              <Controller
                control={control}
                name="cuentaContableId"
                render={({ field }) => (
                  <CuentaAnticipoCombobox
                    value={field.value ?? null}
                    onChange={field.onChange}
                    cuentas={cuentasAnticipo}
                  />
                )}
              />
              {errors.cuentaContableId && <FieldError message={errors.cuentaContableId.message} />}
              <p className="text-xs text-muted-foreground">
                La cuenta codifica la clasificación: 1.1.7.07 = bien de cambio, 1.1.5.01 = servicio.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="descripcion">Descripción (opcional)</Label>
            <Input
              id="descripcion"
              placeholder="Ej.: Anticipo compra de neumáticos"
              aria-invalid={!!errors.descripcion}
              {...register("descripcion")}
            />
            {errors.descripcion && <FieldError message={errors.descripcion.message} />}
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
            monto={monto}
            cuentaAnticipo={cuentaAnticipoSeleccionada}
            banco={bancoSeleccionado}
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
          {isSubmitting ? "Guardando…" : "Registrar anticipo"}
        </Button>
      </div>
    </form>
  );
}

function AsientoPreview({
  monto,
  cuentaAnticipo,
  banco,
}: {
  monto: string;
  cuentaAnticipo: CuentaAnticipoOption | null;
  banco: CuentaBancariaOption | null;
}) {
  const m = Number(monto);
  const valor = Number.isFinite(m) && m > 0 ? m : 0;
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
              {cuentaAnticipo ? (
                <span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {cuentaAnticipo.codigo}
                  </span>{" "}
                  <span>{cuentaAnticipo.nombre}</span>
                </span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </td>
            <td className="py-2 pr-3 text-right font-mono tabular-nums">{valorFmt}</td>
            <td className="py-2 pr-3 text-right font-mono tabular-nums">—</td>
          </tr>
          <tr className="border-t">
            <td className="py-2 pl-3 text-xs text-muted-foreground">HABER</td>
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
            <td className="py-2 pr-3 text-right font-mono tabular-nums">—</td>
            <td className="py-2 pr-3 text-right font-mono tabular-nums">{valorFmt}</td>
          </tr>
        </tbody>
        <tfoot className="border-t bg-muted/30 text-xs">
          <tr>
            <td colSpan={2} className="py-2 pl-3 text-muted-foreground">
              Moneda: ARS · entrega de dinero a cuenta (anticipo = activo)
            </td>
            <td className="py-2 pr-3 text-right font-mono tabular-nums">{valorFmt}</td>
            <td className="py-2 pr-3 text-right font-mono tabular-nums">{valorFmt}</td>
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
