"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, Alert02Icon } from "@hugeicons/core-free-icons";

import {
  crearCuentaBancariaAction,
  type CuentaContableOption,
} from "@/lib/actions/cuentas-bancarias";
import type { Moneda, TipoCuentaBancaria } from "@/generated/prisma/client";
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
 * NuevaCuentaWorkWindow (TES-01 · PR-025a) — migra el drawer lateral
 * `nueva-cuenta-sheet.tsx` a FloatingWorkWindow (G-04: sin drawer para form de
 * negócio). SÓLO cambia el contenedor: el form (schema Zod, campos, defaults) y
 * la action `crearCuentaBancariaAction` con su payload son byte-idénticos al
 * drawer. El gate de descarte (useDirtyState + confirmación) vive en la ventana;
 * el DirtyFooter dispara el submit del form.
 */

const formSchema = z.object({
  banco: z.string().min(1, "El banco/caja es obligatorio"),
  tipo: z.enum(["CUENTA_CORRIENTE", "CAJA_AHORRO", "CAJA_CHICA"]),
  moneda: z.enum(["ARS", "USD"]),
  numero: z.string().optional(),
  cbu: z.string().optional(),
  alias: z.string().optional(),
  cuentaContableId: z.number().int().positive().nullable(),
  crearCuentaAuto: z.boolean(),
});

type FormValues = z.infer<typeof formSchema>;

const TIPO_OPTIONS: { value: TipoCuentaBancaria; label: string }[] = [
  { value: "CUENTA_CORRIENTE", label: "Cuenta Corriente" },
  { value: "CAJA_AHORRO", label: "Caja de Ahorro" },
  { value: "CAJA_CHICA", label: "Caja Chica" },
];

export function NuevaCuentaButton({
  cuentasContables,
}: {
  cuentasContables: CuentaContableOption[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm">
        <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
        Nueva cuenta
      </Button>
      <NuevaCuentaWorkWindow
        open={open}
        onOpenChange={setOpen}
        cuentasContables={cuentasContables}
      />
    </>
  );
}

function NuevaCuentaWorkWindow({
  open,
  onOpenChange,
  cuentasContables,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cuentasContables: CuentaContableOption[];
}) {
  const router = useRouter();
  const [isSubmitting, startTransition] = useTransition();
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
    defaultValues: {
      banco: "",
      tipo: "CUENTA_CORRIENTE",
      moneda: "ARS",
      numero: "",
      cbu: "",
      alias: "",
      cuentaContableId: null,
      crearCuentaAuto: true,
    },
  });

  const { isDirtyRef } = useDirtyState(isDirty);

  const tipo = useWatch({ control, name: "tipo" });
  const moneda = useWatch({ control, name: "moneda" });
  const crearCuentaAuto = useWatch({ control, name: "crearCuentaAuto" });

  const closeAndReset = () => {
    reset();
    onOpenChange(false);
  };

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      // Payload byte-idéntico al drawer `nueva-cuenta-sheet.tsx`.
      const result = await crearCuentaBancariaAction({
        banco: values.banco,
        tipo: values.tipo,
        moneda: values.moneda,
        numero: values.numero,
        cbu: values.cbu,
        alias: values.alias,
        cuentaContableId: values.crearCuentaAuto ? null : values.cuentaContableId,
      });

      if (result.ok) {
        toast.success("Cuenta bancaria creada.");
        closeAndReset();
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
      closeAndReset();
      return;
    }
    if (await requestDiscardConfirm()) closeAndReset();
  };

  return (
    <>
      <FloatingWorkWindow
        open={open}
        onOpenChange={onOpenChange}
        title="Nueva cuenta bancaria"
        description="Registre una cuenta bancaria vinculada a una cuenta contable analítica de activo."
        initialWidth={560}
        initialHeight={620}
        onRequestClose={() => (isDirtyRef.current ? requestDiscardConfirm() : true)}
        footer={
          <DirtyFooter
            isDirty={isDirty}
            isSaving={isSubmitting}
            onSave={() => void onSubmit()}
            onCancel={() => void handleCancel()}
            saveLabel="Crear cuenta"
          />
        }
      >
        <form onSubmit={onSubmit} className="flex flex-col gap-4 p-6">
          <div className="flex flex-col gap-2">
            <Label htmlFor="banco">{tipo === "CAJA_CHICA" ? "Caja" : "Banco"}</Label>
            <Input
              id="banco"
              placeholder={
                tipo === "CAJA_CHICA" ? "Ej: Caja Abdo, Caja Principal" : "Banco Santander"
              }
              aria-invalid={!!errors.banco}
              {...register("banco")}
            />
            {errors.banco && <FieldError message={errors.banco.message} />}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="tipo">Tipo</Label>
              <Controller
                control={control}
                name="tipo"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={(v) => field.onChange(v as TipoCuentaBancaria)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIPO_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="moneda">Moneda</Label>
              <Controller
                control={control}
                name="moneda"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={(v) => field.onChange(v as Moneda)}>
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
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="numero">Número (opcional)</Label>
            <Input
              id="numero"
              placeholder="0000-0000-0000-0000"
              aria-invalid={!!errors.numero}
              {...register("numero")}
            />
            {errors.numero && <FieldError message={errors.numero.message} />}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="cbu">CBU (opcional)</Label>
              <Input id="cbu" placeholder="22 dígitos" {...register("cbu")} />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="alias">Alias (opcional)</Label>
              <Input id="alias" placeholder="MI.ALIAS" {...register("alias")} />
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-md border bg-muted/20 p-3">
            <Label className="text-sm">Cuenta contable</Label>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" {...register("crearCuentaAuto")} />
              <span>
                <span className="font-medium">Crear automáticamente</span> una cuenta analítica
                <span className="ml-1 text-xs text-muted-foreground">
                  (sugerido — código en {tipo === "CAJA_CHICA" ? "1.1.1.10–99" : "1.1.2.10–99"};
                  nombre: <span className="font-mono">«banco/caja» {moneda}</span>)
                </span>
              </span>
            </label>
            {!crearCuentaAuto && (
              <Controller
                control={control}
                name="cuentaContableId"
                render={({ field }) => (
                  <CuentaCombobox
                    value={field.value}
                    onChange={field.onChange}
                    cuentas={cuentasContables}
                  />
                )}
              />
            )}
            <p className="text-xs text-muted-foreground">
              Si elige &quot;Crear automáticamente&quot;, el sistema asigna el próximo código
              disponible al guardar.
            </p>
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
              Hay datos sin guardar en la nueva cuenta. ¿Desea descartarlos?
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

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="mt-1 flex items-center gap-1 text-xs text-destructive">
      <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} className="size-3" />
      {message}
    </p>
  );
}
