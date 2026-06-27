"use client";

/**
 * Worklist Comex de procesos sobre EnterpriseDataGrid (PR-020 / CX-02).
 *
 * UI-only: monta el grid (freeze 5 + ETA color + chips + expand + resumen de
 * selección) sobre el read de SÓLO lectura `listarEmbarques`. NO reimplementa
 * acciones de negocio: el drill-down (EntityLink) navega al record CX-03
 * (PR-021), donde viven editar/emitir/despachar. Vistas + moneda son
 * server-driven (URL, ver `EmbarquesViewsBar`); acá viven la búsqueda rápida,
 * orden, freeze, chips, expand y el resumen de selección (sin costo).
 */

import { useMemo } from "react";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon } from "@hugeicons/core-free-icons";

import { EnterpriseDataGrid } from "@/components/data-grid/enterprise-data-grid";
import { buttonVariants } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { convertirMonto, fmtMoney } from "@/lib/format";
import type { EmbarqueWorklistRow } from "@/lib/actions/embarques";

import { buildEmbarquesColumns } from "./embarques-columns";
import { EmbarquesExpandedRow } from "./embarques-expanded-row";
import { EmbarquesExportButton } from "./embarques-export-button";

type Props = {
  rows: EmbarqueWorklistRow[];
  tc: string | null;
  verCosto: boolean;
};

function toFilterOptions(values: readonly string[]): { value: string; label: string }[] {
  return Array.from(new Set(values.filter((v) => v.length > 0)))
    .sort()
    .map((v) => ({ value: v, label: v }));
}

// Resumen de selección: suma del valor COMERCIAL (FOB en USD) en ARS y USD.
// NUNCA suma costo (landed) — el costo queda fuera del resumen aunque haya gate.
function sumaFob(rows: EmbarqueWorklistRow[], destino: "ARS" | "USD", tc: string | null): string {
  const total = rows.reduce(
    (acc, r) => acc + Number(convertirMonto(r.fobUsd, "USD", destino, tc)),
    0,
  );
  return fmtMoney(total.toFixed(2));
}

export function EmbarquesWorklist({ rows, tc, verCosto }: Props) {
  const columns = useMemo(() => buildEmbarquesColumns({ verCosto }), [verCosto]);
  const proveedorOptions = useMemo(
    () => toFilterOptions(rows.map((r) => r.proveedorNombre)),
    [rows],
  );
  const statusCostoOptions = useMemo(() => toFilterOptions(rows.map((r) => r.statusCosto)), [rows]);

  return (
    <EnterpriseDataGrid
      data={rows}
      columns={columns}
      getRowId={(r) => r.id}
      quickSearch={{
        placeholder: "Buscar por proceso, proveedor o buque…",
        keys: ["codigo", "proveedorNombre", "nombreBuque"],
      }}
      filters={[
        { columnId: "proveedorNombre", label: "Proveedor", options: proveedorOptions },
        { columnId: "statusCosto", label: "Status costo", options: statusCostoOptions },
      ]}
      renderExpanded={(r) => <EmbarquesExpandedRow row={r} verCosto={verCosto} />}
      enableRowSelection
      selectionSummary={(sel) =>
        `Suma FOB ARS ${sumaFob(sel, "ARS", tc)} · USD ${sumaFob(sel, "USD", tc)}`
      }
      bulkActions={() => (
        <DropdownMenuItem disabled>
          Exportar selección
          <span className="ml-auto pl-3 text-[10px] tracking-wide text-muted-foreground uppercase">
            PR-005
          </span>
        </DropdownMenuItem>
      )}
      exportSurface={false}
      primaryAction={
        <div className="flex items-center gap-2">
          <EmbarquesExportButton />
          <Link href="/comex/embarques/nuevo" className={buttonVariants({ variant: "default" })}>
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
            Nuevo embarque
          </Link>
        </div>
      }
      emptyMessage="Todavía no hay embarques registrados."
      emptyFilteredMessage="No hay embarques para los filtros seleccionados."
    />
  );
}
