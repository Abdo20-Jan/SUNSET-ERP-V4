"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Edit02Icon } from "@hugeicons/core-free-icons";

import { actualizarDepositoAction, type DepositoRow } from "@/lib/actions/depositos";
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
import { FloatingWorkWindow } from "@/components/record/floating-work-window";
import { DirtyFooter } from "@/components/record/dirty-footer";
import { useDirtyState } from "@/components/record/use-dirty-state";

/*
 * DepositoEditWindow (PR-004 — piloto) — ilha client que abre a edição do
 * depósito numa FloatingWorkWindow (em vez de drawer/dialog), com DirtyFooter e
 * confirmação de descarte de mudanças não salvas. Reusa a server action
 * `actualizarDepositoAction` JÁ EXISTENTE (intocada) e o mesmo schema do diálogo
 * da lista. Não toca cálculo/estoque/auth.
 */
const formSchema = z.object({
  nombre: z.string().trim().min(1, "El nombre es obligatorio."),
  direccion: z.string().trim().optional().or(z.literal("")),
  activo: z.enum(["si", "no"]),
  tipo: z.enum(["NACIONAL", "ZONA_PRIMARIA"]),
});

type FormValues = z.infer<typeof formSchema>;

function defaultsFromDeposito(d: DepositoRow): FormValues {
  return {
    nombre: d.nombre,
    direccion: d.direccion ?? "",
    activo: d.activo ? "si" : "no",
    tipo: d.tipo,
  };
}

export function DepositoEditWindow({ deposito }: { deposito: DepositoRow }) {
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
    mode: "onBlur",
    defaultValues: defaultsFromDeposito(deposito),
  });
  const { isDirtyRef } = useDirtyState(isDirty);

  // Reseta para os valores atuais do registro a cada abertura.
  useEffect(() => {
    if (open) reset(defaultsFromDeposito(deposito));
  }, [open, deposito, reset]);

  const onSubmit = handleSubmit((values) => {
    startSaving(async () => {
      const result = await actualizarDepositoAction(deposito.id, {
        nombre: values.nombre,
        direccion: values.direccion && values.direccion.length > 0 ? values.direccion : undefined,
        activo: values.activo === "si",
        tipo: values.tipo,
      });

      if (result.ok) {
        toast.success("Depósito actualizado.");
        reset(values);
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
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
        title={`Editar depósito · ${deposito.nombre}`}
        description="Modifique los datos del depósito y guarde los cambios."
        initialWidth={520}
        initialHeight={470}
        onRequestClose={() => (isDirtyRef.current ? requestDiscardConfirm() : true)}
        footer={
          <DirtyFooter
            isDirty={isDirty}
            isSaving={isSaving}
            onSave={() => void onSubmit()}
            onCancel={() => void handleCancel()}
            saveLabel="Guardar cambios"
            tabHref={`/maestros/depositos/${deposito.id}`}
            tabLabel={deposito.nombre}
          />
        }
      >
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="nombre">Nombre *</Label>
            <Input id="nombre" aria-invalid={!!errors.nombre} {...register("nombre")} />
            {errors.nombre && <FieldError message={errors.nombre.message} />}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="direccion">Dirección</Label>
            <Input id="direccion" {...register("direccion")} />
          </div>

          <div className="flex flex-col gap-2">
            <Label>Tipo *</Label>
            <Controller
              control={control}
              name="tipo"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NACIONAL">
                      Nacional (mercadería disponible para venta)
                    </SelectItem>
                    <SelectItem value="ZONA_PRIMARIA">
                      Zona Primaria Aduanera (pendiente de despacho)
                    </SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
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
            <DialogDescription>
              Hay cambios sin guardar en el depósito. ¿Desea descartarlos?
            </DialogDescription>
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
