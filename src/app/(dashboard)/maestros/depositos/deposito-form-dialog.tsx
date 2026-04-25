"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";

import {
  actualizarDepositoAction,
  crearDepositoAction,
  type DepositoRow,
} from "@/lib/actions/depositos";
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

export type DepositoFormState =
  | { mode: "create" }
  | { mode: "edit"; row: DepositoRow };

const formSchema = z.object({
  nombre: z.string().trim().min(1, "El nombre es obligatorio."),
  direccion: z.string().trim().optional().or(z.literal("")),
  activo: z.enum(["si", "no"]),
});

type FormValues = z.infer<typeof formSchema>;

function emptyDefaults(): FormValues {
  return { nombre: "", direccion: "", activo: "si" };
}

function defaultsFromRow(row: DepositoRow): FormValues {
  return {
    nombre: row.nombre,
    direccion: row.direccion ?? "",
    activo: row.activo ? "si" : "no",
  };
}

export function DepositoFormDialog({
  state,
  onClose,
}: {
  state: DepositoFormState | null;
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
        nombre: values.nombre,
        direccion:
          values.direccion && values.direccion.length > 0
            ? values.direccion
            : undefined,
        activo: values.activo === "si",
      };

      const result =
        state.mode === "edit"
          ? await actualizarDepositoAction(state.row.id, payload)
          : await crearDepositoAction(payload);

      if (result.ok) {
        toast.success(
          state.mode === "edit"
            ? "Depósito actualizado."
            : "Depósito creado.",
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {state?.mode === "edit" ? "Editar depósito" : "Nuevo depósito"}
          </DialogTitle>
          <DialogDescription>
            {state?.mode === "edit"
              ? "Modifique los datos del depósito y guarde los cambios."
              : "Complete los datos para registrar un nuevo depósito."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="nombre">Nombre *</Label>
            <Input
              id="nombre"
              aria-invalid={!!errors.nombre}
              {...register("nombre")}
            />
            {errors.nombre && <FieldError message={errors.nombre.message} />}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="direccion">Dirección</Label>
            <Input id="direccion" {...register("direccion")} />
          </div>

          <div className="flex flex-col gap-2">
            <Label>Estado</Label>
            <Controller
              control={control}
              name="activo"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
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
                  : "Crear depósito"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
