"use client";

import { useMemo } from "react";

import { EnterpriseDataGrid } from "@/components/data-grid/enterprise-data-grid";
import type { AuditoriaRow } from "@/lib/services/auditoria-query";

import { AuditoriaExpandedRow, buildAuditoriaColumns } from "./auditoria-columns";
import { AuditoriaExportButton } from "./auditoria-export-button";
import { AuditoriaFilterBar } from "./auditoria-filter-bar";

type Props = {
  rows: AuditoriaRow[];
  usuarios: { id: string; nombre: string }[];
};

// Worklist de SÓLO-LECTURA: barra de filtros server-driven + grid (display,
// quick-search in-page, sort, expansión con el diff, paginación, freeze) +
// exportación auditada. Sin acciones de edición/borrado de eventos (inmutable).
export function AuditoriaWorklist({ rows, usuarios }: Props) {
  const columns = useMemo(() => buildAuditoriaColumns(), []);

  return (
    <div className="flex flex-col">
      <AuditoriaFilterBar usuarios={usuarios} />
      <EnterpriseDataGrid
        data={rows}
        columns={columns}
        getRowId={(r) => String(r.id)}
        quickSearch={{
          placeholder: "Buscar en esta página…",
          keys: [
            "usuarioNombre",
            "accionLabel",
            "origenLabel",
            "tablaLabel",
            "registroId",
            "motivo",
            "fechaLabel",
          ],
        }}
        renderExpanded={(r) => <AuditoriaExpandedRow row={r} />}
        exportSurface={false}
        primaryAction={<AuditoriaExportButton />}
        emptyMessage="No hay eventos de auditoría."
        emptyFilteredMessage="No hay eventos de auditoría para los filtros seleccionados."
      />
    </div>
  );
}
