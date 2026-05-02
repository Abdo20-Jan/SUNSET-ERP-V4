"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowReloadHorizontalIcon,
  CheckmarkCircle02Icon,
  LockIcon,
} from "@hugeicons/core-free-icons";

import {
  cerrarYContabilizarEmbarqueAction,
  confirmarZonaPrimariaAction,
  revertirZonaPrimariaAction,
} from "@/lib/actions/embarques";
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

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function CerrarEmbarqueDialog({
  embarqueId,
  embarqueCodigo,
  disabled,
  previewTotalDebe,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [fecha, setFecha] = useState<string>(todayIso);

  const handleConfirm = () => {
    if (!fecha) {
      toast.error("Ingresá la fecha de cierre.");
      return;
    }
    startTransition(async () => {
      const result = await cerrarYContabilizarEmbarqueAction(embarqueId, fecha);
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

        <div className="space-y-1">
          <label htmlFor="fecha-cierre" className="text-sm font-medium">
            Fecha de cierre / nacionalización
          </label>
          <input
            id="fecha-cierre"
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            max={todayIso()}
            disabled={pending}
            className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <p className="text-xs text-muted-foreground">
            Fecha contable del asiento (la del despacho a plaza, no la del clic).
          </p>
        </div>

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

type RevertirZPProps = {
  embarqueId: string;
  embarqueCodigo: string;
  asientoZpNumero: number;
  disabled?: boolean;
};

export function RevertirZonaPrimariaDialog({
  embarqueId,
  embarqueCodigo,
  asientoZpNumero,
  disabled,
}: RevertirZPProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const handleConfirm = () => {
    startTransition(async () => {
      const result = await revertirZonaPrimariaAction(embarqueId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        `Zona primaria de ${embarqueCodigo} revertida. Asiento #${asientoZpNumero} anulado.`,
      );
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button type="button" variant="outline" disabled={disabled}>
            <HugeiconsIcon
              icon={ArrowReloadHorizontalIcon}
              strokeWidth={2}
              className="size-4"
            />
            Revertir zona primaria
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revertir zona primaria — {embarqueCodigo}</DialogTitle>
          <DialogDescription>
            Anula el asiento #{asientoZpNumero} de zona primaria y deja el
            embarque editable nuevamente. Útil si detectaste un error en una
            factura ZP o en el FOB. <strong>No</strong> afecta stock — en zona
            primaria no se generan movimientos de stock.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-amber-300/60 bg-amber-50/60 p-3 text-[13px] dark:border-amber-700/50 dark:bg-amber-950/20">
          <p className="text-amber-900 dark:text-amber-200">
            Sólo permitido si el embarque <strong>no</strong> tiene cierre
            contabilizado. Si ya cerraste, anulá primero el asiento de cierre.
          </p>
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
          <Button
            type="button"
            variant="destructive"
            onClick={handleConfirm}
            disabled={pending}
          >
            {pending ? "Revirtiendo…" : "Sí, revertir"}
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

// ---------- Confirmar Zona Primaria ----------
//
// Genera asiento parcial: FOB (+ flete/seguro origen) + facturas con
// momento === ZONA_PRIMARIA. La mercadería NO se nacionaliza acá; queda
// en 1.1.5.02 sin disponibilidad de stock hasta el despacho final.

type ZPProps = {
  embarqueId: string;
  embarqueCodigo: string;
  disabled?: boolean;
  totalProveedorExterior: string; // FOB + flete/seguro origen, en ARS
  cantFacturasZP: number;
};

export function ConfirmarZonaPrimariaDialog({
  embarqueId,
  embarqueCodigo,
  disabled,
  totalProveedorExterior,
  cantFacturasZP,
}: ZPProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [fecha, setFecha] = useState<string>(todayIso);

  const handleConfirm = () => {
    if (!fecha) {
      toast.error("Ingresá la fecha de zona primaria.");
      return;
    }
    startTransition(async () => {
      const result = await confirmarZonaPrimariaAction(embarqueId, fecha);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        `Zona primaria de ${embarqueCodigo} confirmada. Asiento #${result.asientoNumero} contabilizado.`,
      );
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button type="button" variant="secondary" disabled={disabled}>
            Confirmar zona primaria
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Confirmar zona primaria — {embarqueCodigo}
          </DialogTitle>
          <DialogDescription>
            Genera el asiento de la mercadería en{" "}
            <strong>1.1.5.02 Mercaderías en Tránsito</strong> (FOB + facturas
            de zona primaria). La mercadería <strong>NO</strong> queda
            disponible para venta — eso requiere el despacho final.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1">
          <label htmlFor="fecha-zp" className="text-sm font-medium">
            Fecha de zona primaria
          </label>
          <input
            id="fecha-zp"
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            max={todayIso()}
            disabled={pending}
            className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <p className="text-xs text-muted-foreground">
            Fecha contable del asiento (la del ingreso a zona primaria).
          </p>
        </div>

        <div className="rounded-md border bg-muted/40 p-4 text-[13px]">
          <p className="font-medium">Asiento parcial:</p>
          <ul className="mt-2 space-y-1 text-muted-foreground">
            <li>
              <span className="inline-block w-24 font-mono">DEBE</span>
              1.1.5.02 Mercaderías en tránsito (FOB ARS{" "}
              {totalProveedorExterior})
            </li>
            <li>
              <span className="inline-block w-24 font-mono">HABER</span>
              Proveedor exterior + {cantFacturasZP} factura
              {cantFacturasZP === 1 ? "" : "s"} de zona primaria
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
            {pending ? "Contabilizando…" : "Confirmar zona primaria"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
