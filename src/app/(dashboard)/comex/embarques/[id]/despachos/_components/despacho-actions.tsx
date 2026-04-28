"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  anularDespachoAction,
  contabilizarDespachoAction,
  eliminarDespachoAction,
} from "@/lib/actions/despachos";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type Props = {
  despachoId: string;
  estado: "BORRADOR" | "CONTABILIZADO" | "ANULADO";
  codigo: string;
};

export function DespachoActions({ despachoId, estado, codigo }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState<
    "anular" | "eliminar" | "contabilizar" | null
  >(null);

  if (estado === "ANULADO") {
    return <span className="text-[12px] text-muted-foreground">—</span>;
  }

  const onContabilizar = () =>
    startTransition(async () => {
      const r = await contabilizarDespachoAction(despachoId);
      if (!r.ok) toast.error(r.error);
      else {
        toast.success(`Despacho ${codigo} contabilizado (asiento #${r.asientoNumero}).`);
        setConfirmOpen(null);
        router.refresh();
      }
    });

  const onAnular = () =>
    startTransition(async () => {
      const r = await anularDespachoAction(despachoId);
      if (!r.ok) toast.error(r.error);
      else {
        toast.success(`Despacho ${codigo} anulado.`);
        setConfirmOpen(null);
        router.refresh();
      }
    });

  const onEliminar = () =>
    startTransition(async () => {
      const r = await eliminarDespachoAction(despachoId);
      if (!r.ok) toast.error(r.error);
      else {
        toast.success(`Despacho ${codigo} eliminado.`);
        setConfirmOpen(null);
        router.refresh();
      }
    });

  return (
    <div className="flex justify-end gap-1.5">
      {estado === "BORRADOR" && (
        <>
          <Dialog
            open={confirmOpen === "contabilizar"}
            onOpenChange={(o) => setConfirmOpen(o ? "contabilizar" : null)}
          >
            <DialogTrigger
              render={
                <Button size="sm" type="button">
                  Contabilizar
                </Button>
              }
            />
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Contabilizar {codigo}</DialogTitle>
                <DialogDescription>
                  Genera el asiento + ingresa stock al depósito destino. Se
                  puede anular después si fuera necesario.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setConfirmOpen(null)}
                  disabled={pending}
                >
                  Cancelar
                </Button>
                <Button onClick={onContabilizar} disabled={pending}>
                  {pending ? "Contabilizando…" : "Confirmar"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog
            open={confirmOpen === "eliminar"}
            onOpenChange={(o) => setConfirmOpen(o ? "eliminar" : null)}
          >
            <DialogTrigger
              render={
                <Button size="sm" type="button" variant="ghost">
                  Eliminar
                </Button>
              }
            />
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Eliminar {codigo}</DialogTitle>
                <DialogDescription>
                  Borra el despacho BORRADOR y libera las facturas linkadas. No
                  hay asiento contable involucrado.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setConfirmOpen(null)}
                  disabled={pending}
                >
                  Cancelar
                </Button>
                <Button
                  variant="destructive"
                  onClick={onEliminar}
                  disabled={pending}
                >
                  {pending ? "Eliminando…" : "Sí, eliminar"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}

      {estado === "CONTABILIZADO" && (
        <Dialog
          open={confirmOpen === "anular"}
          onOpenChange={(o) => setConfirmOpen(o ? "anular" : null)}
        >
          <DialogTrigger
            render={
              <Button size="sm" type="button" variant="outline">
                Anular
              </Button>
            }
          />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Anular {codigo}</DialogTitle>
              <DialogDescription>
                Anula el asiento, revierte el ingreso de stock + recalcula
                costo promedio del producto, y libera las facturas linkadas.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setConfirmOpen(null)}
                disabled={pending}
              >
                Cancelar
              </Button>
              <Button
                variant="destructive"
                onClick={onAnular}
                disabled={pending}
              >
                {pending ? "Anulando…" : "Sí, anular"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
