"use client";

/**
 * Worklist de asientos sobre EnterpriseDataGrid (CONT-01 · PR-028). Espejo
 * estructural de `fin-cxc-worklist.tsx` (PR-026).
 *
 * UI-only: monta el grid (busca rápida + chips client origen/estado + orden +
 * paginación client) sobre las filas YA filtradas server-side por la page
 * (proyección `listarAsientosWorklist`; presets `?vista=`/`?periodo=`/
 * `?cuentaId=` — lección PR-010: sub-vistas oficiales = presets de URL, no
 * SavedViews in-memory). Hospeda además:
 *  - el Dialog Contabilizar/Anular VERBATIM de `asientos-table.tsx` (mismas
 *    actions `contabilizarAsientoAction`/`anularAsientoAction`, payload
 *    `asiento.id` byte-idéntico);
 *  - la FWW de detalle (`AsientoDetalleWorkWindow`, ex-sheet);
 *  - el export auditado via `primaryAction`.
 */

import { useMemo, useState, useTransition } from "react";
import { format } from "date-fns";
import { toast } from "sonner";

import { anularAsientoAction, contabilizarAsientoAction } from "@/lib/actions/asientos";
import type { AsientoWorklistRow } from "@/lib/services/asientos-worklist";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EnterpriseDataGrid } from "@/components/data-grid/enterprise-data-grid";

import { buildAsientosColumns, type AsientoRowAction } from "./asientos-columns";
import { AsientoDetalleWorkWindow } from "./asiento-detalle-work-window";
import { AsientosExportButton } from "./asientos-export-button";
import { ESTADO_FILTER_OPTIONS, ORIGEN_FILTER_OPTIONS } from "./asientos-presentacion";

type PendingAction = { action: AsientoRowAction; asiento: AsientoWorklistRow } | null;

type Props = {
  rows: AsientoWorklistRow[];
  emptyMessage: string;
};

export function AsientosWorklist({ rows, emptyMessage }: Props) {
  const [pending, setPending] = useState<PendingAction>(null);
  const [detalleId, setDetalleId] = useState<string | null>(null);
  const [isSubmitting, startTransition] = useTransition();

  const columns = useMemo(
    () =>
      buildAsientosColumns({
        onOpenDetalle: setDetalleId,
        onAction: (action, asiento) => setPending({ action, asiento }),
      }),
    [],
  );

  // Confirmación VERBATIM de la tabla legada: misma action, mismo payload
  // (`asiento.id`), mismos textos y estados resultantes.
  const onConfirm = () => {
    if (!pending) return;
    const { action, asiento } = pending;
    const fn = action === "contabilizar" ? contabilizarAsientoAction : anularAsientoAction;
    const verbPast = action === "contabilizar" ? "contabilizado" : "anulado";

    startTransition(async () => {
      const result = await fn(asiento.id);
      if (result.ok) {
        toast.success(`Asiento Nº ${result.numero} ${verbPast}.`);
        setPending(null);
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Card className="py-0 p-3">
      <EnterpriseDataGrid
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        quickSearch={{
          placeholder: "Buscar por número, descripción o período…",
          keys: ["numero", "descripcion", "periodoCodigo"],
        }}
        filters={[
          { columnId: "origen", label: "Origen", options: [...ORIGEN_FILTER_OPTIONS] },
          { columnId: "estado", label: "Estado", options: [...ESTADO_FILTER_OPTIONS] },
        ]}
        primaryAction={<AsientosExportButton />}
        exportSurface={false}
        emptyMessage={emptyMessage}
        emptyFilteredMessage="No hay asientos para los filtros seleccionados."
      />

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
                  {pending.action === "contabilizar"
                    ? `Contabilizar asiento Nº ${pending.asiento.numero}`
                    : `Anular asiento Nº ${pending.asiento.numero}`}
                </DialogTitle>
                <DialogDescription>
                  {pending.asiento.descripcion} ·{" "}
                  {format(new Date(pending.asiento.fecha), "dd/MM/yyyy")}
                  {pending.action === "contabilizar"
                    ? ". Al contabilizarlo, las líneas pasarán a afectar saldos y reportes."
                    : ". Al anularlo, las líneas dejarán de afectar saldos. El número del asiento se mantiene para auditoría."}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPending(null)} disabled={isSubmitting}>
                  Cancelar
                </Button>
                <Button
                  variant={pending.action === "anular" ? "destructive" : "default"}
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

      <AsientoDetalleWorkWindow
        asientoId={detalleId}
        open={detalleId !== null}
        onOpenChange={(open) => {
          if (!open) setDetalleId(null);
        }}
      />
    </Card>
  );
}
