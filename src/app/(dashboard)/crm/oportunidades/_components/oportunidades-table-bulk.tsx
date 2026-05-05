"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { bulkAssignOportunidadesOwnerAction } from "@/lib/actions/oportunidades";
import { fmtDate, fmtMoney } from "@/lib/format";
import type { OportunidadEstado } from "@/generated/prisma/client";

import type { OportunidadRow } from "./oportunidades-table";

function estadoCls(estado: OportunidadEstado): string {
  if (estado === "GANADA") return "font-medium text-green-700";
  if (estado === "PERDIDA") return "text-red-700";
  if (estado === "EN_PAUSA") return "text-amber-700";
  return "";
}

function VinculoCell({ row }: { row: OportunidadRow }) {
  if (row.clienteNombre) {
    return (
      <Link href={`/maestros/clientes/${row.clienteId}`} className="text-primary hover:underline">
        {row.clienteNombre}
      </Link>
    );
  }
  if (row.leadId) {
    return (
      <Link href={`/crm/leads/${row.leadId}`} className="text-primary hover:underline">
        {row.leadEmpresa ?? row.leadNombre}
      </Link>
    );
  }
  return <>—</>;
}

export function OportunidadesTableBulk({
  ops,
  usuarios,
}: {
  ops: OportunidadRow[];
  usuarios: Array<{ id: string; nombre: string }>;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [ownerId, setOwnerId] = useState<string>(usuarios[0]?.id ?? "");
  const [isPending, startTransition] = useTransition();

  const allSelected = ops.length > 0 && selected.size === ops.length;
  const someSelected = selected.size > 0 && !allSelected;

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(ops.map((o) => o.id)));
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const aplicar = () => {
    if (selected.size === 0 || !ownerId) return;
    startTransition(async () => {
      const result = await bulkAssignOportunidadesOwnerAction({
        ids: Array.from(selected),
        ownerId,
      });
      if (!result.ok) {
        window.alert(`Error: ${result.error}`);
        return;
      }
      const ownerName = usuarios.find((u) => u.id === ownerId)?.nombre ?? "owner";
      window.alert(`${result.data.actualizados} oportunidad(es) asignada(s) a ${ownerName}.`);
      setSelected(new Set());
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-3">
          <span className="text-sm font-medium">{selected.size} seleccionada(s)</span>
          <select
            className="rounded-md border px-2 py-1 text-sm"
            value={ownerId}
            onChange={(e) => setOwnerId(e.target.value)}
            disabled={isPending || usuarios.length === 0}
          >
            {usuarios.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nombre}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={aplicar}
            disabled={isPending || !ownerId}
            className="rounded-md bg-primary px-3 py-1 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {isPending ? "Asignando..." : "Asignar owner"}
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            disabled={isPending}
            className="rounded-md border px-3 py-1 text-sm hover:bg-muted disabled:opacity-60"
          >
            Limpiar selección
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left">
            <tr>
              <th className="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected;
                  }}
                  onChange={toggleAll}
                  aria-label="Seleccionar todas"
                />
              </th>
              <th className="px-3 py-2">N°</th>
              <th className="px-3 py-2">Título</th>
              <th className="px-3 py-2 text-right">Monto</th>
              <th className="px-3 py-2">Stage</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2">Lead/Cliente</th>
              <th className="px-3 py-2">Owner</th>
              <th className="px-3 py-2">Cierre est.</th>
            </tr>
          </thead>
          <tbody>
            {ops.map((o) => (
              <tr key={o.id} className="border-t hover:bg-muted/50">
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(o.id)}
                    onChange={() => toggleOne(o.id)}
                    aria-label={`Seleccionar ${o.numero}`}
                  />
                </td>
                <td className="px-3 py-2 font-mono text-xs">
                  <Link
                    href={`/crm/oportunidades/${o.id}`}
                    className="text-primary hover:underline"
                  >
                    {o.numero}
                  </Link>
                </td>
                <td className="px-3 py-2">{o.titulo}</td>
                <td className="px-3 py-2 text-right font-medium">
                  {o.moneda} {fmtMoney(o.monto)}
                </td>
                <td className="px-3 py-2">{o.stageNombre}</td>
                <td className="px-3 py-2">
                  <span className={estadoCls(o.estado)}>{o.estado}</span>
                </td>
                <td className="px-3 py-2">
                  <VinculoCell row={o} />
                </td>
                <td className="px-3 py-2">{o.ownerNombre}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {o.cierreEstimado ? fmtDate(o.cierreEstimado) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
