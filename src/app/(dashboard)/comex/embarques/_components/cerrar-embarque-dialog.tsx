"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { CheckmarkCircle02Icon, LockIcon } from "@hugeicons/core-free-icons";

import { cerrarYContabilizarEmbarqueAction } from "@/lib/actions/embarques";
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
  embarqueId: string;
  embarqueCodigo: string;
  disabled?: boolean;
  previewTotalDebe: string;
};

export function CerrarEmbarqueDialog({
  embarqueId,
  embarqueCodigo,
  disabled,
  previewTotalDebe,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const handleConfirm = () => {
    startTransition(async () => {
      const result = await cerrarYContabilizarEmbarqueAction(embarqueId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        `Embarque ${embarqueCodigo} cerrado. Asiento #${result.asientoNumero} contabilizado.`,
      );
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button type="button" disabled={disabled}>
            <HugeiconsIcon
              icon={LockIcon}
              strokeWidth={2}
              className="size-4"
            />
            Cerrar y Contabilizar
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cerrar embarque {embarqueCodigo}</DialogTitle>
          <DialogDescription>
            Esta acción generará un <strong>asiento contable de nacionalización</strong>{" "}
            en estado CONTABILIZADO y transicionará el embarque a{" "}
            <strong>CERRADO</strong>. No podrá editarse después.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border bg-muted/40 p-4 text-sm">
          <p className="font-medium">Resumen del asiento:</p>
          <ul className="mt-2 space-y-1 text-muted-foreground">
            <li>
              <span className="inline-block w-24 font-mono">DEBE</span>
              Mercaderías en tránsito (FOB) + cuentas de gasto + créditos
              fiscales (IVA, IIBB importación) + tributos aduaneros
            </li>
            <li>
              <span className="inline-block w-24 font-mono">HABER</span>
              Proveedor exterior + 1 línea por proveedor logístico (flete,
              despachante, operador, etc.) + Aduana (DIE, tasa, arancel, IVA
              importación, IIBB, Ganancias)
            </li>
            <li className="pt-2 font-medium text-foreground">
              Total: {previewTotalDebe}
            </li>
          </ul>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Cancelar
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={pending}>
            <HugeiconsIcon
              icon={CheckmarkCircle02Icon}
              strokeWidth={2}
              className="size-4"
            />
            {pending ? "Contabilizando…" : "Confirmar cierre"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type AsientoLinkProps = {
  asiento: { id: string; numero: number; estado: string };
};

export function AsientoEmbarqueLink({ asiento }: AsientoLinkProps) {
  return (
    <Link
      href={`/contabilidad/asientos/${asiento.id}`}
      className="font-medium text-amber-900 underline underline-offset-2 dark:text-amber-200"
    >
      Asiento #{asiento.numero} ({asiento.estado})
    </Link>
  );
}
