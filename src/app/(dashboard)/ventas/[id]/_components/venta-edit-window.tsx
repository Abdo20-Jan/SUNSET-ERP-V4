"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { Edit02Icon } from "@hugeicons/core-free-icons";

import type {
  ClienteParaVenta,
  DepositoParaVenta,
  ProductoParaVenta,
  VentaDetalle,
} from "@/lib/actions/ventas";
import type { ProveedorParaGasto } from "@/lib/actions/gastos";
import type { TipoAprobacion } from "@/generated/prisma/enums";
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
import { VentaForm } from "../../_components/venta-form";

/*
 * VentaEditWindow (PR-018) — ilha client que abre la edición de una venta en
 * BORRADOR dentro de una FloatingWorkWindow (G-04: sin drawer/full-page para form
 * de negócio), maximizable por defecto para darle a la grade Excel el alto que
 * pide COM-02. HOSPEDA el `VentaForm` existente `embedded` SIN reescribir su grade
 * ni su cálculo: el form conserva su footer rico (totales + margen live, exigido
 * por COM-02) en vez del DirtyFooter genérico. El gate de descarte (useDirtyState
 * + confirmación) vive en la ventana; las actions (guardar/emitir) son las del
 * propio form, intactas.
 */
type Props = {
  venta: VentaDetalle;
  clientes: ClienteParaVenta[];
  productos: ProductoParaVenta[];
  depositos: DepositoParaVenta[];
  proveedores: ProveedorParaGasto[];
  approvalsEnabled: boolean;
  tipoMargenRequerido: TipoAprobacion | null;
};

export function VentaEditWindow({
  venta,
  clientes,
  productos,
  depositos,
  proveedores,
  approvalsEnabled,
  tipoMargenRequerido,
}: Props) {
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
        title={`Editar venta · ${venta.numero}`}
        description="Modifique la venta en BORRADOR. Al emitir se genera el asiento contable."
        initialWidth={1100}
        initialHeight={760}
        defaultMaximized
        onRequestClose={() => (isDirtyRef.current ? requestDiscardConfirm() : true)}
      >
        <VentaForm
          mode="edit"
          embedded
          initialData={venta}
          clientes={clientes}
          productos={productos}
          depositos={depositos}
          proveedores={proveedores}
          approvalsEnabled={approvalsEnabled}
          tipoMargenRequerido={tipoMargenRequerido}
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
              Hay cambios sin guardar en la venta. ¿Desea descartarlos?
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
