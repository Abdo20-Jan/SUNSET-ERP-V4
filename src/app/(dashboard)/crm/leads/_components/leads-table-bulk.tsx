"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { bulkUpdateLeadsEstadoAction } from "@/lib/actions/leads";
import type { LeadRow } from "@/lib/actions/leads";
import { LEAD_ESTADOS } from "@/lib/crm-enums";
import { fmtDate } from "@/lib/format";
import { LeadEstado } from "@/generated/prisma/client";

function estadoCls(estado: LeadEstado): string {
  if (estado === LeadEstado.CONVERTIDO) return "font-medium text-green-700";
  if (estado === LeadEstado.DESCALIFICADO) return "text-red-700";
  if (estado === LeadEstado.CALIFICADO) return "font-medium text-blue-700";
  return "";
}

function ClienteCell({
  clienteId,
  clienteNombre,
}: {
  clienteId: string | null;
  clienteNombre: string | null;
}) {
  if (!clienteId) return <>—</>;
  return (
    <Link href={`/maestros/clientes/${clienteId}`} className="text-primary hover:underline">
      {clienteNombre}
    </Link>
  );
}

export function LeadsTableBulk({ leads }: { leads: LeadRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [estado, setEstado] = useState<LeadEstado>(LeadEstado.CALIFICADO);
  const [isPending, startTransition] = useTransition();

  const allSelected = leads.length > 0 && selected.size === leads.length;
  const someSelected = selected.size > 0 && !allSelected;

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(leads.map((l) => l.id)));
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
    if (selected.size === 0) return;
    startTransition(async () => {
      const result = await bulkUpdateLeadsEstadoAction({
        ids: Array.from(selected),
        estado,
      });
      if (!result.ok) {
        window.alert(`Error: ${result.error}`);
        return;
      }
      window.alert(`${result.data.actualizados} lead(s) actualizado(s) a ${estado}.`);
      setSelected(new Set());
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-3">
          <span className="text-sm font-medium">{selected.size} seleccionado(s)</span>
          <select
            className="rounded-md border px-2 py-1 text-sm"
            value={estado}
            onChange={(e) => setEstado(e.target.value as LeadEstado)}
            disabled={isPending}
          >
            {LEAD_ESTADOS.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={aplicar}
            disabled={isPending}
            className="rounded-md bg-primary px-3 py-1 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {isPending ? "Aplicando..." : "Cambiar estado"}
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
                  aria-label="Seleccionar todos"
                />
              </th>
              <th className="px-3 py-2">Nombre</th>
              <th className="px-3 py-2">Empresa</th>
              <th className="px-3 py-2">CUIT</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Fuente</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2 text-right">Score</th>
              <th className="px-3 py-2">Owner</th>
              <th className="px-3 py-2">Cliente</th>
              <th className="px-3 py-2">Creado</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id} className="border-t hover:bg-muted/50">
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(l.id)}
                    onChange={() => toggleOne(l.id)}
                    aria-label={`Seleccionar ${l.nombre}`}
                  />
                </td>
                <td className="px-3 py-2">
                  <Link href={`/crm/leads/${l.id}`} className="text-primary hover:underline">
                    {l.nombre}
                  </Link>
                </td>
                <td className="px-3 py-2">{l.empresa ?? "—"}</td>
                <td className="px-3 py-2 font-mono text-xs">{l.cuit ?? "—"}</td>
                <td className="px-3 py-2">{l.email ?? "—"}</td>
                <td className="px-3 py-2">{l.fuente}</td>
                <td className="px-3 py-2">
                  <span className={estadoCls(l.estado)}>{l.estado}</span>
                </td>
                <td className="px-3 py-2 text-right">{l.score}</td>
                <td className="px-3 py-2">{l.ownerNombre}</td>
                <td className="px-3 py-2">
                  <ClienteCell clienteId={l.clienteId} clienteNombre={l.clienteNombre} />
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDate(l.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
