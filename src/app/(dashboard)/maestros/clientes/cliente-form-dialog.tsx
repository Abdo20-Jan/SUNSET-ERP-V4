"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";

import { CondicionIva } from "@/generated/prisma/client";
import {
  actualizarClienteAction,
  crearClienteAction,
  type ClienteRow,
  type CuentaContableOption,
} from "@/lib/actions/clientes";
import { Button } from "@/components/ui/button";
import { CuentaCombobox } from "@/components/cuenta-combobox";
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

export type ClienteFormState =
  | { mode: "create" }
  | { mode: "edit"; row: ClienteRow };

const CONDICION_IVA_LABEL: Record<CondicionIva, string> = {
  RI: "Responsable Inscripto",
  MONOTRIBUTO: "Monotributista",
  EXENTO: "Exento",
  CONSUMIDOR_FINAL: "Consumidor Final",
};

const CONDICION_IVA_VALUES = Object.keys(CONDICION_IVA_LABEL) as CondicionIva[];

const formSchema = z.object({
  nombre: z.string().trim().min(1, "El nombre es obligatorio."),
  cuit: z.string().trim().optional().or(z.literal("")),
  condicionIva: z.enum(CONDICION_IVA_VALUES as [CondicionIva, ...CondicionIva[]]),
  tipo: z.string().trim().optional().or(z.literal("")),
  direccion: z.string().trim().optional().or(z.literal("")),
  telefono: z.string().trim().optional().or(z.literal("")),
  email: z
    .string()
    .trim()
    .optional()
    .or(z.literal(""))
    .refine(
      (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      "Email inválido.",
    ),
  estado: z.enum(["activo", "inactivo"]),
  cuentaContableId: z.number().int().positive().nullable(),
  crearCuentaAuto: z.boolean(),
});

type FormValues = z.infer<typeof formSchema>;

function emptyDefaults(): FormValues {
  return {
    nombre: "",
    cuit: "",
    condicionIva: "RI",
    tipo: "minorista",
    direccion: "",
    telefono: "",
    email: "",
    estado: "activo",
    cuentaContableId: null,
    crearCuentaAuto: true,
  };
}

function defaultsFromRow(row: ClienteRow): FormValues {
  return {
    nombre: row.nombre,
    cuit: row.cuit ?? "",
    condicionIva: row.condicionIva,
    tipo: row.tipo,
    direccion: row.direccion ?? "",
    telefono: row.telefono ?? "",
    email: row.email ?? "",
    estado: row.estado === "inactivo" ? "inactivo" : "activo",
    cuentaContableId: row.cuentaContableId,
    crearCuentaAuto: false,
  };
}

export function ClienteFormDialog({
  state,
  cuentas,
  onClose,
}: {
  state: ClienteFormState | null;
  cuentas: CuentaContableOption[];
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

  const crearCuentaAuto = useWatch({ control, name: "crearCuentaAuto" });

  const onSubmit = handleSubmit((values) => {
    if (!state) return;
    startTransition(async () => {
      const payload = {
        nombre: values.nombre,
        cuit: values.cuit && values.cuit.length > 0 ? values.cuit : undefined,
        condicionIva: values.condicionIva,
        tipo: values.tipo && values.tipo.length > 0 ? values.tipo : undefined,
        direccion:
          values.direccion && values.direccion.length > 0
            ? values.direccion
            : undefined,
        telefono:
          values.telefono && values.telefono.length > 0
            ? values.telefono
            : undefined,
        email: values.email && values.email.length > 0 ? values.email : undefined,
        estado: values.estado,
        cuentaContableId: values.cuentaContableId ?? null,
        crearCuentaAuto:
          state.mode === "create" &&
          values.crearCuentaAuto &&
          values.cuentaContableId === null,
      };

      const result =
        state.mode === "edit"
          ? await actualizarClienteAction(state.row.id, payload)
          : await crearClienteAction(payload);

      if (result.ok) {
        toast.success(
          state.mode === "edit"
            ? "Cliente actualizado."
            : "Cliente creado.",
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
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {state?.mode === "edit" ? "Editar cliente" : "Nuevo cliente"}
          </DialogTitle>
          <DialogDescription>
            {state?.mode === "edit"
              ? "Modifique los datos del cliente y guarde los cambios."
              : "Complete los datos para registrar un nuevo cliente."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2 flex flex-col gap-2">
              <Label htmlFor="nombre">Nombre *</Label>
              <Input
                id="nombre"
                aria-invalid={!!errors.nombre}
                {...register("nombre")}
              />
              {errors.nombre && <FieldError message={errors.nombre.message} />}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="cuit">CUIT</Label>
              <Input
                id="cuit"
                placeholder="XX-XXXXXXXX-X"
                aria-invalid={!!errors.cuit}
                {...register("cuit")}
              />
              {errors.cuit && <FieldError message={errors.cuit.message} />}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="tipo">Tipo</Label>
              <Input
                id="tipo"
                placeholder="minorista"
                {...register("tipo")}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label>Condición IVA *</Label>
              <Controller
                control={control}
                name="condicionIva"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONDICION_IVA_VALUES.map((v) => (
                        <SelectItem key={v} value={v}>
                          {CONDICION_IVA_LABEL[v]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label>Estado</Label>
              <Controller
                control={control}
                name="estado"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="activo">Activo</SelectItem>
                      <SelectItem value="inactivo">Inactivo</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="telefono">Teléfono</Label>
              <Input id="telefono" {...register("telefono")} />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                aria-invalid={!!errors.email}
                {...register("email")}
              />
              {errors.email && <FieldError message={errors.email.message} />}
            </div>

            <div className="sm:col-span-2 flex flex-col gap-2">
              <Label htmlFor="direccion">Dirección</Label>
              <Input id="direccion" {...register("direccion")} />
            </div>

            <div className="sm:col-span-2 flex flex-col gap-3 rounded-md border bg-muted/20 p-3">
              <Label className="text-sm">Cuenta contable</Label>
              {state?.mode === "create" && (
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    {...register("crearCuentaAuto")}
                  />
                  <span>
                    <span className="font-medium">
                      Crear automáticamente
                    </span>{" "}
                    una cuenta analítica para este cliente
                    <span className="ml-1 text-xs text-muted-foreground">
                      (sugerido — rango 1.1.3.10–99)
                    </span>
                  </span>
                </label>
              )}
              {(state?.mode === "edit" || !crearCuentaAuto) && (
                <Controller
                  control={control}
                  name="cuentaContableId"
                  render={({ field }) => (
                    <CuentaCombobox
                      value={field.value}
                      onChange={field.onChange}
                      cuentas={cuentas}
                      placeholder="Sin vincular — seleccione cuenta 1.1.3.xx"
                      emptyMessage="No hay cuentas disponibles."
                    />
                  )}
                />
              )}
              <p className="text-xs text-muted-foreground">
                Solo cuentas analíticas bajo{" "}
                <span className="font-mono">1.1.3 CRÉDITOS POR VENTAS</span>.
                Si elige "Crear automáticamente", el sistema asigna el
                próximo código disponible al guardar.
              </p>
            </div>
          </div>

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
                  : "Crear cliente"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
