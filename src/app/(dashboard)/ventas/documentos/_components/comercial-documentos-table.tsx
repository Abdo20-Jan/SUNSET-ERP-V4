"use client";

/**
 * Worklist Comercial > Documentos sobre EnterpriseDataGrid (PR-017 / COM-01).
 *
 * UI-only: monta el grid (freeze 4 col. OD-01 + quick-search + filtros + vistas
 * salvas + selección con suma ARS/USD) sobre el aggregator de SÓLO lectura. No
 * reimplementa acciones de negocio: el drill-down (EntityLink) navega a los
 * records existentes de Venta/Pedido, donde viven emitir/anular/transicionar.
 * Export diferido a PR-005 (placeholder deshabilitado, como el piloto Productos).
 */

import { useMemo } from "react";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon } from "@hugeicons/core-free-icons";

import { EnterpriseDataGrid } from "@/components/data-grid/enterprise-data-grid";
import { buttonVariants } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { convertirMonto, fmtMoney } from "@/lib/format";
import {
  type ComercialDocRow,
  esBorrador,
  esCancelado,
  esPendiente,
} from "@/lib/comercial/documentos";

import type { Moneda } from "../../../reportes/_components/moneda-toggle";
import { buildComercialColumns } from "./comercial-documentos-columns";

type Props = {
  documentos: ComercialDocRow[];
  moneda: Moneda;
  tc: string | null;
};

function toFilterOptions(values: readonly string[]): { value: string; label: string }[] {
  return Array.from(new Set(values.filter((v) => v.length > 0)))
    .sort()
    .map((v) => ({ value: v, label: v }));
}

function sumaPresentacion(rows: ComercialDocRow[], destino: Moneda, tc: string | null): string {
  const total = rows.reduce(
    (acc, d) => acc + Number(convertirMonto(d.total, d.moneda, destino, tc)),
    0,
  );
  return fmtMoney(total.toFixed(2));
}

export function ComercialDocumentosTable({ documentos, moneda, tc }: Props) {
  const columns = useMemo(() => buildComercialColumns({ moneda, tc }), [moneda, tc]);
  const estadoOptions = useMemo(
    () => toFilterOptions(documentos.map((d) => d.estado)),
    [documentos],
  );
  const clienteOptions = useMemo(
    () => toFilterOptions(documentos.map((d) => d.clienteNombre)),
    [documentos],
  );

  return (
    <EnterpriseDataGrid
      data={documentos}
      columns={columns}
      getRowId={(d) => d.key}
      quickSearch={{
        placeholder: "Buscar por número o cliente…",
        keys: ["numero", "clienteNombre"],
      }}
      filters={[
        {
          columnId: "tipo",
          label: "Tipo",
          options: [
            { value: "VENTA", label: "Venta" },
            { value: "PEDIDO", label: "Pedido" },
          ],
        },
        { columnId: "estado", label: "Status", options: estadoOptions },
        { columnId: "clienteNombre", label: "Cliente", options: clienteOptions },
        {
          columnId: "moneda",
          label: "Moneda",
          options: [
            { value: "ARS", label: "ARS" },
            { value: "USD", label: "USD" },
          ],
        },
      ]}
      savedViews={[
        { id: "todos", label: "Todos" },
        { id: "pendientes", label: "Pendientes", predicate: esPendiente },
        { id: "borradores", label: "Borradores", predicate: esBorrador },
        { id: "cancelados", label: "Cancelados", predicate: esCancelado },
      ]}
      enableRowSelection
      selectionSummary={(rows) =>
        `Suma ARS ${sumaPresentacion(rows, "ARS", tc)} · Suma USD ${sumaPresentacion(rows, "USD", tc)}`
      }
      bulkActions={() => (
        <DropdownMenuItem disabled>
          Exportar selección
          <span className="ml-auto pl-3 text-[10px] tracking-wide text-muted-foreground uppercase">
            PR-005
          </span>
        </DropdownMenuItem>
      )}
      emptyMessage="Aún no hay documentos comerciales."
      emptyFilteredMessage="No hay documentos para los filtros seleccionados."
      primaryAction={
        <div className="flex items-center gap-2">
          <Link href="/ventas/nueva" className={buttonVariants({ variant: "default" })}>
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
            Nueva venta
          </Link>
          <Link href="/ventas/pedidos/nuevo" className={buttonVariants({ variant: "outline" })}>
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
            Nuevo pedido
          </Link>
        </div>
      }
    />
  );
}
