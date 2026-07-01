import { RecordSection } from "@/components/record/record-section";

import type { Consistencia, ConsistenciaResultado } from "../costos-vista";

function describir(r: ConsistenciaResultado): { text: string; className: string } {
  switch (r.kind) {
    case "PREVIEW":
      return {
        text: "Preview — costo aún no persistido (contabilizá para verificar)",
        className: "border-border bg-muted text-muted-foreground",
      };
    case "NO_APLICA":
      return { text: "No disponible", className: "border-border bg-muted text-muted-foreground" };
    case "CONSISTENTE":
      return {
        text: `Consistente (Δ ARS ${r.delta})`,
        className: "border-emerald-200 bg-emerald-50 text-emerald-700",
      };
    case "DISCREPANCIA":
      return {
        text: `Discrepancia: ARS ${r.delta}`,
        className: "border-amber-200 bg-amber-50 text-amber-700",
      };
  }
}

function Fila({ label, resultado }: { label: string; resultado: ConsistenciaResultado }) {
  const d = describir(resultado);
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-[13px]">{label}</span>
      <span
        className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] ${d.className}`}
      >
        {d.text}
      </span>
    </div>
  );
}

/** Indicador de consistencia DISPLAY-only (NO bloquea el cierre, a diferencia del
 * cierre real del motor): costo calculado (memoria) vs costo persistido (stock)
 * y vs asiento (DEBE mercadería). */
export function CostoConsistencia({ consistencia }: { consistencia: Consistencia }) {
  return (
    <RecordSection
      title="Consistencia de costo"
      description="Verificación de display — el costo calculado por la memoria contra lo persistido y el asiento. No bloquea el cierre."
    >
      <div className="divide-y">
        <Fila
          label="Memoria ≡ costo persistido (stock NACIONAL)"
          resultado={consistencia.persistido}
        />
        <Fila label="Memoria ≡ asiento (DEBE mercadería)" resultado={consistencia.asiento} />
      </div>
    </RecordSection>
  );
}
