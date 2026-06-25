import type { AuditEntry } from "@/lib/services/auditoria";
import { diffAuditoria } from "@/lib/auditoria-diff";

type AccionMeta = { label: string; dot: string };

const ACCION_META: Record<string, AccionMeta> = {
  CREATE: { label: "Creó", dot: "bg-emerald-500" },
  UPDATE: { label: "Modificó", dot: "bg-indigo-500" },
  DELETE: { label: "Eliminó", dot: "bg-rose-500" },
  CAMBIO_ESTADO: { label: "Cambió estado", dot: "bg-amber-500" },
  APROBACION: { label: "Aprobó", dot: "bg-emerald-500" },
  CANCELACION: { label: "Canceló", dot: "bg-rose-500" },
  EXPORTACION: { label: "Exportó", dot: "bg-sky-500" },
  VISUALIZACION_SENSIBLE: { label: "Vio dato sensible", dot: "bg-violet-500" },
  MASTER_OVERRIDE: { label: "Override master", dot: "bg-rose-600" },
};

// Etiqueta legible del origen. MANUAL no se dibuja (es el caso por defecto y
// no aporta información en la línea de tiempo).
const ORIGEN_LABEL: Record<string, string> = {
  IMPORTACION: "Importación",
  AUTOMACION: "Automatización",
  API: "API",
  MASTER_OVERRIDE: "Master override",
};

function fechaHora(d: Date): string {
  return d.toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Metadata aditiva (PR-008): origen (sólo si ≠ MANUAL), IP (si presente) en la
// línea superior; motivo (si presente) en una línea propia debajo. Cuando los
// tres faltan (filas previas), no renderiza nada → vista idéntica a antes.
function EntryMeta({
  origen,
  ip,
  motivo,
}: {
  origen: string;
  ip: string | null;
  motivo: string | null;
}) {
  const origenLabel = ORIGEN_LABEL[origen];
  return (
    <>
      {origenLabel && (
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {origenLabel}
        </span>
      )}
      {ip && <span className="text-xs text-muted-foreground">· IP {ip}</span>}
      {motivo && (
        <span className="basis-full text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Motivo</span>: {motivo}
        </span>
      )}
    </>
  );
}

// Línea de tiempo del historial de cambios de un record (AuditLog). Cada entry
// muestra acción + autor + fecha y el diff de campos (datosAnteriores→Nuevos).
export function AuditTrail({ entries }: { entries: AuditEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        Sin historial de cambios.
      </p>
    );
  }

  return (
    <ol className="flex flex-col gap-4">
      {entries.map((entry) => {
        const meta = ACCION_META[entry.accion] ?? {
          label: entry.accion,
          dot: "bg-muted-foreground",
        };
        const diffs = diffAuditoria(entry.datosAnteriores, entry.datosNuevos);
        return (
          <li key={entry.id} className="flex gap-3">
            <div className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${meta.dot}`} aria-hidden />
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
                <span className="font-medium">{meta.label}</span>
                <span className="text-xs text-muted-foreground">
                  por {entry.usuario} · {fechaHora(entry.fecha)}
                </span>
                <EntryMeta origen={entry.origen} ip={entry.ip} motivo={entry.motivo} />
              </div>
              {diffs.length > 0 && (
                <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                  {diffs.map((d) => (
                    <li key={d.campo}>
                      <span className="font-medium text-foreground">{d.campo}</span>:{" "}
                      {d.antes ?? "—"} → {d.despues ?? "—"}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
