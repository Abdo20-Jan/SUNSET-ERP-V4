"use client";

import type { ProductoGridRow } from "@/lib/actions/productos";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Props = {
  producto: ProductoGridRow | null;
  isDeleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function EliminarProductoDialog({ producto, isDeleting, onConfirm, onCancel }: Props) {
  return (
    <Dialog
      open={producto !== null}
      onOpenChange={(open) => {
        if (!open && !isDeleting) onCancel();
      }}
    >
      <DialogContent>
        {producto && (
          <>
            <DialogHeader>
              <DialogTitle>Eliminar producto</DialogTitle>
              <DialogDescription>
                ¿Confirma eliminar el producto{" "}
                <span className="font-mono text-foreground">{producto.codigo}</span>
                {" — "}
                <span className="font-medium text-foreground">{producto.nombre}</span>? Si tiene
                embarques, compras, ventas o movimientos de stock asociados se marcará como inactivo
                en su lugar.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={onCancel} disabled={isDeleting}>
                Cancelar
              </Button>
              <Button variant="destructive" onClick={onConfirm} disabled={isDeleting}>
                {isDeleting ? "Eliminando…" : "Eliminar"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
