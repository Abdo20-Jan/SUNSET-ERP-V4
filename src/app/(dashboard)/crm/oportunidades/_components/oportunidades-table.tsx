import Link from "next/link";

import { fmtDate, fmtMoney } from "@/lib/format";
import { OportunidadEstado } from "@/generated/prisma/client";

export type OportunidadRow = {
  id: string;
  numero: string;
  titulo: string;
  monto: string;
  moneda: string;
  stageId: string;
  stageNombre: string;
  stageOrden: number;
  probabilidad: number;
  cierreEstimado: Date | null;
  estado: OportunidadEstado;
  leadId: string | null;
  leadNombre: string | null;
  leadEmpresa: string | null;
  clienteId: string | null;
  clienteNombre: string | null;
  ownerId: string;
  ownerNombre: string;
};

function estadoCls(estado: OportunidadEstado): string {
  if (estado === OportunidadEstado.GANADA) return "font-medium text-green-700";
  if (estado === OportunidadEstado.PERDIDA) return "text-red-700";
  if (estado === OportunidadEstado.EN_PAUSA) return "text-amber-700";
  return "";
}

function VinculoCell({ row }: { row: OportunidadRow }) {
  if (row.clienteNombre) {
    return (
      <Link
        href={`/maestros/clientes/${row.clienteId}`}
        className="text-primary hover:underline"
      >
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

export function OportunidadesTable({ ops }: { ops: OportunidadRow[] }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted text-left">
          <tr>
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
              <td className="px-3 py-2 font-mono text-xs">
                <Link href={`/crm/oportunidades/${o.id}`} className="text-primary hover:underline">
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
  );
}
