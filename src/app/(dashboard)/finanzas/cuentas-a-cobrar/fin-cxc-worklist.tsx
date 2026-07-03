"use client";

/**
 * Worklist de gestión de cuentas a cobrar sobre EnterpriseDataGrid
 * (FIN-01 · PR-026). Espejo de `cuentas-a-cobrar-worklist.tsx` (025c).
 *
 * UI-only: monta el grid (busca rápida + orden + paginación client +
 * drill-down por cliente via `renderExpanded`) sobre las filas YA aplanadas,
 * ordenadas y filtradas por la page (proyección `listarFinCxcWorklist`
 * gateada por `VER_SALDO`; los presets `?vista=`/`?agrupar=cliente` se
 * aplican server-side ANTES de llegar acá — lección PR-010: sub-vistas
 * oficiales = presets de URL, no SavedViews in-memory). Export auditado via
 * `primaryAction` (`exportSurface` del toolbar es un placeholder muerto).
 */

import { useCallback, useMemo } from "react";

import { Card } from "@/components/ui/card";
import { EnterpriseDataGrid } from "@/components/data-grid/enterprise-data-grid";

import {
  buildFinCxcColumns,
  type VentaPendienteFlatRow,
  VentasClienteExpand,
} from "./fin-cxc-columns";
import { FinCxcExportButton } from "./fin-cxc-export-button";
import type { Moneda } from "../../reportes/_components/moneda-toggle";

type Props = {
  rows: VentaPendienteFlatRow[];
  // Moneda de presentación (USD por default) y TC de cierre — sólo afectan
  // los DISPLAYS (saldos); la fuente es siempre la moneda nativa.
  moneda: Moneda;
  tc: string | null;
  emptyMessage: string;
};

export function FinCxcWorklist({ rows, moneda, tc, emptyMessage }: Props) {
  const columns = useMemo(() => buildFinCxcColumns({ moneda, tc }), [moneda, tc]);

  const renderExpanded = useCallback(
    (f: VentaPendienteFlatRow) => <VentasClienteExpand f={f} moneda={moneda} tc={tc} />,
    [moneda, tc],
  );

  return (
    <Card className="py-0 p-3">
      <EnterpriseDataGrid
        data={rows}
        columns={columns}
        getRowId={(f) => f.id}
        quickSearch={{
          placeholder: "Buscar por cliente, factura o CUIT…",
          keys: ["clienteNombre", "numero", "cuit"],
        }}
        renderExpanded={renderExpanded}
        primaryAction={<FinCxcExportButton />}
        exportSurface={false}
        emptyMessage={emptyMessage}
        emptyFilteredMessage="Ninguna venta pendiente para los filtros seleccionados."
      />
    </Card>
  );
}
