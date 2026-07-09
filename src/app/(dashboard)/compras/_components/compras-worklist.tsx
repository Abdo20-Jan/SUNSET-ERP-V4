"use client";

/**
 * Worklist canónica de compras sobre EnterpriseDataGrid (espejo de
 * `fin-cxc-worklist.tsx` · PR-026).
 *
 * UI-only: monta el grid (busca rápida + chip Estado + orden) sobre las filas
 * YA aplanadas de la PÁGINA cargada — la paginación REAL es la server externa
 * (`<Pagination>` llega como `children` y vive dentro de la misma Card, como
 * con la tabla legada). `pageSize=100` ≥ el perPage default (50) para que el
 * grid NO pagine por encima de la página server; la busca y el chip operan
 * sólo sobre la página visible (el placeholder es honesto al respecto).
 * Export auditado via `primaryAction` (`exportSurface` del toolbar es un
 * placeholder muerto).
 */

import { type ReactNode, useMemo } from "react";

import { Card } from "@/components/ui/card";
import { EnterpriseDataGrid } from "@/components/data-grid/enterprise-data-grid";

import { buildComprasColumns } from "./compras-columns";
import { ComprasExportButton } from "./compras-export-button";
import type { CompraWorklistRow } from "./compras-presentacion";
import type { Moneda } from "../../reportes/_components/moneda-toggle";

const ESTADOS: CompraWorklistRow["estado"][] = ["BORRADOR", "EMITIDA", "RECIBIDA", "CANCELADA"];

// Chip de estado: `value` = enum crudo (el QuickFilter compara contra
// `row.estado`), label legible en ES. Helper nombrado (gotcha Lizard).
function estadoOption(estado: CompraWorklistRow["estado"]): { value: string; label: string } {
  const label = estado.charAt(0) + estado.slice(1).toLowerCase();
  return { value: estado, label };
}

type Props = {
  rows: CompraWorklistRow[];
  // Moneda de presentación y TC de cierre — sólo afectan el DISPLAY del
  // total; la fuente es siempre la moneda nativa de cada factura.
  moneda: Moneda;
  tc: string | null;
  /** `<Pagination>` server externa — se rinde debajo del grid, misma Card. */
  children?: ReactNode;
};

export function ComprasWorklist({ rows, moneda, tc, children }: Props) {
  const columns = useMemo(() => buildComprasColumns({ moneda, tc }), [moneda, tc]);

  return (
    <Card className="py-0 p-3">
      <EnterpriseDataGrid
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        quickSearch={{
          placeholder: "Buscar en esta página…",
          keys: ["numero", "proveedorNombre"],
        }}
        filters={[{ columnId: "estado", label: "Estado", options: ESTADOS.map(estadoOption) }]}
        primaryAction={<ComprasExportButton />}
        exportSurface={false}
        pageSize={Math.max(100, rows.length)}
        emptyMessage="No hay compras registradas todavía."
        emptyFilteredMessage="Ninguna compra para los filtros seleccionados."
      />
      {children}
    </Card>
  );
}
