"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";

import {
  actualizarProductoAction,
  crearProductoAction,
  type ProductoRow,
} from "@/lib/actions/productos";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldError } from "@/components/form/field-error";
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

export type ProductoFormState =
  | { mode: "create" }
  | { mode: "edit"; row: ProductoRow };

const DECIMAL_2_RE = /^\d+(\.\d{1,2})?$/;
const DECIMAL_4_RE = /^\d+(\.\d{1,4})?$/;

const formSchema = z.object({
  codigo: z.string().trim().min(1, "El código es obligatorio."),
  nombre: z.string().trim().min(1, "El nombre es obligatorio."),
  descripcion: z.string().trim().optional().or(z.literal("")),
  marca: z.string().trim().optional().or(z.literal("")),
  modelo: z.string().trim().optional().or(z.literal("")),
  medida: z.string().trim().optional().or(z.literal("")),
  ncm: z.string().trim().optional().or(z.literal("")),
  unidad: z.string().trim().min(1, "La unidad es obligatoria."),
  diePorcentaje: z
    .string()
    .regex(DECIMAL_4_RE, "% DIE inválido (máx. 4 decimales, ≥ 0)."),
  precioVenta: z
    .string()
    .regex(DECIMAL_2_RE, "Precio inválido (máx. 2 decimales, ≥ 0)."),
  stockMinimo: z
    .string()
    .regex(/^\d+$/, "Stock mínimo debe ser un entero ≥ 0."),
  activo: z.enum(["si", "no"]),
});

type FormValues = z.infer<typeof formSchema>;

function emptyDefaults(): FormValues {
  return {
    codigo: "",
    nombre: "",
    descripcion: "",
    marca: "",
    modelo: "",
    medida: "",
    ncm: "",
    unidad: "UN",
    diePorcentaje: "0",
    precioVenta: "0",
    stockMinimo: "0",
    activo: "si",
  };
}

function defaultsFromRow(row: ProductoRow): FormValues {
  return {
    codigo: row.codigo,
    nombre: row.nombre,
    descripcion: row.descripcion ?? "",
    marca: row.marca ?? "",
    modelo: row.modelo ?? "",
    medida: row.medida ?? "",
    ncm: row.ncm ?? "",
    unidad: row.unidad,
    diePorcentaje: row.diePorcentaje,
    precioVenta: row.precioVenta,
    stockMinimo: String(row.stockMinimo),
    activo: row.activo ? "si" : "no",
  };
}

