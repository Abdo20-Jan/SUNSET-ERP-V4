import { fmtMoney } from "@/lib/format";
import { RecordSection } from "@/components/record/record-section";

import type { ClasificacionTributo, TributoRow } from "../costos-vista";

const BADGE: Record<ClasificacionTributo, { label: string; className: string }> = {
  CAPITALIZABLE: {
    label: "Capitalizable en stock",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  CREDITO_FISCAL: {
    label: "Crédito fiscal",
    className: "border-blue-200 bg-blue-50 text-blue-700",
  },
  PERCEPCION_RECUPERABLE: {
    label: "Percepción recuperable",
    className: "border-blue-200 bg-blue-50 text-blue-700",
  },
};

function ClasificacionBadge({ clasificacion }: { clasificacion: ClasificacionTributo }) {
  const b = BADGE[clasificacion];
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] ${b.className}`}
    >
      {b.label}
    </span>
  );
}

/** Tributos/percepciones clasificados (CRIT-06/§9-funcional 10): DIE/Tasa/Arancel
 * capitalizan; IVA/IIBB/Ganancias son crédito/percepción recuperable = cash-out,
 * NO costo del producto. */
export function CostoTributosPercepciones({ tributos }: { tributos: TributoRow[] }) {
  return (
    <RecordSection
      title="Tributos y percepciones"
      description="IVA, IVA adicional, IIBB y Ganancias son cash-out / crédito recuperable — no costo del producto."
    >
      <div className="overflow-hidden rounded-md border">
        <table className="w-full text-[13px]">
          <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-2.5 py-1.5 text-left">Tributo</th>
              <th className="px-2.5 py-1.5 text-left">Clasificación</th>
              <th className="px-2.5 py-1.5 text-right">ARS</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {tributos.map((t) => (
              <tr key={t.label}>
                <td className="px-2.5 py-1.5">{t.label}</td>
                <td className="px-2.5 py-1.5">
                  <ClasificacionBadge clasificacion={t.clasificacion} />
                </td>
                <td className="px-2.5 py-1.5 text-right tabular-nums">{fmtMoney(t.valor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </RecordSection>
  );
}
