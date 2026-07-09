"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { Edit02Icon } from "@hugeicons/core-free-icons";

import type { OportunidadInput } from "@/lib/actions/oportunidades";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FloatingWorkWindow } from "@/components/record/floating-work-window";
import { useDirtyState } from "@/components/record/use-dirty-state";
import {
  type ClienteOption,
  type LeadOption,
  OportunidadForm,
  type StageOption,
} from "../../_components/oportunidad-form";

/*
 * OportunidadEditWindow (CRM-01 · PR-030) — ilha client que abre la edición de
 * una oportunidad dentro de una FloatingWorkWindow (G-04: sin drawer/full-page
 * para form de negocio). HOSPEDA el `OportunidadForm` existente `embedded` SIN
 * reescribir su grade; la action (`editarOportunidadAction`) es la del propio
 * form, intacta (1º consumidor UI de esa action). El gate de descarte
 * (useDirtyState + confirmación) vive en la ventana. Espejo exacto de
 * `pedido-compra-edit-window.tsx` (PR-029).
 */
type Props = {
  opId: string;
  numero: string;
  initial: Partial<OportunidadInput>;
  stages: StageOption[];
  leads: LeadOption[];
  clientes: ClienteOption[];
};

export function OportunidadEditWindow({ opId, numero, initial, stages, leads, clientes }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const { isDirtyRef } = useDirtyState(dirty);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const confirmResolverRef = useRef<((ok: boolean) => void) | null>(null);

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

  const handleSuccess = () => {
    setDirty(false);
    setOpen(false);
    router.refresh();
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

  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        <HugeiconsIcon icon={Edit02Icon} strokeWidth={2} />
        Editar
      </Button>

      <FloatingWorkWindow
        open={open}
        onOpenChange={setOpen}
        title={`Editar oportunidad · ${numero}`}
        description="Modifique título, monto, stage, vínculo o notas de la oportunidad."
        initialWidth={720}
        initialHeight={680}
        onRequestClose={() => (isDirtyRef.current ? requestDiscardConfirm() : true)}
      >
        <OportunidadForm
          mode="edit"
          opId={opId}
          initial={initial}
          stages={stages}
          leads={leads}
          clientes={clientes}
          embedded
          onCancel={() => void handleCancel()}
          onSuccess={handleSuccess}
          onDirtyChange={setDirty}
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
              Hay cambios sin guardar en la oportunidad. ¿Desea descartarlos?
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
