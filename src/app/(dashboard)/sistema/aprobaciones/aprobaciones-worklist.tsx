"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { EnterpriseDataGrid } from "@/components/data-grid/enterprise-data-grid";
import type { AprobacionRow } from "@/lib/services/aprobaciones-query";

import { buildAprobacionesColumns } from "./aprobaciones-columns";
import { AprobacionesFilterBar } from "./aprobaciones-filter-bar";
import { AprobacionDecisionWindow } from "./aprobacion-decision-window";

type Props = {
  rows: AprobacionRow[];
  solicitantes: { id: string; nombre: string }[];
  approvalsEnabled: boolean;
  esAdmin: boolean;
};

// Worklist de la Central: barra de filtros server-driven + grid (display,
// quick-search, sort, paginación, freeze) + janela de decisão por fila. Las
// transiciones las aplica el motor PR-012 vía server actions delgadas.
export function AprobacionesWorklist({ rows, solicitantes, approvalsEnabled, esAdmin }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<AprobacionRow | null>(null);
  const columns = useMemo(() => buildAprobacionesColumns(setSelected), []);

  return (
    <div className="flex flex-col">
      <AprobacionesFilterBar solicitantes={solicitantes} />
      <EnterpriseDataGrid
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        quickSearch={{
          placeholder: "Buscar en esta página…",
          keys: [
            "solicitanteNombre",
            "tipoLabel",
            "registroId",
            "estadoLabel",
            "aprobadorNombre",
            "venceEnLabel",
          ],
        }}
        exportSurface={false}
        emptyMessage="No hay aprobaciones pendientes."
        emptyFilteredMessage="No hay aprobaciones para los filtros seleccionados."
      />
      <AprobacionDecisionWindow
        row={selected}
        approvalsEnabled={approvalsEnabled}
        esAdmin={esAdmin}
        onClose={() => setSelected(null)}
        onDone={() => {
          setSelected(null);
          router.refresh();
        }}
      />
    </div>
  );
}
