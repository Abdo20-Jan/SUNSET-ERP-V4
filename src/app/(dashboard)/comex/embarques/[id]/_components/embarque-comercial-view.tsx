import { RecordField, RecordFieldGrid, RecordSection } from "@/components/record/record-section";
import { EntityLink } from "@/components/data-grid/entity-link";

import type { EmbarqueVista } from "./embarque-vista";

/*
 * EmbarqueComercialView (PR-021, CX-03 §9.4 #130) — aba "Comercial": proveedor,
 * incoterm y condiciones comerciales del embarque. PI/CI y la negociación formal
 * requieren el modelo documental de CX-07 (diferido) — se nota explícitamente.
 * Read-only, zero recálculo.
 */
type Props = { vista: EmbarqueVista };

export function EmbarqueComercialView({ vista }: Props) {
  return (
    <div className="flex flex-col gap-4">
      <RecordSection title="Proveedor y condiciones">
        <RecordFieldGrid>
          <RecordField label="Proveedor">
            <EntityLink
              label={vista.proveedorNombre}
              href={`/maestros/proveedores/${vista.proveedorId}`}
            />
          </RecordField>
          <RecordField label="Incoterm">{vista.incoterm ?? "—"}</RecordField>
          <RecordField label="Lugar incoterm">{vista.lugarIncoterm ?? "—"}</RecordField>
          <RecordField label="Moneda">{vista.moneda}</RecordField>
          <RecordField label="Días pago post-llegada">
            {vista.diasPagoDespuesLlegada != null ? `${vista.diasPagoDespuesLlegada} días` : "—"}
          </RecordField>
        </RecordFieldGrid>
      </RecordSection>

      <RecordSection title="Documentos comerciales (PI / CI)">
        <p className="text-sm text-muted-foreground">
          La Proforma Invoice (PI), la Commercial Invoice (CI) y la negociación formal con el
          proveedor requieren el modelo documental de CX-07 — no disponible en este Record
          (diferido).
        </p>
      </RecordSection>
    </div>
  );
}
