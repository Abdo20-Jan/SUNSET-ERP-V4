"use client";

/**
 * Worklist de saldos por proveedor sobre EnterpriseDataGrid (TES-02 · PR-025b).
 *
 * UI-only: monta el grid (busca rápida + orden + paginación client + drill-down
 * de facturas via `renderExpanded`) sobre las filas ya leídas por la page
 * (proyección `listarSaldosProveedoresWorklist`, gateada por `VER_SALDO`). La
 * selección + overrides de "A pagar" viven ACÁ y llegan a las celdas por
 * `BatchPagoContext` (columnas estables — deps sólo `[moneda, tc]`); el panel
 * de pago batch (`BatchPagoPanel`) hospeda el flujo EXISTENTE con payloads
 * byte-idénticos. Export diferido (espejo PR-025a).
 */

import { useCallback, useMemo, useState } from "react";

import type { CuentaBancariaOption } from "@/lib/actions/movimientos-tesoreria";
import { Card } from "@/components/ui/card";
import { EnterpriseDataGrid } from "@/components/data-grid/enterprise-data-grid";

import { BatchPagoPanel } from "./batch-pago-panel";
import {
  BatchPagoContext,
  type BatchPagoContextValue,
  buildSaldosProveedoresColumns,
  FacturasChips,
  type ProveedorIntermediario,
  type SaldoProveedorAging,
} from "./saldos-proveedores-columns";
import type { Moneda } from "../../reportes/_components/moneda-toggle";

type Props = {
  proveedores: SaldoProveedorAging[];
  intermediarios: ProveedorIntermediario[];
  cuentasBancarias: CuentaBancariaOption[];
  defaultFecha?: string;
  // Moneda de presentación (USD por default) y TC de cierre — sólo afectan
  // los DISPLAYS de lectura (saldos/buckets/chips). La lógica de pago opera
  // siempre en ARS nativo (el dinero sale del banco en ARS).
  moneda: Moneda;
  tc: string | null;
};

/**
 * Estado de selección + overrides del batch (setters funcionales estables —
 * las celdas los consumen via Context sin invalidar las columnas).
 */
function useBatchSelection() {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [montosOverride, setMontosOverride] = useState<Record<string, string>>({});

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const setMonto = useCallback((id: string, valor: string) => {
    setMontosOverride((prev) => ({ ...prev, [id]: valor }));
  }, []);

  const replaceSelection = useCallback((ids: string[]) => {
    setSelected(new Set(ids));
  }, []);

  const onPaid = useCallback(() => {
    setSelected(new Set());
    setMontosOverride({});
  }, []);

  const ctxValue = useMemo<BatchPagoContextValue>(
    () => ({ selected, montosOverride, toggle, setMonto, replaceSelection }),
    [selected, montosOverride, toggle, setMonto, replaceSelection],
  );

  return { selected, montosOverride, ctxValue, onPaid };
}

export function SaldosProveedoresWorklist({
  proveedores,
  intermediarios,
  cuentasBancarias,
  defaultFecha,
  moneda,
  tc,
}: Props) {
  const { selected, montosOverride, ctxValue, onPaid } = useBatchSelection();

  const columns = useMemo(() => buildSaldosProveedoresColumns({ moneda, tc }), [moneda, tc]);

  const renderExpanded = useCallback(
    (p: SaldoProveedorAging) => <FacturasChips p={p} moneda={moneda} tc={tc} />,
    [moneda, tc],
  );

  const provById = useMemo(
    () => new Map(proveedores.map((p) => [p.proveedorId, p])),
    [proveedores],
  );
  const seleccionados = Array.from(selected)
    .map((id) => provById.get(id))
    .filter((p): p is SaldoProveedorAging => !!p);

  return (
    <BatchPagoContext.Provider value={ctxValue}>
      <Card className="py-0 p-3">
        <EnterpriseDataGrid
          data={proveedores}
          columns={columns}
          getRowId={(p) => p.proveedorId}
          quickSearch={{
            placeholder: "Buscar por proveedor, CUIT o país…",
            keys: ["proveedorNombre", "cuit", "pais"],
          }}
          renderExpanded={renderExpanded}
          exportSurface={false}
          emptyMessage="Sin saldos pendientes para los filtros seleccionados."
          emptyFilteredMessage="Sin saldos pendientes para los filtros seleccionados."
        />
      </Card>

      <BatchPagoPanel
        seleccionados={seleccionados}
        montosOverride={montosOverride}
        intermediarios={intermediarios}
        cuentasBancarias={cuentasBancarias}
        defaultFecha={defaultFecha}
        onPaid={onPaid}
      />
    </BatchPagoContext.Provider>
  );
}
