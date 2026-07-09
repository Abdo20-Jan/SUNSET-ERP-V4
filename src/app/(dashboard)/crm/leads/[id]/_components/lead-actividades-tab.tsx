/**
 * Pestaña Actividades del record de lead (CRM-01 · PR-030). Server-safe:
 * timeline de `getLead().actividades` EN EL ORDEN recibido (pendientes
 * primero, por fechaProgramada asc — orden de la propia query). Completar
 * reutiliza `CompletarButton` VERBATIM (`completarActividadAction` intacta);
 * registrar abre la ventana compartida `RegistrarActividadWindow`.
 */

import { RecordSection } from "@/components/record/record-section";
import { fmtDate } from "@/lib/format";

import { CompletarButton } from "../../../actividades/_components/completar-button";
import { RegistrarActividadWindow } from "../../../_components/registrar-actividad-window";
import type { LeadDetalle } from "./lead-resumen-tab";

type Actividad = LeadDetalle["actividades"][number];

function fechaLinea(a: Actividad): string {
  const prog = a.fechaProgramada ? fmtDate(a.fechaProgramada) : "sin fecha";
  if (a.completada && a.fechaCompletada) return `${prog} · ✓ ${fmtDate(a.fechaCompletada)}`;
  return prog;
}

function ActividadItem({ a }: { a: Actividad }) {
  return (
    <li className="flex items-start justify-between gap-3 rounded-md border p-3 text-sm">
      <div className="min-w-0">
        <div>
          <span className="font-mono text-xs">{a.tipo}</span> ·{" "}
          <span className={a.completada ? "text-muted-foreground line-through" : ""}>
            {a.contenido}
          </span>
        </div>
        <div className="text-xs text-muted-foreground">
          {a.owner.nombre} · {fechaLinea(a)}
        </div>
      </div>
      {!a.completada && <CompletarButton actividadId={a.id} />}
    </li>
  );
}

function ActividadesList({ actividades }: { actividades: Actividad[] }) {
  if (actividades.length === 0) {
    return <p className="text-sm text-muted-foreground">Sin actividades.</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {actividades.map((a) => (
        <ActividadItem key={a.id} a={a} />
      ))}
    </ul>
  );
}

export function LeadActividadesTab({
  leadId,
  actividades,
}: {
  leadId: string;
  actividades: Actividad[];
}) {
  return (
    <RecordSection title="Actividades" actions={<RegistrarActividadWindow target={{ leadId }} />}>
      <ActividadesList actividades={actividades} />
    </RecordSection>
  );
}
