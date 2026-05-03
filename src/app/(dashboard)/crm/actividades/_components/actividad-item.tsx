import Link from "next/link";

import { fmtDate } from "@/lib/format";

import { CompletarButton } from "./completar-button";

type ActividadVinculos = {
  lead: { id: string; nombre: string; empresa: string | null } | null;
  cliente: { id: string; nombre: string } | null;
  oportunidad: { id: string; numero: string; titulo: string } | null;
};

type ActividadCard = ActividadVinculos & {
  id: string;
  tipo: string;
  contenido: string;
  fechaProgramada: Date | null;
};

function VinculoChips({ a }: { a: ActividadVinculos }) {
  return (
    <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
      {a.lead && (
        <Link
          href={`/crm/leads/${a.lead.id}`}
          className="rounded bg-muted px-2 py-0.5 hover:bg-muted-foreground/10"
        >
          Lead: {a.lead.empresa ?? a.lead.nombre}
        </Link>
      )}
      {a.cliente && (
        <Link
          href={`/maestros/clientes/${a.cliente.id}`}
          className="rounded bg-muted px-2 py-0.5 hover:bg-muted-foreground/10"
        >
          Cliente: {a.cliente.nombre}
        </Link>
      )}
      {a.oportunidad && (
        <Link
          href={`/crm/oportunidades/${a.oportunidad.id}`}
          className="rounded bg-muted px-2 py-0.5 hover:bg-muted-foreground/10"
        >
          Op: {a.oportunidad.numero}
        </Link>
      )}
    </div>
  );
}

function FechaLabel({
  fecha,
  ahora,
}: {
  fecha: Date | null;
  ahora: number;
}) {
  if (!fecha) {
    return <>Sin fecha programada</>;
  }
  const atrasada = fecha.getTime() < ahora;
  return (
    <span className={atrasada ? "text-red-700" : ""}>
      {fmtDate(fecha)}
      {atrasada ? " · ATRASADA" : ""}
    </span>
  );
}

export function ActividadItem({
  a,
  ahora,
}: {
  a: ActividadCard;
  ahora: number;
}) {
  return (
    <li className="rounded-md border p-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div>
            <span className="font-mono text-xs">{a.tipo}</span> · {a.contenido}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            <FechaLabel fecha={a.fechaProgramada} ahora={ahora} />
          </div>
          <VinculoChips a={a} />
        </div>
        <CompletarButton actividadId={a.id} />
      </div>
    </li>
  );
}
