"use client";

/**
 * Worklist de histórico de pagos sobre EnterpriseDataGrid (TES-02 · PR-025b).
 *
 * UI-only: monta el grid (busca rápida + chip Método + orden + paginación
 * client) sobre las filas ya leídas por la page vía `getHistoricoPagos` (READ,
 * row-shaped — sin proyección nueva). Los filtros de DATOS
 * (proveedor/moneda/banco/fechas) siguen server-driven por URL en
 * `PagosHistorialFilters` (sin cambios). Export diferido (espejo PR-025a).
 */

import { useMemo } from "react";

import type { PagoHistorico } from "@/lib/services/historico-pagos";
import { EnterpriseDataGrid } from "@/components/data-grid/enterprise-data-grid";

import { buildPagosHistorialColumns } from "./pagos-historial-columns";

type Props = {
  pagos: PagoHistorico[];
};

export function PagosHistorialWorklist({ pagos }: Props) {
  const columns = useMemo(() => buildPagosHistorialColumns(), []);

  const metodoOptions = useMemo(
    () =>
      Array.from(new Set(pagos.map((p) => p.metodo).filter((m) => m.length > 0)))
        .sort()
        .map((m) => ({ value: m, label: m })),
    [pagos],
  );

  return (
    <EnterpriseDataGrid
      data={pagos}
      columns={columns}
      getRowId={(p) => p.movimientoId}
      quickSearch={{
        placeholder: "Buscar por proveedor, banco, método o descripción…",
        keys: ["proveedorNombre", "cuentaBancariaLabel", "metodo", "descripcion"],
      }}
      filters={[{ columnId: "metodo", label: "Método", options: metodoOptions }]}
      exportSurface={false}
      emptyMessage="Sin pagos para los filtros seleccionados."
      emptyFilteredMessage="Sin pagos para los filtros seleccionados."
    />
  );
}
