import type { AuditEntry } from "@/lib/services/auditoria";
import { diffAuditoria } from "@/lib/auditoria-diff";

type AccionMeta = { label: string; dot: string };

const ACCION_META: Record<string, AccionMeta> = {
  CREATE: { label: "Creó", dot: "bg-emerald-500" },
  UPDATE: { label: "Modificó", dot: "bg-indigo-500" },
  DELETE: { label: "Eliminó", dot: "bg-rose-500" },
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
              <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <span className="font-medium">{meta.label}</span>
                <span className="text-xs text-muted-foreground">
                  por {entry.usuario} · {fechaHora(entry.fecha)}
                </span>
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
