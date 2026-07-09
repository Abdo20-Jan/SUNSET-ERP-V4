"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { Edit02Icon } from "@hugeicons/core-free-icons";

import type { PedidoCompraDetalle } from "@/lib/actions/pedidos-compra";
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
  PedidoCompraForm,
  type ProductoOpt,
  type ProveedorOpt,
} from "../../_components/pedido-compra-form";

/*
 * PedidoCompraEditWindow (PR-029) — ilha client que abre la edición de una OC en
 * BORRADOR/ENVIADO dentro de una FloatingWorkWindow (G-04: sin drawer/full-page para
 * form de negócio), maximizable por defecto. HOSPEDA el `PedidoCompraForm` existente
 * `embedded` SIN reescribir su grade ni su cálculo. El gate de descarte
 * (useDirtyState + confirmación) vive en la ventana; la action
 * (`guardarPedidoCompraAction`) es la del propio form, intacta. Espejo exacto de
 * `pedido-edit-window.tsx` (PR-019).
 */
type Props = {
  pedido: PedidoCompraDetalle;
  proveedores: ProveedorOpt[];
  productos: ProductoOpt[];
};

export function PedidoCompraEditWindow({ pedido, proveedores, productos }: Props) {
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
        title={`Editar pedido · ${pedido.numero}`}
        description="Modifique el pedido en BORRADOR o ENVIADO. La factura se crea después desde el pedido."
        initialWidth={1100}
        initialHeight={760}
        defaultMaximized
        onRequestClose={() => (isDirtyRef.current ? requestDiscardConfirm() : true)}
      >
        <PedidoCompraForm
          mode="edit"
          embedded
          initialData={pedido}
          proveedores={proveedores}
          productos={productos}
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
              Hay cambios sin guardar en el pedido. ¿Desea descartarlos?
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
