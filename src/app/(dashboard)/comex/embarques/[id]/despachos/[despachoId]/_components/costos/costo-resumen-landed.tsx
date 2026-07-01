import { fmtMoney } from "@/lib/format";
import { RecordField, RecordFieldGrid, RecordSection } from "@/components/record/record-section";

import type { ComponentesCosto } from "../costos-vista";

const BASE_LABEL: Record<"FOB" | "CANTIDAD", string> = {
  FOB: "Prorrateo por base FOB",
  CANTIDAD: "Prorrateo por cantidad (FOB total = 0)",
};

/** Encabezado del costo: total landed + base de prorrateo (badge a nivel
 * despacho, NO por línea → la memoria detallada es PR-023c). */
export function CostoResumenLanded({
  componentes,
  baseRateio,
}: {
  componentes: ComponentesCosto;
  baseRateio: "FOB" | "CANTIDAD";
}) {
  return (
    <RecordSection
      title="Resumen landed"
      description="Costo landed del despacho — valores del motor de rateio (read-only, sin recálculo)."
    >
      <div className="mb-2">
        <span className="inline-flex items-center rounded-md border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
          {BASE_LABEL[baseRateio]}
        </span>
      </div>
      <RecordFieldGrid>
        <RecordField label="Costo total landed (ARS)">{fmtMoney(componentes.total)}</RecordField>
        <RecordField label="FOB nacionalizado (ARS)">
          {fmtMoney(componentes.nacionalizado)}
        </RecordField>
        <RecordField label="Capitalizables (ARS)">
          {fmtMoney(componentes.capitalizables)}
        </RecordField>
      </RecordFieldGrid>
    </RecordSection>
  );
}
