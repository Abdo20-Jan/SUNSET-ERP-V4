"use client";

/**
 * Worklist de movimientos de tesorería sobre EnterpriseDataGrid (TES-01 · PR-025a).
 *
 * UI-only: monta el grid sobre las filas ya leídas por la page. El drill-down
 * (columna Fecha) abre la `MovimientoDetalleWorkWindow` (FWW, sin drawer). El
 * "Anular" conserva el diálogo + `anularAsientoAction` byte-idéntico al listado
 * anterior — el motor de asiento/contabilización NO se toca (sólo se llama la
 * action existente).
 */

import { useState, useTransition } from "react";
import { format } from "date-fns";
import { toast } from "sonner";

import type { Moneda } from "@/generated/prisma/client";
import { anularAsientoAction } from "@/lib/actions/asientos";
import { fmtMontoPres } from "@/lib/format";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import { EnterpriseDataGrid } from "@/components/data-grid/enterprise-data-grid";

import { buildMovimientosColumns, type MovimientoWorklistRow } from "./movimientos-columns";
import { MovimientoDetalleWorkWindow } from "./movimiento-detalle-work-window";

type Props = {
  rows: MovimientoWorklistRow[];
  moneda: Moneda;
  tc: string | null;
};

const TIPO_OPTIONS = [
  { value: "COBRO", label: "Cobro" },
  { value: "PAGO", label: "Pago" },
  { value: "TRANSFERENCIA", label: "Transferencia" },
];

export function MovimientosWorklist({ rows, moneda, tc }: Props) {
  const [pending, setPending] = useState<MovimientoWorklistRow | null>(null);
  const [detalle, setDetalle] = useState<MovimientoWorklistRow | null>(null);
  const [isSubmitting, startTransition] = useTransition();

  const columns = buildMovimientosColumns({
    moneda,
    tc,
    onOpenDetalle: setDetalle,
    onAnular: setPending,
  });

  const bancoOptions = Array.from(new Set(rows.map((r) => r.banco).filter((b) => b.length > 0)))
    .sort()
    .map((b) => ({ value: b, label: b }));

  const onConfirm = () => {
    if (!pending?.asiento) return;
    const asientoId = pending.asiento.id;
    startTransition(async () => {
      const result = await anularAsientoAction(asientoId);
      if (result.ok) {
        toast.success(`Movimiento anulado (asiento Nº ${result.numero}).`);
        setPending(null);
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <TooltipProvider>
      <EnterpriseDataGrid
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        quickSearch={{
          placeholder: "Buscar por descripción, comprobante, banco o referencia…",
          keys: ["descripcion", "comprobante", "referenciaBanco", "banco"],
        }}
        filters={[
          { columnId: "tipo", label: "Tipo", options: TIPO_OPTIONS },
          { columnId: "banco", label: "Cuenta", options: bancoOptions },
        ]}
        exportSurface={false}
        emptyMessage="No hay movimientos registrados."
        emptyFilteredMessage="No hay movimientos para los filtros seleccionados."
      />

      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && !isSubmitting) setPending(null);
        }}
      >
        <DialogContent>
          {pending?.asiento && (
            <>
              <DialogHeader>
                <DialogTitle>Anular movimiento Nº {pending.asiento.numero}</DialogTitle>
                <DialogDescription>
                  {pending.tipo} · {format(pending.fecha, "dd/MM/yyyy")} ·{" "}
                  {pending.cuentaBancaria.banco} ·{" "}
                  {fmtMontoPres(pending.monto, pending.moneda, moneda, tc)} {moneda}. Al anularlo,
                  el asiento pasará a ANULADO y dejará de afectar saldos. El número se mantiene para
                  auditoría.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPending(null)} disabled={isSubmitting}>
                  Cancelar
                </Button>
                <Button variant="destructive" onClick={onConfirm} disabled={isSubmitting}>
                  {isSubmitting ? "Procesando…" : "Anular"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <MovimientoDetalleWorkWindow
        movimiento={detalle}
        open={detalle !== null}
        onOpenChange={(open) => {
          if (!open) setDetalle(null);
        }}
        moneda={moneda}
        tc={tc}
      />
    </TooltipProvider>
  );
}
