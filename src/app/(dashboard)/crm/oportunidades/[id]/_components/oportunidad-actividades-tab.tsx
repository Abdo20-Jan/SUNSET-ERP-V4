import { RecordSection } from "@/components/record/record-section";
import { fmtDate } from "@/lib/format";
import type { getOportunidad } from "@/lib/actions/oportunidades";

import { CompletarButton } from "@/app/(dashboard)/crm/actividades/_components/completar-button";
import { RegistrarActividadWindow } from "@/app/(dashboard)/crm/_components/registrar-actividad-window";

/*
 * Pestaña Actividades del record de oportunidad (CRM-01 · PR-030). Lista
 * read-only MIGRADA VERBATIM de la sección "Actividades" de la page anterior
 * + header con `RegistrarActividadWindow` (componente compartido de la mitad
 * Leads, target polimórfico `{ oportunidadId }`) y `CompletarButton`
 * (importado verbatim de crm/actividades) en las pendientes.
 */

type OportunidadDetalle = NonNullable<Awaited<ReturnType<typeof getOportunidad>>>;
type ActividadItem = OportunidadDetalle["actividades"][number];

function ActividadLinea({ a }: { a: ActividadItem }) {
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
          {a.owner.nombre} · {a.fechaProgramada ? fmtDate(a.fechaProgramada) : "sin fecha"}
        </div>
      </div>
      {!a.completada && <CompletarButton actividadId={a.id} />}
    </li>
  );
}

export function OportunidadActividadesTab({
  oportunidadId,
  actividades,
}: {
  oportunidadId: string;
  actividades: ActividadItem[];
}) {
  return (
    <RecordSection
      title={`Actividades (${actividades.length})`}
      actions={
        <RegistrarActividadWindow target={{ oportunidadId }} triggerLabel="Registrar actividad" />
      }
    >
      {actividades.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin actividades.</p>
      ) : (
        <ul className="space-y-2">
          {actividades.map((a) => (
            <ActividadLinea key={a.id} a={a} />
          ))}
        </ul>
      )}
    </RecordSection>
  );
}
