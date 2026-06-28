"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { Edit02Icon } from "@hugeicons/core-free-icons";

import type { EmbarqueDetalle } from "@/lib/actions/embarques";
import type { ContenedorPackingDTO } from "@/lib/services/contenedor";
import type { ProveedorOption } from "@/components/proveedor-combobox";
import type { ProductoOption } from "@/components/producto-combobox";
import type { CuentaOption } from "@/components/cuenta-combobox";
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

import { EmbarqueForm, type DepositoOption } from "../../_components/embarque-form";

/*
 * EmbarqueEditWindow (PR-021, CX-03) — ilha client que abre la edición/operación
 * de un embarque dentro de una FloatingWorkWindow (G-04: sin drawer/full-page para
 * form de negócio), maximizada por defecto para darle a la grade de ítems/costos el
 * alto que pide el form de 2215 líneas. HOSPEDA el `EmbarqueForm` existente
 * `embedded` SIN reescribir su grid ni su cálculo: el form conserva su footer rico
 * (FOB/costo total + diálogos Zona Primaria / Cerrar y Contabilizar, intactos). El
 * gate de descarte (useDirtyState + confirmación) vive en la ventana; las actions
 * (guardar/ZP/cierre) son las del propio form/diálogos, byte-idénticas.
 *
 * En CERRADO (`readonly`) la ventana abre el form en sólo-lectura ("Ver detalle"):
 * sin submit ni transiciones, preservando el acceso de lectura del antiguo
 * full-page. El motor de rateio NO se invoca desde acá — sólo a través del form.
 */
type Props = {
  embarque: EmbarqueDetalle;
  proveedores: ProveedorOption[];
  productos: ProductoOption[];
  depositos: DepositoOption[];
  cuentasGasto: CuentaOption[];
  contenedorEnabled: boolean;
  contenedores: ContenedorPackingDTO[];
  readonly: boolean;
  defaultFecha?: string;
};

export function EmbarqueEditWindow({
  embarque,
  proveedores,
  productos,
  depositos,
  cuentasGasto,
  contenedorEnabled,
  contenedores,
  readonly,
  defaultFecha,
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

  const label = readonly ? "Ver detalle" : "Editar embarque";

  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        <HugeiconsIcon icon={Edit02Icon} strokeWidth={2} />
        {label}
      </Button>

      <FloatingWorkWindow
        open={open}
        onOpenChange={setOpen}
        title={`${label} · ${embarque.codigo}`}
        description={
          readonly
            ? "Embarque CERRADO — sólo lectura."
            : "Edite datos, ítems, costos logísticos y tributos; confirme zona primaria o cierre desde el pie."
        }
        initialWidth={1200}
        initialHeight={800}
        defaultMaximized
        onRequestClose={() => (isDirtyRef.current ? requestDiscardConfirm() : true)}
      >
        <EmbarqueForm
          mode="edit"
          embedded
          initialData={embarque}
          readonly={readonly}
          proveedores={proveedores}
          productos={productos}
          depositos={depositos}
          cuentasGasto={cuentasGasto}
          contenedorEnabled={contenedorEnabled}
          contenedores={contenedores}
          defaultFecha={defaultFecha}
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
              Hay cambios sin guardar en el embarque. ¿Desea descartarlos?
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
