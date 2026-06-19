"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { anularEntregaAction, confirmarEntregaAction } from "@/lib/actions/entregas";
import type { EntregaEstado } from "@/generated/prisma/client";

export function EntregaActions({
  entregaId,
  numero,
  estado,
}: {
  entregaId: string;
  numero: string;
  estado: EntregaEstado;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirmarOpen, setConfirmarOpen] = useState(false);
  const [anularOpen, setAnularOpen] = useState(false);

  if (estado === "ANULADA") return null;

  const onConfirmar = () =>
    start(async () => {
      const result = await confirmarEntregaAction(entregaId);
      if (result.ok) {
        toast.success(`Remito ${numero} confirmado · asiento Nº ${result.data.numeroAsiento}`);
        setConfirmarOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });

  const onAnular = () =>
    start(async () => {
      const result = await anularEntregaAction(entregaId);
      if (result.ok) {
        toast.success(
          estado === "CONFIRMADA" ? `Remito ${numero} anulado` : `Borrador ${numero} eliminado`,
        );
        setAnularOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });

  return (
    <div className="flex gap-2">
      {estado === "BORRADOR" && (
        <Button size="sm" onClick={() => setConfirmarOpen(true)} disabled={pending}>
          Confirmar
        </Button>
      )}
      <Button
        variant="destructive"
        size="sm"
        onClick={() => setAnularOpen(true)}
        disabled={pending}
      >
        {estado === "BORRADOR" ? "Borrar" : "Anular"}
      </Button>

      <Dialog
        open={confirmarOpen}
        onOpenChange={(open) => {
          if (!open && !pending) setConfirmarOpen(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar remito {numero}</DialogTitle>
            <DialogDescription>
              Genera el egreso físico de stock y el asiento contable (DEBE 1.1.7.90 / HABER
              1.1.7.01), cancelando la provisión de mercaderías a entregar. El costo se toma del
              promedio actual del depósito.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmarOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={onConfirmar} disabled={pending}>
              {pending ? "Procesando…" : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={anularOpen}
        onOpenChange={(open) => {
          if (!open && !pending) setAnularOpen(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {estado === "CONFIRMADA" ? `Anular remito ${numero}` : `Borrar borrador ${numero}`}
            </DialogTitle>
            <DialogDescription>
              {estado === "CONFIRMADA"
                ? "Revierte el egreso de stock y anula el asiento contable. La provisión de mercaderías a entregar vuelve a quedar abierta."
                : "Elimina este borrador de remito. No afecta stock ni contabilidad."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAnularOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={onAnular} disabled={pending}>
              {pending ? "Procesando…" : estado === "CONFIRMADA" ? "Anular" : "Borrar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
