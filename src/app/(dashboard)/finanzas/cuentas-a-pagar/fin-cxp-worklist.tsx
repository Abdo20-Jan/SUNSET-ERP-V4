"use client";

/**
 * Worklist de gestión de cuentas a pagar sobre EnterpriseDataGrid
 * (FIN-02 · PR-026). Espejo de `cuentas-a-cobrar-worklist.tsx` (025c).
 *
 * UI-only: monta el grid (busca rápida + chip de origen + orden + paginación
 * client + drill-down por proveedor via `renderExpanded`) sobre las filas YA
 * aplanadas, ordenadas y filtradas por la page (proyección
 * `listarSaldosProveedoresWorklist` gateada por `VER_SALDO`; los presets
 * `?vista=` se aplican server-side ANTES de llegar acá — lección PR-010:
 * sub-vistas oficiales = presets de URL, no SavedViews in-memory). Export
 * auditado via `primaryAction` (`exportSurface` del toolbar es un placeholder
 * muerto).
 */

import { useCallback, useMemo } from "react";

import { Card } from "@/components/ui/card";
import { EnterpriseDataGrid } from "@/components/data-grid/enterprise-data-grid";

import {
  buildFinCxpColumns,
  type FacturaPendienteFlatRow,
  FacturasProveedorTable,
} from "./fin-cxp-columns";
import { finCxpRowId } from "./fin-cxp-presentacion";
import { FinCxpExportButton } from "./fin-cxp-export-button";
import type { Moneda } from "../../reportes/_components/moneda-toggle";

type Props = {
  rows: FacturaPendienteFlatRow[];
  // Moneda de presentación (USD por default) y TC de cierre — sólo afectan
  // los DISPLAYS (saldos); la fuente es siempre la moneda nativa.
  moneda: Moneda;
  tc: string | null;
  emptyMessage: string;
};

// Chip de origen: presentación client-side sobre el campo ya presente en la
// fila (mismo mecanismo del chip Método de pagos-historial/025b).
const ORIGEN_FILTER = {
  columnId: "origen",
  label: "Origen",
  options: [
    { value: "compra", label: "Compra" },
    { value: "gasto", label: "Gasto" },
    { value: "embarque", label: "Costo embarque" },
  ],
};

export function FinCxpWorklist({ rows, moneda, tc, emptyMessage }: Props) {
  const columns = useMemo(() => buildFinCxpColumns({ moneda, tc }), [moneda, tc]);

  const renderExpanded = useCallback(
    (f: FacturaPendienteFlatRow) => <FacturasProveedorTable f={f} moneda={moneda} tc={tc} />,
    [moneda, tc],
  );

  return (
    <Card className="py-0 p-3">
      <EnterpriseDataGrid
        data={rows}
        columns={columns}
        getRowId={finCxpRowId}
        quickSearch={{
          placeholder: "Buscar por proveedor, documento, CUIT o referencia…",
          keys: ["proveedorNombre", "numero", "cuit", "referencia"],
        }}
        filters={[ORIGEN_FILTER]}
        renderExpanded={renderExpanded}
        primaryAction={<FinCxpExportButton />}
        exportSurface={false}
        emptyMessage={emptyMessage}
        emptyFilteredMessage="Ningún documento para los filtros seleccionados."
      />
    </Card>
  );
}
