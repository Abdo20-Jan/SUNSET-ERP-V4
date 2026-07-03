"use client";

/**
 * Acciones del record de asiento (CONT-01 · PR-028, PAGE-STD-02). Hospeda las
 * actions EXISTENTES con payload byte-idéntico a la worklist legada
 * (`contabilizarAsientoAction(id)` / `anularAsientoAction(id)` — Dialog de
 * confirmación VERBATIM de `asientos-table.tsx`) + "Más acciones" → link al
 * flujo mover-periodo (intocado).
 *
 * Reflejo FE de claves EXISTENTES (deshabilitado + hint, layout estable —
 * precedente PermissionGate): `ASIENTOS_ANULAR` en Anular, `ASIENTOS_MOVER`
 * en el item de mover. Con RBAC OFF el snapshot es undefined ⇒ todo permitido
 * (cero regresión); el control real sigue siendo `requireAdmin` en el BE.
 * Contabilizar no tiene clave en el catálogo ⇒ sin máscara (auth-only, igual
 * que el BE).
 */

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeftRightIcon,
  CancelCircleIcon,
  CheckmarkCircle02Icon,
  MoreHorizontalCircle01Icon,
} from "@hugeicons/core-free-icons";

import { anularAsientoAction, contabilizarAsientoAction } from "@/lib/actions/asientos";
import { PERMISOS } from "@/lib/permisos-catalog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PermissionGate } from "@/components/auth/permission-gate";
import { useHasPermission } from "@/components/auth/permissions-provider";

import { puedeAnular, puedeContabilizar } from "../asientos-presentacion";

type AsientoResumen = {
  id: string;
  numero: number;
  descripcion: string;
  /** ISO — serializable desde el RSC. */
  fecha: string;
  estado: string;
};

type PendingAction = "contabilizar" | "anular" | null;

export function AsientoRecordActions({
  asiento,
  periodoId,
}: {
  asiento: AsientoResumen;
  periodoId: number;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<PendingAction>(null);
  const [isSubmitting, startTransition] = useTransition();
  const puedeMoverFe = useHasPermission(PERMISOS.ASIENTOS_MOVER);

  // Confirmación VERBATIM de la worklist legada: misma action, mismo payload
  // (`asiento.id`), mismos textos; al éxito el record se refresca (estado
  // resultante idéntico al flujo de la tabla).
  const onConfirm = () => {
    if (!pending) return;
    const fn = pending === "contabilizar" ? contabilizarAsientoAction : anularAsientoAction;
    const verbPast = pending === "contabilizar" ? "contabilizado" : "anulado";

    startTransition(async () => {
      const result = await fn(asiento.id);
      if (result.ok) {
        toast.success(`Asiento Nº ${result.numero} ${verbPast}.`);
        setPending(null);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <>
      {puedeContabilizar(asiento.estado) && (
        <Button onClick={() => setPending("contabilizar")}>
          <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} />
          Contabilizar
        </Button>
      )}
      {puedeAnular(asiento.estado) && (
        <PermissionGate
          permission={PERMISOS.ASIENTOS_ANULAR}
          variant="button"
          tooltip="Sin permiso (asientos.anular)"
        >
          <Button variant="destructive" onClick={() => setPending("anular")}>
            <HugeiconsIcon icon={CancelCircleIcon} strokeWidth={2} />
            Anular
          </Button>
        </PermissionGate>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" aria-label="Más acciones" />}>
          <HugeiconsIcon icon={MoreHorizontalCircle01Icon} strokeWidth={2} />
          Más acciones
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {puedeMoverFe ? (
            <DropdownMenuItem
              render={
                <Link href={`/contabilidad/asientos/mover-periodo?periodoOrigenId=${periodoId}`} />
              }
            >
              <HugeiconsIcon icon={ArrowLeftRightIcon} strokeWidth={2} />
              Mover de período
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem disabled>
              <HugeiconsIcon icon={ArrowLeftRightIcon} strokeWidth={2} />
              <span>Mover de período</span>
              <span className="ml-auto pl-3 text-[10px] uppercase tracking-wide text-muted-foreground">
                Sin permiso
              </span>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && !isSubmitting) setPending(null);
        }}
      >
        <DialogContent>
          {pending && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {pending === "contabilizar"
                    ? `Contabilizar asiento Nº ${asiento.numero}`
                    : `Anular asiento Nº ${asiento.numero}`}
                </DialogTitle>
                <DialogDescription>
                  {asiento.descripcion} · {format(new Date(asiento.fecha), "dd/MM/yyyy")}
                  {pending === "contabilizar"
                    ? ". Al contabilizarlo, las líneas pasarán a afectar saldos y reportes."
                    : ". Al anularlo, las líneas dejarán de afectar saldos. El número del asiento se mantiene para auditoría."}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPending(null)} disabled={isSubmitting}>
                  Cancelar
                </Button>
                <Button
                  variant={pending === "anular" ? "destructive" : "default"}
                  onClick={onConfirm}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Procesando…" : "Confirmar"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
