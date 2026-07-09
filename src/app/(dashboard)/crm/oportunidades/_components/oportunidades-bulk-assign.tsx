"use client";

/**
 * Asignación masiva de owner (CRM-01 · PR-030). Reemplaza la barra ad-hoc de
 * `oportunidades-table-bulk.tsx` por el patrón del grid: item en el menú
 * "Acción en masa" → diálogo de confirmación con select de usuarios →
 * `bulkAssignOportunidadesOwnerAction` (payload BYTE-IDÉNTICO al contrato
 * existente: `{ ids, ownerId }`).
 *
 * El Dialog vive FUERA del DropdownMenuContent (hoisted en la worklist, mismo
 * patrón de `anticipos-table.tsx`): el popup del menú base-ui se desmonta al
 * cerrarse y mataría un diálogo hospedado adentro.
 */

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { bulkAssignOportunidadesOwnerAction } from "@/lib/actions/oportunidades";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { OportunidadWorklistRow } from "./oportunidades-presentacion";

export type UsuarioAsignable = { id: string; nombre: string };

/** Item del menú de acción en masa; el diálogo lo abre el contenedor. */
export function BulkAssignOwnerMenuItem({ onSelect }: { onSelect: () => void }) {
  return <DropdownMenuItem onClick={onSelect}>Asignar owner…</DropdownMenuItem>;
}

export function BulkAssignOwnerDialog({
  rows,
  usuarios,
  onClose,
  onDone,
}: {
  /** Snapshot de filas seleccionadas al abrir; `null` = diálogo cerrado. */
  rows: OportunidadWorklistRow[] | null;
  usuarios: UsuarioAsignable[];
  onClose: () => void;
  onDone: () => void;
}) {
  const router = useRouter();
  const [ownerId, setOwnerId] = useState<string>("");
  const [pending, start] = useTransition();

  const open = rows !== null && rows.length > 0;

  const cerrar = () => {
    setOwnerId("");
    onClose();
  };

  const aplicar = () => {
    if (!rows || !ownerId) return;
    start(async () => {
      // Payload byte-idéntico al consumidor anterior: { ids, ownerId }.
      const result = await bulkAssignOportunidadesOwnerAction({
        ids: rows.map((r) => r.id),
        ownerId,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const nombre = usuarios.find((u) => u.id === ownerId)?.nombre ?? "owner";
      toast.success(`${result.data.actualizados} oportunidad(es) asignada(s) a ${nombre}.`);
      setOwnerId("");
      onClose();
      onDone();
      router.refresh();
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) cerrar();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Asignar owner</DialogTitle>
          <DialogDescription>
            {rows?.length ?? 0} oportunidad(es) seleccionada(s) pasarán al owner elegido.
          </DialogDescription>
        </DialogHeader>

        <Select value={ownerId} onValueChange={(v) => setOwnerId(v ?? "")} disabled={pending}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Elegí un usuario…" />
          </SelectTrigger>
          <SelectContent>
            {usuarios.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={cerrar} disabled={pending}>
            Cancelar
          </Button>
          <Button type="button" onClick={aplicar} disabled={pending || !ownerId}>
            {pending ? "Asignando…" : "Asignar owner"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
