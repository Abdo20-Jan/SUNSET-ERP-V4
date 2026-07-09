"use client";

/**
 * Worklist de leads sobre EnterpriseDataGrid (CRM-01 · PR-030). Espejo de
 * `compras-worklist.tsx` (PR-029), patrón anti dupla-paginación: la paginación
 * REAL es la server externa (`<Pagination>` llega como `children` y vive
 * dentro de la misma Card); `pageSize >= rows.length` para que el grid NO
 * pagine por encima de la página server; la busca rápida opera sólo sobre la
 * página visible (placeholder honesto).
 *
 * Acción en masa: cambio de estado vía `bulkUpdateLeadsEstadoAction` (MISMO
 * payload que la tabla legada `leads-table-bulk` que esta worklist
 * reemplaza), con Dialog de confirmación. Tras aplicar, se re-monta el grid
 * (`key`) para limpiar la selección. Export auditado via `primaryAction`.
 */

import { type ReactNode, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { EnterpriseDataGrid } from "@/components/data-grid/enterprise-data-grid";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import type { LeadEstado } from "@/generated/prisma/client";
import { bulkUpdateLeadsEstadoAction } from "@/lib/actions/leads";
import { LEAD_ESTADOS } from "@/lib/crm-enums";

import { buildLeadsColumns } from "./leads-columns";
import { LeadsExportButton } from "./leads-export-button";
import type { LeadWorklistRow } from "./leads-presentacion";

type CambioEstado = { estado: LeadEstado; ids: string[] };

type Props = {
  rows: LeadWorklistRow[];
  emptyMessage: string;
  /** `<Pagination>` server externa — se rinde debajo del grid, misma Card. */
  children?: ReactNode;
};

// Items del menú de acción en masa: un «Cambiar a …» por estado del enum.
// Helper nombrado (gotcha Lizard).
function buildBulkItems(
  seleccion: LeadWorklistRow[],
  onPick: (cambio: CambioEstado) => void,
): ReactNode {
  return LEAD_ESTADOS.map((estado) => (
    <DropdownMenuItem
      key={estado}
      onClick={() => onPick({ estado, ids: seleccion.map((r) => r.id) })}
    >
      Cambiar a {estado}
    </DropdownMenuItem>
  ));
}

function resumenSeleccion(seleccion: LeadWorklistRow[]): string {
  return `${seleccion.length} lead(s) en esta página`;
}

function ConfirmarCambioDialog({
  cambio,
  pending,
  onConfirm,
  onCancel,
}: {
  cambio: CambioEstado | null;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      open={cambio !== null}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cambiar estado en masa</DialogTitle>
          <DialogDescription>
            {cambio ? `¿Cambiar ${cambio.ids.length} lead(s) a ${cambio.estado}?` : ""}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="button" disabled={pending} onClick={onConfirm}>
            {pending ? "Aplicando…" : "Confirmar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function LeadsWorklist({ rows, emptyMessage, children }: Props) {
  const router = useRouter();
  const columns = useMemo(() => buildLeadsColumns(), []);
  // Bump de `gridKey` re-monta el grid → limpia la selección tras la acción
  // en masa (el estado de selección vive dentro del EnterpriseDataGrid).
  const [gridKey, setGridKey] = useState(0);
  const [cambio, setCambio] = useState<CambioEstado | null>(null);
  const [pending, start] = useTransition();

  const aplicarCambio = () => {
    if (!cambio) return;
    start(async () => {
      // Payload idéntico al de la tabla legada: { ids, estado }.
      const r = await bulkUpdateLeadsEstadoAction({ ids: cambio.ids, estado: cambio.estado });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`${r.data.actualizados} lead(s) actualizado(s) a ${cambio.estado}.`);
      setCambio(null);
      setGridKey((k) => k + 1);
      router.refresh();
    });
  };

  return (
    <Card className="py-0 p-3">
      <EnterpriseDataGrid
        key={gridKey}
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        quickSearch={{
          placeholder: "Filtrar esta página… (búsqueda global arriba)",
          keys: ["nombre", "empresa", "cuit", "email"],
        }}
        enableRowSelection
        selectionSummary={resumenSeleccion}
        bulkActions={(seleccion) => buildBulkItems(seleccion, setCambio)}
        primaryAction={<LeadsExportButton />}
        exportSurface={false}
        pageSize={Math.max(200, rows.length)}
        emptyMessage={emptyMessage}
        emptyFilteredMessage="Sin leads que coincidan con el filtro de esta página."
      />
      {children}

      <ConfirmarCambioDialog
        cambio={cambio}
        pending={pending}
        onConfirm={aplicarCambio}
        onCancel={() => setCambio(null)}
      />
    </Card>
  );
}