export function ProductoFormDialog({
  state,
  onClose,
}: {
  state: ProductoFormState | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [isSubmitting, startTransition] = useTransition();
  const open = state !== null;

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    mode: "onBlur",
    defaultValues: emptyDefaults(),
  });

  useEffect(() => {
    if (!state) return;
    reset(state.mode === "edit" ? defaultsFromRow(state.row) : emptyDefaults());
  }, [state, reset]);

  const onSubmit = handleSubmit((values) => {
    if (!state) return;
    startTransition(async () => {
      const payload = {
        codigo: values.codigo,
        nombre: values.nombre,
        descripcion:
          values.descripcion && values.descripcion.length > 0
            ? values.descripcion
            : undefined,
        marca:
          values.marca && values.marca.length > 0 ? values.marca : undefined,
        modelo:
          values.modelo && values.modelo.length > 0 ? values.modelo : undefined,
        medida:
          values.medida && values.medida.length > 0 ? values.medida : undefined,
        ncm: values.ncm && values.ncm.length > 0 ? values.ncm : undefined,
        unidad: values.unidad,
        diePorcentaje: Number(values.diePorcentaje),
        precioVenta: Number(values.precioVenta),
        stockMinimo: Number(values.stockMinimo),
        activo: values.activo === "si",
      };

      const result =
        state.mode === "edit"
          ? await actualizarProductoAction(state.row.id, payload)
          : await crearProductoAction(payload);

      if (result.ok) {
        toast.success(
          state.mode === "edit"
            ? "Producto actualizado."
            : "Producto creado.",
        );
        onClose();
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !isSubmitting) onClose();
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {state?.mode === "edit" ? "Editar producto" : "Nuevo producto"}
          </DialogTitle>
          <DialogDescription>
            {state?.mode === "edit"
              ? "Modifique los datos del producto y guarde los cambios."
              : "Complete los datos para registrar un nuevo producto."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-6">
          <section className="flex flex-col gap-4">
            <h3 className="text-sm font-medium text-muted-foreground">
              Datos básicos
            </h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="codigo">Código *</Label>
                <Input
                  id="codigo"
                  className="font-mono uppercase"
                  placeholder="BRIDG-205-55-16"
                  aria-invalid={!!errors.codigo}
                  {...register("codigo")}
                />
                {errors.codigo && <FieldError message={errors.codigo.message} />}
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="nombre">Nombre *</Label>
                <Input
                  id="nombre"
                  aria-invalid={!!errors.nombre}
                  {...register("nombre")}
                />
                {errors.nombre && <FieldError message={errors.nombre.message} />}
              </div>

              <div className="sm:col-span-2 flex flex-col gap-2">
                <Label htmlFor="descripcion">Descripción</Label>
                <Textarea
                  id="descripcion"
                  rows={2}
                  {...register("descripcion")}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="marca">Marca</Label>
                <Input id="marca" {...register("marca")} />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="modelo">Modelo</Label>
                <Input id="modelo" {...register("modelo")} />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="medida">Medida</Label>
                <Input
                  id="medida"
                  placeholder="205/55R16"
                  {...register("medida")}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="ncm">NCM</Label>
                <Input
                  id="ncm"
                  className="font-mono"
                  {...register("ncm")}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="unidad">Unidad *</Label>
                <Input
                  id="unidad"
                  aria-invalid={!!errors.unidad}
                  {...register("unidad")}
                />
                {errors.unidad && <FieldError message={errors.unidad.message} />}
              </div>
            </div>
          </section>

          <section className="flex flex-col gap-4">
            <h3 className="text-sm font-medium text-muted-foreground">
              Datos financieros y stock
            </h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="diePorcentaje">% DIE</Label>
                <Input
                  id="diePorcentaje"
                  inputMode="decimal"
                  className="text-right tabular-nums"
                  aria-invalid={!!errors.diePorcentaje}
                  {...register("diePorcentaje")}
                />
                {errors.diePorcentaje && (
                  <FieldError message={errors.diePorcentaje.message} />
                )}
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="precioVenta">Precio de venta</Label>
                <Input
                  id="precioVenta"
                  inputMode="decimal"
                  className="text-right tabular-nums"
                  aria-invalid={!!errors.precioVenta}
                  {...register("precioVenta")}
                />
                {errors.precioVenta && (
                  <FieldError message={errors.precioVenta.message} />
                )}
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="stockMinimo">Stock mínimo</Label>
                <Input
                  id="stockMinimo"
                  inputMode="numeric"
                  className="text-right tabular-nums"
                  aria-invalid={!!errors.stockMinimo}
                  {...register("stockMinimo")}
                />
                {errors.stockMinimo && (
                  <FieldError message={errors.stockMinimo.message} />
                )}
              </div>

              <div className="flex flex-col gap-2">
                <Label>Stock actual</Label>
                <Input
                  disabled
                  className="text-right tabular-nums"
                  value={
                    state?.mode === "edit" ? state.row.stockActual : 0
                  }
                  readOnly
                />
                <p className="text-xs text-muted-foreground">
                  Calculado por COMEX/Ventas.
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <Label>Costo promedio</Label>
                <Input
                  disabled
                  className="text-right tabular-nums"
                  value={
                    state?.mode === "edit" ? state.row.costoPromedio : "0.00"
                  }
                  readOnly
                />
                <p className="text-xs text-muted-foreground">
                  Calculado por COMEX/Ventas.
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <Label>Activo</Label>
                <Controller
                  control={control}
                  name="activo"
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="si">Activo</SelectItem>
                        <SelectItem value="no">Inactivo</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
            </div>
          </section>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? "Guardando…"
                : state?.mode === "edit"
                  ? "Guardar cambios"
                  : "Crear producto"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
