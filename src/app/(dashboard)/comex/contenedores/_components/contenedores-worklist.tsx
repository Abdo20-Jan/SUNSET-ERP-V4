"use client";

/**
 * Worklist GLOBAL de contenedores sobre EnterpriseDataGrid (PR-024 / CX-04).
 *
 * UI-only: monta el grid (freeze 3 + chips + saved-views + expand) sobre el read
 * de SÓLO lectura `listarContenedores`. NO reimplementa acciones de negocio: el
 * drill-down (EntityLink en Número/BL) navega a la ficha del contenedor (024b),
 * donde viven desconsolidar/investigar/despachar. Los counters se muestran tal
 * cual vienen del motor; el costo FC sólo con `verCosto` (gate `VER_COSTO_LANDED`).
 */

import { useMemo } from "react";

import { EnterpriseDataGrid } from "@/components/data-grid/enterprise-data-grid";
import type { SavedView } from "@/components/data-grid/data-grid-helpers";
import type { ContenedorRow } from "@/lib/services/contenedor-worklist";

import { CONTENEDOR_LABEL } from "./contenedores-chips";
import { buildContenedoresColumns } from "./contenedores-columns";
import { ContenedoresExpandedRow } from "./contenedores-expanded-row";

type Props = {
  rows: ContenedorRow[];
  verCosto: boolean;
};

function toFilterOptions(values: readonly string[]): { value: string; label: string }[] {
  return Array.from(new Set(values.filter((v) => v.length > 0)))
    .sort()
    .map((v) => ({ value: v, label: v }));
}

function toEstadoOptions(rows: ContenedorRow[]): { value: string; label: string }[] {
  const estados = Array.from(new Set(rows.map((r) => r.estado)));
  return estados
    .map((e) => ({ value: e, label: CONTENEDOR_LABEL[e] ?? e }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// Vistas guardadas in-memory (predicados client-side). "Todos" primero = default.
const SAVED_VIEWS: SavedView<ContenedorRow>[] = [
  { id: "todos", label: "Todos" },
  {
    id: "deposito-fiscal",
    label: "En depósito fiscal",
    predicate: (r) => r.estado === "EN_DEPOSITO_FISCAL",
  },
  {
    id: "desconsolidados",
    label: "Desconsolidados",
    predicate: (r) => r.estado === "DESCONSOLIDADO",
  },
  {
    id: "investigacion",
    label: "En investigación",
    predicate: (r) => r.estado === "AGUARDANDO_INVESTIGACAO",
  },
  {
    id: "con-disponible",
    label: "Con disponible",
    predicate: (r) => r.cantidadDisponible > 0,
  },
];

export function ContenedoresWorklist({ rows, verCosto }: Props) {
  const columns = useMemo(() => buildContenedoresColumns({ verCosto }), [verCosto]);
  const procesoOptions = useMemo(() => toFilterOptions(rows.map((r) => r.embarqueCodigo)), [rows]);
  const proveedorOptions = useMemo(
    () => toFilterOptions(rows.map((r) => r.proveedorNombre)),
    [rows],
  );
  const estadoOptions = useMemo(() => toEstadoOptions(rows), [rows]);
  const depositoOptions = useMemo(
    () => toFilterOptions(rows.map((r) => r.depositoFiscal ?? "")),
    [rows],
  );

  return (
    <EnterpriseDataGrid
      data={rows}
      columns={columns}
      getRowId={(r) => r.id}
      quickSearch={{
        placeholder: "Buscar por número, BL/HBL, proceso o proveedor…",
        keys: ["numeroContenedor", "numeroBL", "numeroHBL", "embarqueCodigo", "proveedorNombre"],
      }}
      savedViews={SAVED_VIEWS}
      filters={[
        { columnId: "embarqueCodigo", label: "Proceso", options: procesoOptions },
        { columnId: "proveedorNombre", label: "Proveedor", options: proveedorOptions },
        { columnId: "estado", label: "Status", options: estadoOptions },
        { columnId: "depositoFiscal", label: "Depósito fiscal", options: depositoOptions },
      ]}
      renderExpanded={(r) => <ContenedoresExpandedRow row={r} verCosto={verCosto} />}
      exportSurface={false}
      emptyMessage="Todavía no hay contenedores registrados."
      emptyFilteredMessage="No hay contenedores para los filtros seleccionados."
    />
  );
}
