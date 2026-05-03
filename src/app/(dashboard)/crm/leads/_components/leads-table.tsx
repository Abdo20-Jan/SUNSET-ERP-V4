import Link from "next/link";

import { fmtDate } from "@/lib/format";
import type { LeadRow } from "@/lib/actions/leads";
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
    <Link
      href={`/maestros/clientes/${clienteId}`}
      className="text-primary hover:underline"
    >
      {clienteNombre}
    </Link>
  );
}

export function LeadsTable({ leads }: { leads: LeadRow[] }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted text-left">
          <tr>
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
              <td className="px-3 py-2 text-xs text-muted-foreground">
                {fmtDate(l.createdAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
