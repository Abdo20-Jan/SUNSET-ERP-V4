"use client";

/**
 * Worklist de pedidos de compra (OC) sobre EnterpriseDataGrid
 * (COMP-01 · PR-029). Espejo de `fin-cxc-worklist.tsx` (PR-026).
 *
 * UI-only: monta el grid (busca rápida + orden + paginación client) sobre las
 * filas YA aplanadas y filtradas por la page (los presets `?vista=` se aplican
 * server-side ANTES de llegar acá — lección PR-010: sub-vistas oficiales =
 * presets de URL, no SavedViews in-memory). Export auditado via
 * `primaryAction` (`exportSurface` del toolbar es un placeholder muerto).
 */

import { useMemo } from "react";

import { EnterpriseDataGrid } from "@/components/data-grid/enterprise-data-grid";
import { Card } from "@/components/ui/card";

import { buildPedidosCompraColumns } from "./pedidos-compra-columns";
import { PedidosCompraExportButton } from "./pedidos-compra-export-button";
import type { PedidoCompraWorklistRow } from "./pedidos-compra-presentacion";
import type { Moneda } from "../../../reportes/_components/moneda-toggle";

type Props = {
  rows: PedidoCompraWorklistRow[];
  // Moneda de presentación y TC de cierre — sólo afectan el DISPLAY del total;
  // la fuente es siempre la moneda nativa del pedido.
  moneda: Moneda;
  tc: string | null;
  emptyMessage: string;
};

export function PedidosCompraWorklist({ rows, moneda, tc, emptyMessage }: Props) {
  const columns = useMemo(() => buildPedidosCompraColumns({ moneda, tc }), [moneda, tc]);

  return (
    <Card className="py-0 p-3">
      <EnterpriseDataGrid
        data={rows}
        columns={columns}
        getRowId={(r) => String(r.id)}
        quickSearch={{
          placeholder: "Buscar por número o proveedor…",
          keys: ["numero", "proveedorNombre"],
        }}
        primaryAction={<PedidosCompraExportButton />}
        exportSurface={false}
        emptyMessage={emptyMessage}
        emptyFilteredMessage="Sin pedidos que coincidan con la búsqueda o filtros."
      />
    </Card>
  );
}
