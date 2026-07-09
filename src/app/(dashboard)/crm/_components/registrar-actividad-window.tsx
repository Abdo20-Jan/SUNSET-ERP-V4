"use client";

/**
 * RegistrarActividadWindow (CRM-01 · PR-030) — PRIMER consumidor UI de
 * `crearActividadAction` (la action existía sin superficie). Botón que abre
 * una FloatingWorkWindow pequeña (G-04: sin drawer/full-page para form de
 * negocio) con el mini-form de actividad (tipo + contenido + fecha
 * programada opcional) apuntando a UN target polimórfico (lead | cliente |
 * oportunidad). COMPARTIDO entre los records de leads y oportunidades.
 *
 * El gate de descarte (useDirtyState + Dialog de confirmación) espeja
 * `pedido-compra-edit-window.tsx` (PR-029). La action queda intacta: el
 * payload es `{tipo, contenido, fechaProgramada?, ...target}`.
 */

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon } from "@hugeicons/core-free-icons";

import { FloatingWorkWindow } from "@/components/record/floating-work-window";
import { useDirtyState } from "@/components/record/use-dirty-state";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ActividadTipo } from "@/generated/prisma/client";
import { crearActividadAction } from "@/lib/actions/actividades";
import { ACTIVIDAD_TIPOS } from "@/lib/crm-enums";

type Target = { leadId?: string; clienteId?: string; oportunidadId?: string };

// El input del schema (z.coerce.date) tipa `Date` — convertimos el valor del
// `datetime-local` acá (la coerción server es entonces un no-op idéntico).
function parseFechaProgramada(valor: string): Date | undefined {
  if (!valor) return undefined;
  return new Date(valor);
}

function ActividadForm({
  pending,
  error,
  onSubmit,
  onCancel,
  onDirty,
}: {
  pending: boolean;
  error: string | null;
  onSubmit: (fd: FormData) => void;
  onCancel: () => void;
  onDirty: () => void;
}) {
  return (
    <form action={onSubmit} onChange={onDirty} className="flex h-full flex-col gap-4 p-1">
      <label className="flex flex-col gap-1 text-sm">
        <span>Tipo</span>
        <select name="tipo" defaultValue="NOTA" className="rounded-md border px-3 py-2">
          {ACTIVIDAD_TIPOS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span>
          Contenido<span className="text-red-700"> *</span>
        </span>
        <textarea name="contenido" required rows={5} className="rounded-md border px-3 py-2" />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span>Fecha programada (opcional)</span>
        <input
          type="datetime-local"
          name="fechaProgramada"
          className="rounded-md border px-3 py-2"
        />
      </label>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <div className="mt-auto flex justify-end gap-2 border-t pt-3">
        <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : "Registrar"}
        </Button>
      </div>
    </form>
  );
}

// Assinatura CONTRATUAL compartilhada (leads + oportunidades):
// `{ target: { leadId?; clienteId?; oportunidadId? }; triggerLabel? }`.
export function RegistrarActividadWindow({
  target,
  triggerLabel,
}: {
  target: Target;
  triggerLabel?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const { isDirtyRef } = useDirtyState(dirty);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const confirmResolverRef = useRef<((ok: boolean) => void) | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

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
    if (await requestDiscardConfirm()) {
      setDirty(false);
      setOpen(false);
    }
  };

  const handleSubmit = (fd: FormData) => {
    const tipo = String(fd.get("tipo") ?? "") as ActividadTipo;
    const contenido = String(fd.get("contenido") ?? "");
    const fechaProgramada = parseFechaProgramada(String(fd.get("fechaProgramada") ?? ""));
    setError(null);
    start(async () => {
      const r = await crearActividadAction({ tipo, contenido, fechaProgramada, ...target });
      if (!r.ok) {
        setError(r.error);
        toast.error(r.error);
        return;
      }
      toast.success("Actividad registrada.");
      setDirty(false);
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
        {triggerLabel ?? "Registrar actividad"}
      </Button>

      <FloatingWorkWindow
        open={open}
        onOpenChange={setOpen}
        title="Registrar actividad"
        description="Llamada, email, reunión, nota, tarea o WhatsApp asociado a este registro."
        initialWidth={560}
        initialHeight={520}
        onRequestClose={() => (isDirtyRef.current ? requestDiscardConfirm() : true)}
      >
        <ActividadForm
          pending={pending}
          error={error}
          onSubmit={handleSubmit}
          onCancel={() => void handleCancel()}
          onDirty={() => setDirty(true)}
        />
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
              Hay una actividad sin guardar. ¿Desea descartarla?
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
