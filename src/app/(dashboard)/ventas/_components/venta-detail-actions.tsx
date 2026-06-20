"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { CancelCircleIcon } from "@hugeicons/core-free-icons";

import { anularVentaAction } from "@/lib/actions/ventas";
import { MonedaToggle, type Moneda } from "../../reportes/_components/moneda-toggle";
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
  ventaId: string;
  numero: string;
  moneda: Moneda;
  tcInfo: { valor: string; fecha: string; fuente: string | null } | null;
  puedeAnular: boolean;
};

// Acciones interactivas del header del detalle de venta: toggle de moneda y
// anulación. Las únicas partes que necesitan ser client; el resto del detalle
// es presentacional (server). El botón "Entregas" se movió a una tab.
export function VentaDetailActions({ ventaId, numero, moneda, tcInfo, puedeAnular }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleAnular = () => {
    startTransition(async () => {
      const result = await anularVentaAction(ventaId);
      if (result.ok) {
        toast.success("Venta anulada.");
        setConfirmOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <>
      <MonedaToggle current={moneda} tcInfo={tcInfo} />
      {puedeAnular && (
        <Button variant="destructive" onClick={() => setConfirmOpen(true)} disabled={isPending}>
          <HugeiconsIcon icon={CancelCircleIcon} strokeWidth={2} />
          Anular
        </Button>
      )}

      <Dialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!open && !isPending) setConfirmOpen(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Anular venta {numero}</DialogTitle>
            <DialogDescription>
              Esta acción genera un asiento de reverso, marca la venta como CANCELADA y desvincula
              el asiento original. El número de venta se mantiene para auditoría.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={isPending}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleAnular} disabled={isPending}>
              {isPending ? "Procesando…" : "Anular"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
