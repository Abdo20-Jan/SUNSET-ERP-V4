"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";

import {
  actualizarProveedorAction,
  crearProveedorAction,
  type CuentaContableOption,
  type ProveedorRow,
} from "@/lib/actions/proveedores";
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

export type ProveedorFormState =
  | { mode: "create" }
  | { mode: "edit"; row: ProveedorRow };

const PAISES: Array<{ code: string; label: string }> = [
  { code: "AR", label: "Argentina" },
  { code: "BR", label: "Brasil" },
  { code: "PY", label: "Paraguay" },
  { code: "CL", label: "Chile" },
  { code: "UY", label: "Uruguay" },
  { code: "US", label: "Estados Unidos" },
  { code: "CN", label: "China" },
  { code: "DE", label: "Alemania" },
  { code: "JP", label: "Japón" },
  { code: "KR", label: "Corea del Sur" },
  { code: "IT", label: "Italia" },
  { code: "ES", label: "España" },
];

const formSchema = z
  .object({
    nombre: z.string().trim().min(1, "El nombre es obligatorio."),
    nacionalidad: z.enum(["NACIONAL", "EXTRANJERO"]),
    cuit: z.string().trim().optional().or(z.literal("")),
    pais: z.string().trim().min(2).max(2),
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
  })
  .superRefine((data, ctx) => {
    if (
      data.nacionalidad === "NACIONAL" &&
      (!data.cuit || data.cuit.length === 0)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["cuit"],
        message: "El CUIT es obligatorio para proveedores nacionales.",
      });
    }
  });

type FormValues = z.infer<typeof formSchema>;

function emptyDefaults(): FormValues {
  return {
    nombre: "",
    nacionalidad: "NACIONAL",
    cuit: "",
    pais: "AR",
    tipo: "otro",
    direccion: "",
    telefono: "",
    email: "",
    estado: "activo",
    cuentaContableId: null,
    crearCuentaAuto: true,
  };
}

function defaultsFromRow(row: ProveedorRow): FormValues {
  return {
    nombre: row.nombre,
    nacionalidad: row.pais === "AR" ? "NACIONAL" : "EXTRANJERO",
    cuit: row.cuit ?? "",
    pais: row.pais,
    tipo: row.tipo,
    direccion: row.direccion ?? "",
    telefono: row.telefono ?? "",
    email: row.email ?? "",
    estado: row.estado === "inactivo" ? "inactivo" : "activo",
    cuentaContableId: row.cuentaContableId,
    crearCuentaAuto: false, // editando: ya tiene cuenta o el usuario eligió no
  };
}

export function ProveedorFormDialog({
  state,
  cuentas,
  onClose,
}: {
  state: ProveedorFormState | null;
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
    setValue,
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

  const nacionalidad = useWatch({ control, name: "nacionalidad" });
  const pais = useWatch({ control, name: "pais" });
  const crearCuentaAuto = useWatch({ control, name: "crearCuentaAuto" });

  // Cuando cambian la nacionalidad, ajustar país y CUIT placeholder.
  useEffect(() => {
    if (nacionalidad === "NACIONAL" && pais !== "AR") {
      setValue("pais", "AR", { shouldValidate: true });
    }
    if (nacionalidad === "EXTRANJERO" && pais === "AR") {
      setValue("pais", "BR", { shouldValidate: true }); // primer extranjero en la lista
    }
  }, [nacionalidad, pais, setValue]);

  const onSubmit = handleSubmit((values) => {
    if (!state) return;
    startTransition(async () => {
      const payload = {
        nombre: values.nombre,
        cuit:
          values.cuit && values.cuit.trim().length > 0
            ? values.cuit
            : undefined,
        pais: values.pais,
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
          ? await actualizarProveedorAction(state.row.id, payload)
          : await crearProveedorAction(payload);

      if (result.ok) {
        toast.success(
          state.mode === "edit"
            ? "Proveedor actualizado."
            : "Proveedor creado.",
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
            {state?.mode === "edit" ? "Editar proveedor" : "Nuevo proveedor"}
          </DialogTitle>
          <DialogDescription>
            {state?.mode === "edit"
              ? "Modifique los datos del proveedor y guarde los cambios."
              : "Complete los datos para registrar un nuevo proveedor."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2 flex flex-col gap-2">
              <Label>Tipo de proveedor *</Label>
              <Controller
                control={control}
                name="nacionalidad"
                render={({ field }) => (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => field.onChange("NACIONAL")}
                      className={`flex-1 rounded-md border px-3 py-2 text-sm transition ${
                        field.value === "NACIONAL"
                          ? "border-primary bg-primary/10 font-medium"
                          : "border-muted hover:bg-muted/50"
                      }`}
                    >
                      Nacional (Argentina)
                    </button>
                    <button
                      type="button"
                      onClick={() => field.onChange("EXTRANJERO")}
                      className={`flex-1 rounded-md border px-3 py-2 text-sm transition ${
                        field.value === "EXTRANJERO"
                          ? "border-primary bg-primary/10 font-medium"
                          : "border-muted hover:bg-muted/50"
                      }`}
                    >
                      Extranjero (del exterior)
                    </button>
                  </div>
                )}
              />
            </div>

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
              <Label htmlFor="cuit">
                {nacionalidad === "NACIONAL"
                  ? "CUIT *"
                  : "ID fiscal (opcional)"}
              </Label>
              <Input
                id="cuit"
                placeholder={
                  nacionalidad === "NACIONAL"
                    ? "XX-XXXXXXXX-X"
                    : "ID fiscal del país de origen"
                }
                aria-invalid={!!errors.cuit}
                {...register("cuit")}
              />
              {errors.cuit && <FieldError message={errors.cuit.message} />}
            </div>

            <div className="flex flex-col gap-2">
              <Label>País *</Label>
              <Controller
                control={control}
                name="pais"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAISES.filter((p) =>
                        nacionalidad === "NACIONAL"
                          ? p.code === "AR"
                          : p.code !== "AR",
                      ).map((p) => (
                        <SelectItem key={p.code} value={p.code}>
                          <span className="font-mono text-xs text-muted-foreground">
                            {p.code}
                          </span>
                          <span>{p.label}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="tipo">Tipo</Label>
              <Input id="tipo" placeholder="otro" {...register("tipo")} />
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
                    una cuenta analítica para este proveedor
                    <span className="ml-1 text-xs text-muted-foreground">
                      (sugerido —{" "}
                      {nacionalidad === "NACIONAL"
                        ? "rango 2.1.1.10–49"
                        : "rango 2.1.1.50–99"}
                      )
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
                      placeholder="Sin vincular — seleccione cuenta 2.1.1.xx"
                      emptyMessage="No hay cuentas disponibles."
                    />
                  )}
                />
              )}
              <p className="text-xs text-muted-foreground">
                Solo cuentas analíticas bajo{" "}
                <span className="font-mono">2.1.1 DEUDAS COMERCIALES</span>.
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
                  : "Crear proveedor"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
