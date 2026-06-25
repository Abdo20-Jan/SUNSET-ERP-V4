"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Edit02Icon } from "@hugeicons/core-free-icons";

import { actualizarUsuarioAction, type UsuarioDetalle } from "@/lib/actions/usuarios";
import type { PerfilRow } from "@/lib/actions/permisos-admin";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  nombre: z.string().trim().min(1, "El nombre es obligatorio."),
  role: z.enum(["ADMIN", "USER"]),
  perfilId: z.string(),
  estado: z.enum(["activo", "inactivo"]),
  password: z
    .string()
    .optional()
    .or(z.literal(""))
    .refine((v) => !v || v.length >= 6, "La contraseña debe tener al menos 6 caracteres."),
  motivo: z.string().trim().optional(),
});
type FormValues = z.infer<typeof formSchema>;

function defaultsFrom(u: UsuarioDetalle): FormValues {
  return {
    nombre: u.nombre,
    role: u.role,
    perfilId: u.perfilId ?? SIN_PERFIL,
    estado: u.activo ? "activo" : "inactivo",
    password: "",
    motivo: "",
  };
}

export function UsuarioEditWindow({
  usuario,
  perfiles,
}: {
  usuario: UsuarioDetalle;
  perfiles: PerfilRow[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isSaving, startSaving] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const confirmResolverRef = useRef<((ok: boolean) => void) | null>(null);

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: defaultsFrom(usuario),
  });
  const { isDirtyRef } = useDirtyState(isDirty);

  useEffect(() => {
    if (open) reset(defaultsFrom(usuario));
  }, [open, usuario, reset]);

  const onSubmit = handleSubmit((values) => {
    startSaving(async () => {
      const res = await actualizarUsuarioAction(usuario.id, {
        nombre: values.nombre,
        role: values.role,
        perfilId: values.perfilId === SIN_PERFIL ? undefined : values.perfilId,
        activo: values.estado === "activo",
        password: values.password && values.password.length > 0 ? values.password : "",
        motivo: values.motivo && values.motivo.length > 0 ? values.motivo : undefined,
      });
      if (res.ok) {
        toast.success("Usuario actualizado.");
        reset(values);
        setOpen(false);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  });

  const requestDiscardConfirm = () =>
    new Promise<boolean>((resolve) => {
      confirmResolverRef.current = resolve;
      setConfirmOpen(true);
    });

  const resolveConfirm = (ok: boolean) => {
    setConfirmOpen(false);
    const resolver = confirmResolverRef.current;
    confirmResolverRef.current = null;
    resolver?.(ok);
  };

  const handleCancel = async () => {
    if (!isDirtyRef.current) {
      setOpen(false);
      return;
    }
    if (await requestDiscardConfirm()) setOpen(false);
  };

  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        <HugeiconsIcon icon={Edit02Icon} strokeWidth={2} />
        Editar
      </Button>

      <FloatingWorkWindow
        open={open}
        onOpenChange={setOpen}
        title={`Editar usuario · ${usuario.nombre}`}
        description="Cambios de rol o estado exigen motivo (auditado). El usuario no puede quedar sin Master."
        initialWidth={600}
        initialHeight={560}
        onRequestClose={() => (isDirtyRef.current ? requestDiscardConfirm() : true)}
        footer={
          <DirtyFooter
            isDirty={isDirty}
            isSaving={isSaving}
            onSave={() => void onSubmit()}
            onCancel={() => void handleCancel()}
            tabHref={`/sistema/usuarios/${usuario.id}`}
            tabLabel={usuario.nombre}
          />
        }
      >
        <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label>Usuario</Label>
            <Input value={usuario.username} disabled readOnly />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="nombre">Nombre *</Label>
            <Input id="nombre" aria-invalid={!!errors.nombre} {...register("nombre")} />
            {errors.nombre && <FieldError message={errors.nombre.message} />}
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

          <div className="flex flex-col gap-2 sm:col-span-2">
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

          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor="password">Nueva contraseña (opcional)</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              placeholder="Dejar vacío para no cambiarla"
              aria-invalid={!!errors.password}
              {...register("password")}
            />
            {errors.password && <FieldError message={errors.password.message} />}
          </div>

          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor="motivo">Motivo (obligatorio al cambiar rol o estado)</Label>
            <Input
              id="motivo"
              placeholder="Ej.: alta de gestor comercial"
              {...register("motivo")}
            />
          </div>
        </form>
      </FloatingWorkWindow>

      <Dialog
        open={confirmOpen}
        onOpenChange={(o) => {
          if (!o) resolveConfirm(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Descartar cambios</DialogTitle>
            <DialogDescription>Hay cambios sin guardar. ¿Desea descartarlos?</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => resolveConfirm(false)}>
              Seguir editando
            </Button>
            <Button type="button" variant="destructive" onClick={() => resolveConfirm(true)}>
              Descartar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
