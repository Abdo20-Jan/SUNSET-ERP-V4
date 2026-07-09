"use client";

/*
 * LeadEditWindow (CRM-01 · PR-030) — ilha client que abre la edición del lead
 * dentro de una FloatingWorkWindow (G-04: sin full-page para form de negocio).
 * HOSPEDA el `LeadForm` existente `embedded` SIN reescribir sus campos ni su
 * payload (`crearLeadAction`/`editarLeadAction` intactas). El gate de descarte
 * (useDirtyState + confirmación) vive en la ventana. Espejo exacto de
 * `pedido-compra-edit-window.tsx` (PR-029). Al guardar NO navega: cierra y
 * refresca el record.
 */

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { Edit02Icon } from "@hugeicons/core-free-icons";

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
import type { LeadInput } from "@/lib/actions/leads";

import { LeadForm } from "../../_components/lead-form";

type Props = {
  leadId: string;
  initial: Partial<LeadInput>;
};

export function LeadEditWindow({ leadId, initial }: Props) {
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
        title="Editar lead"
        description="Modifique los datos del lead. El score se recalcula al guardar."
        initialWidth={720}
        initialHeight={640}
        onRequestClose={() => (isDirtyRef.current ? requestDiscardConfirm() : true)}
      >
        <LeadForm
          mode="edit"
          leadId={leadId}
          initial={initial}
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
              Hay cambios sin guardar en el lead. ¿Desea descartarlos?
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
