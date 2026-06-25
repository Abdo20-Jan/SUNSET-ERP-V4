"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";

import { crearUsuarioAction } from "@/lib/actions/usuarios";
import type { PerfilRow } from "@/lib/actions/permisos-admin";
import { DirtyFooter } from "@/components/record/dirty-footer";
import { FloatingWorkWindow } from "@/components/record/floating-work-window";
import { useDirtyState } from "@/components/record/use-dirty-state";
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

const SIN_PERFIL = "__none__";

const formSchema = z.object({
  username: z.string().trim().min(3, "El usuario debe tener al menos 3 caracteres."),
  nombre: z.string().trim().min(1, "El nombre es obligatorio."),
  password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres."),
  role: z.enum(["ADMIN", "USER"]),
  perfilId: z.string(),
  activo: z.boolean(),
});
type FormValues = z.infer<typeof formSchema>;

const DEFAULTS: FormValues = {
  username: "",
  nombre: "",
  password: "",
  role: "USER",
  perfilId: SIN_PERFIL,
  activo: true,
};

export function UsuarioFormDialog({
  open,
  onOpenChange,
  perfiles,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  perfiles: PerfilRow[];
}) {
  const router = useRouter();
  const [isSaving, startSaving] = useTransition();
  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: DEFAULTS });
  const { isDirtyRef } = useDirtyState(isDirty);

  useEffect(() => {
    if (open) reset(DEFAULTS);
  }, [open, reset]);

  const onSubmit = handleSubmit((values) => {
    startSaving(async () => {
      const res = await crearUsuarioAction({
        username: values.username,
        nombre: values.nombre,
        password: values.password,
        role: values.role,
        perfilId: values.perfilId === SIN_PERFIL ? undefined : values.perfilId,
        activo: values.activo,
      });
      if (res.ok) {
        toast.success("Usuario creado.");
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  });

  return (
    <FloatingWorkWindow
      open={open}
      onOpenChange={onOpenChange}
      title="Nuevo usuario"
      description="Creá un usuario y asigná su rol y perfil de acceso."
      initialWidth={560}
      initialHeight={540}
      onRequestClose={() => !isDirtyRef.current}
      footer={
        <DirtyFooter
          isDirty={isDirty}
          isSaving={isSaving}
          onSave={() => void onSubmit()}
          onCancel={() => onOpenChange(false)}
          saveLabel="Crear usuario"
        />
      }
    >
      <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="username">Usuario *</Label>
          <Input
            id="username"
            autoComplete="off"
            aria-invalid={!!errors.username}
            {...register("username")}
          />
          {errors.username && <FieldError message={errors.username.message} />}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="nombre">Nombre *</Label>
          <Input id="nombre" aria-invalid={!!errors.nombre} {...register("nombre")} />
          {errors.nombre && <FieldError message={errors.nombre.message} />}
        </div>

        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label htmlFor="password">Contraseña inicial *</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            aria-invalid={!!errors.password}
            {...register("password")}
          />
          {errors.password && <FieldError message={errors.password.message} />}
        </div>

        <div className="flex flex-col gap-2">
          <Label>Rol</Label>
          <Controller
            control={control}
            name="role"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USER">Usuario</SelectItem>
                  <SelectItem value="ADMIN">Master (acceso total)</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label>Perfil de acceso</Label>
          <Controller
            control={control}
            name="perfilId"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SIN_PERFIL}>— Sin perfil —</SelectItem>
                  {perfiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>

        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" {...register("activo")} />
          <span>Usuario activo</span>
        </label>
      </form>
    </FloatingWorkWindow>
  );
}
