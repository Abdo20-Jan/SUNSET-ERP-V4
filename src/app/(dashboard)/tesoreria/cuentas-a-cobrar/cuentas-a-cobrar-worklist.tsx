"use client";

/**
 * Worklist de cuentas a cobrar sobre EnterpriseDataGrid (TES-03 · PR-025c).
 *
 * UI-only: monta el grid (busca rápida + orden + paginación client +
 * drill-down de ventas pendientes via `renderExpanded`) sobre las filas ya
 * leídas y filtradas por la page (proyección `listarCuentasACobrarWorklist`,
 * gateada por `VER_SALDO`; el preset `?filtro=vencidas` se aplica server-side
 * ANTES de llegar acá — lección PR-010: sub-vistas oficiales = presets de
 * URL, no SavedViews in-memory). Export auditado via `primaryAction`
 * (`exportSurface` del toolbar es un placeholder muerto).
 */

import { useCallback, useMemo } from "react";

import { Card } from "@/components/ui/card";
import { EnterpriseDataGrid } from "@/components/data-grid/enterprise-data-grid";

import {
  buildCuentasACobrarColumns,
  type SaldoClienteAgingRow,
  VentasPendientesTable,
} from "./cuentas-a-cobrar-columns";
import { CuentasACobrarExportButton } from "./cuentas-a-cobrar-export-button";
import type { Moneda } from "../../reportes/_components/moneda-toggle";

type Props = {
  clientes: SaldoClienteAgingRow[];
  // Moneda de presentación (USD por default) y TC de cierre — sólo afectan
  // los DISPLAYS (saldos/buckets); la fuente es siempre la moneda nativa.
  moneda: Moneda;
  tc: string | null;
  emptyMessage: string;
};

export function CuentasACobrarWorklist({ clientes, moneda, tc, emptyMessage }: Props) {
  const columns = useMemo(() => buildCuentasACobrarColumns({ moneda, tc }), [moneda, tc]);

  const renderExpanded = useCallback(
    (c: SaldoClienteAgingRow) => <VentasPendientesTable c={c} moneda={moneda} tc={tc} />,
    [moneda, tc],
  );

  return (
    <Card className="py-0 p-3">
      <EnterpriseDataGrid
        data={clientes}
        columns={columns}
        getRowId={(c) => c.clienteId}
        quickSearch={{
          placeholder: "Buscar por cliente, CUIT o cuenta…",
          keys: ["clienteNombre", "cuit", "cuentaCodigo"],
        }}
        renderExpanded={renderExpanded}
        primaryAction={<CuentasACobrarExportButton />}
        exportSurface={false}
        emptyMessage={emptyMessage}
        emptyFilteredMessage="Ningún cliente para los filtros seleccionados."
      />
    </Card>
  );
}
