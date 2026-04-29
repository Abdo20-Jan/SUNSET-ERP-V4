"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { anularAsientoAction } from "@/lib/actions/asientos";
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

export function AnularAsientoButton({
  asientoId,
  asientoNumero,
}: {
  asientoId: string;
  asientoNumero: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const handle = () => {
    startTransition(async () => {
      const r = await anularAsientoAction(asientoId);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`Asiento Nº ${asientoNumero} anulado.`);
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button type="button" variant="destructive" size="sm">
            Anular asiento
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Anular asiento Nº {asientoNumero}</DialogTitle>
          <DialogDescription>
            El asiento queda en estado <strong>ANULADO</strong> (queda en la
            historia contable). El movimiento de tesorería se desvincula —
            podés volver a registrarlo si fue un error.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Cancelar
          </Button>
          <Button variant="destructive" onClick={handle} disabled={pending}>
            {pending ? "Anulando…" : "Sí, anular"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
