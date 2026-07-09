"use client";

/**
 * Worklist de oportunidades sobre EnterpriseDataGrid (CRM-01 · PR-030).
 * Espejo de `pedidos-compra-worklist.tsx` (PR-029).
 *
 * UI-only: monta el grid (busca rápida + orden + paginación client) sobre las
 * filas YA armadas y filtradas por la page (los presets `?estado=`/`?filtro=`/
 * `?owner=me` se aplican server-side ANTES de llegar acá — lección PR-010).
 * Dataset completo (la action no pagina). Export auditado via `primaryAction`
 * (`exportSurface` del toolbar es un placeholder muerto). La asignación
 * masiva reusa `bulkAssignOportunidadesOwnerAction` con payload intacto; el
 * `key` del grid se bumpea al terminar para limpiar la selección (remount).
 */

import { useCallback, useMemo, useState } from "react";

import { EnterpriseDataGrid } from "@/components/data-grid/enterprise-data-grid";
import { Card } from "@/components/ui/card";
import { convertirMonto, fmtMoney } from "@/lib/format";

import { buildOportunidadesColumns } from "./oportunidades-columns";
import {
  BulkAssignOwnerDialog,
  BulkAssignOwnerMenuItem,
  type UsuarioAsignable,
} from "./oportunidades-bulk-assign";
import { OportunidadesExportButton } from "./oportunidades-export-button";
import type { OportunidadWorklistRow } from "./oportunidades-presentacion";
import type { Moneda } from "../../../reportes/_components/moneda-toggle";

type Props = {
  rows: OportunidadWorklistRow[];
  usuarios: UsuarioAsignable[];
  // Moneda de presentación y TC de cierre — sólo afectan el DISPLAY de
  // monto/ponderado; la fuente es siempre la moneda nativa de la oportunidad.
  moneda: Moneda;
  tc: string | null;
  emptyMessage: string;
};

function toFilterOptions(values: readonly string[]): { value: string; label: string }[] {
  return Array.from(new Set(values.filter((v) => v.length > 0)))
    .sort()
    .map((v) => ({ value: v, label: v }));
}

// Suma del valor ponderado de la selección en la moneda de PRESENTACIÓN
// (conversión por fila native-first — idioma de comercial-documentos-table).
function sumaPonderada(rows: OportunidadWorklistRow[], destino: Moneda, tc: string | null): string {
  const total = rows.reduce(
    (acc, r) => acc + Number(convertirMonto(r.valorPonderado, r.moneda, destino, tc)),
    0,
  );
  return fmtMoney(total.toFixed(2));
}

export function OportunidadesWorklist({ rows, usuarios, moneda, tc, emptyMessage }: Props) {
  const columns = useMemo(() => buildOportunidadesColumns({ moneda, tc }), [moneda, tc]);

  // Remount del grid tras un bulk OK → limpia la selección (no hay API de
  // reset externa en el EnterpriseDataGrid).
  const [gridKey, setGridKey] = useState(0);
  const bumpGridKey = useCallback(() => setGridKey((k) => k + 1), []);

  // Snapshot de filas seleccionadas al abrir el diálogo de asignación (el
  // Dialog vive fuera del menú — ver oportunidades-bulk-assign.tsx).
  const [bulkRows, setBulkRows] = useState<OportunidadWorklistRow[] | null>(null);

  // Facets client (presentation-only, paridad fin-cxc): refinan el grid en
  // memoria y NO viajan al export — el archivo sale con los presets de URL
  // (`estado`/`filtro`/`owner`), no con estos chips (disclaimer en la action).
  const stageOptions = useMemo(() => toFilterOptions(rows.map((r) => r.stageNombre)), [rows]);
  const ownerOptions = useMemo(() => toFilterOptions(rows.map((r) => r.ownerNombre)), [rows]);

  return (
    <Card className="py-0 p-3">
      <EnterpriseDataGrid
        key={gridKey}
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        quickSearch={{
          placeholder: "Buscar por número, título, cliente, lead u owner…",
          keys: ["numero", "titulo", "clienteNombre", "leadEmpresa", "ownerNombre"],
        }}
        filters={[
          { columnId: "stageNombre", label: "Stage", options: stageOptions },
          { columnId: "ownerNombre", label: "Owner", options: ownerOptions },
          {
            columnId: "moneda",
            label: "Moneda",
            options: [
              { value: "ARS", label: "ARS" },
              { value: "USD", label: "USD" },
            ],
          },
        ]}
        enableRowSelection
        selectionSummary={(sel) => `Ponderado ${moneda} ${sumaPonderada(sel, moneda, tc)}`}
        bulkActions={(sel) => <BulkAssignOwnerMenuItem onSelect={() => setBulkRows(sel)} />}
        primaryAction={<OportunidadesExportButton />}
        exportSurface={false}
        emptyMessage={emptyMessage}
        emptyFilteredMessage="Sin oportunidades que coincidan con la búsqueda o filtros."
      />

      <BulkAssignOwnerDialog
        rows={bulkRows}
        usuarios={usuarios}
        onClose={() => setBulkRows(null)}
        onDone={bumpGridKey}
      />
    </Card>
  );
}
