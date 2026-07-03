"use client";

/**
 * Worklist canónica de inventario sobre EnterpriseDataGrid (INV-01 · PR-027).
 * Espejo de `fin-cxc-worklist.tsx` (PR-026).
 *
 * UI-only: monta el grid (búsqueda rápida + chips + orden + paginación client
 * + mini-ficha via `renderExpanded`) sobre las filas YA proyectadas, filtradas
 * y ordenadas por la page (proyección `listarInventarioWorklist`; los presets
 * `?vista=`/`?agrupar=deposito`/`?dias=` se aplican server-side ANTES de
 * llegar acá — lección PR-010: sub-vistas oficiales = presets de URL, no
 * SavedViews in-memory). Export auditado via `primaryAction` (`exportSurface`
 * del toolbar es un placeholder muerto).
 *
 * Los chips son data-backed (subconjunto de los 7 filtros del OD-04):
 * Depósito / Marca / Medida / Alerta — opciones derivadas de las filas.
 * Status / Despacho / Categoría pipeline NO tienen backing por fila → omitidos
 * (IMPLEMENTATION_NOTES_PR027).
 */

import { useCallback, useMemo } from "react";

import { EnterpriseDataGrid } from "@/components/data-grid/enterprise-data-grid";
import type { QuickFilter } from "@/components/data-grid/data-grid-helpers";
import { Card } from "@/components/ui/card";

import {
  ALERTA_BADGE,
  buildInventarioColumns,
  InventarioFilaExpand,
  type InventarioWorklistRow,
} from "./inventario-columns";
import { InventarioExportButton } from "./inventario-export-button";

type Props = {
  rows: InventarioWorklistRow[];
  /** Reflejo FE del gate server-side: sin permiso la columna NO se construye. */
  verCosto: boolean;
  emptyMessage: string;
};

function opciones(values: (string | null)[]): { value: string; label: string }[] {
  const set = new Set<string>();
  for (const v of values) {
    if (v) set.add(v);
  }
  return [...set].sort((a, b) => a.localeCompare(b)).map((v) => ({ value: v, label: v }));
}

export function InventarioWorklist({ rows, verCosto, emptyMessage }: Props) {
  const columns = useMemo(() => buildInventarioColumns({ verCosto }), [verCosto]);

  const filters = useMemo<QuickFilter[]>(() => {
    const alertas = new Set(rows.flatMap((r) => (r.alerta ? [r.alerta] : [])));
    return [
      {
        columnId: "depositoNombre",
        label: "Depósito",
        options: opciones(rows.map((r) => r.depositoNombre)),
      },
      { columnId: "marca", label: "Marca", options: opciones(rows.map((r) => r.marca)) },
      { columnId: "medida", label: "Medida", options: opciones(rows.map((r) => r.medida)) },
      {
        columnId: "alerta",
        label: "Alerta",
        options: [...alertas].map((a) => ({ value: a, label: ALERTA_BADGE[a].label })),
      },
    ];
  }, [rows]);

  const renderExpanded = useCallback(
    (r: InventarioWorklistRow) => <InventarioFilaExpand r={r} verCosto={verCosto} />,
    [verCosto],
  );

  return (
    <Card className="py-0 p-3">
      <EnterpriseDataGrid
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        quickSearch={{
          placeholder: "Buscar por SKU, nombre, marca, medida o depósito…",
          keys: ["codigo", "nombre", "marca", "medida", "depositoNombre"],
        }}
        filters={filters}
        renderExpanded={renderExpanded}
        primaryAction={<InventarioExportButton />}
        exportSurface={false}
        emptyMessage={emptyMessage}
        emptyFilteredMessage="Ninguna posición de stock para los filtros seleccionados."
      />
    </Card>
  );
}
