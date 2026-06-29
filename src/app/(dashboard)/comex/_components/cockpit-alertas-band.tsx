import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { AlertCircleIcon } from "@hugeicons/core-free-icons";

import type { ProcesoCriticoItem } from "@/lib/services/comex-cockpit";

/**
 * Banda de alertas críticos (CX-01 §9-7): roja, sticky, con contador + hasta 3
 * ejemplos enlazados al proceso. Se OCULTA por completo cuando no hay alertas
 * (no desperdicia espacio) — el caller no la renderiza si la lista viene vacía.
 */
export function CockpitAlertasBand({ criticos }: { criticos: ProcesoCriticoItem[] }) {
  if (criticos.length === 0) return null;
  const ejemplos = criticos.slice(0, 3);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive">
      <span className="flex items-center gap-1.5 text-[13px] font-semibold">
        <HugeiconsIcon icon={AlertCircleIcon} className="size-4" strokeWidth={2} />
        {criticos.length} {criticos.length === 1 ? "alerta crítico" : "alertas críticos"}
      </span>
      <span className="flex flex-wrap items-center gap-1.5">
        {ejemplos.map((c) => (
          <Link
            key={c.id}
            href={`/comex/embarques/${c.id}`}
            className="rounded border border-destructive/30 bg-background/60 px-1.5 py-0.5 text-[11px] font-medium underline-offset-2 hover:underline"
            title={c.motivo}
          >
            {c.codigo} · {c.motivo}
          </Link>
        ))}
      </span>
      <Link
        href="/comex/embarques"
        className="ml-auto shrink-0 text-[11px] font-semibold underline-offset-2 hover:underline"
      >
        Ver procesos →
      </Link>
    </div>
  );
}
