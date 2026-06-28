import type { DespachoListRow } from "@/lib/actions/despachos";
import { fmtDateOrDash, fmtMoney } from "@/lib/format";
import { StatusBadge } from "@/components/ui/status-badge";
import { RecordField, RecordFieldGrid, RecordSection } from "@/components/record/record-section";
import { EntityLink } from "@/components/data-grid/entity-link";

import type { EmbarqueFinanciero, EmbarqueVista } from "./embarque-vista";

/*
 * EmbarqueAduanaView (PR-021, CX-03 §9.6) — aba "Aduana": Despachos · Tributos ·
 * Documentos. Despachos LINKA à subrota existente `[id]/despachos` (NÃO recria o
 * fluxo). Tributos é GATED (vem só em `financiero`). Documentos aduaneiros (CX-07)
 * não têm modelo hoje → omitido com nota. Read-only, zero recálculo (CRIT-04/05).
 */
type Props = {
  vista: EmbarqueVista;
  financiero: EmbarqueFinanciero | null;
  despachos: DespachoListRow[];
};

function DespachosBlock({
  vista,
  despachos,
}: {
  vista: EmbarqueVista;
  despachos: DespachoListRow[];
}) {
  return (
    <RecordSection
      title="Despachos"
      actions={
        <EntityLink label="Gestionar despachos" href={`/comex/embarques/${vista.id}/despachos`} />
      }
    >
      {despachos.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aún no se generaron despachos.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-[13px]">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-2.5 py-1.5 text-left">Código</th>
                <th className="px-2.5 py-1.5 text-left">Fecha</th>
                <th className="px-2.5 py-1.5 text-left">Nº OM</th>
                <th className="px-2.5 py-1.5 text-right">Ítems</th>
                <th className="px-2.5 py-1.5 text-right">Facturas</th>
                <th className="px-2.5 py-1.5 text-left">Estado</th>
                <th className="px-2.5 py-1.5 text-left">Asiento</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {despachos.map((d) => (
                <tr key={d.id}>
                  <td className="px-2.5 py-1.5 font-mono">{d.codigo}</td>
                  <td className="px-2.5 py-1.5">{fmtDateOrDash(d.fecha)}</td>
                  <td className="px-2.5 py-1.5 font-mono text-xs">{d.numeroOM ?? "—"}</td>
                  <td className="px-2.5 py-1.5 text-right">{d.itemsCount}</td>
                  <td className="px-2.5 py-1.5 text-right">{d.facturasCount}</td>
                  <td className="px-2.5 py-1.5">
                    <StatusBadge estado={d.estado} />
                  </td>
                  <td className="px-2.5 py-1.5 font-mono text-xs">
                    {d.asiento ? `#${d.asiento.numero}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </RecordSection>
  );
}

function TributosBlock({ financiero }: { financiero: EmbarqueFinanciero | null }) {
  if (!financiero) {
    return (
      <RecordSection title="Tributos">
        <p className="text-sm text-muted-foreground">
          — · requiere permiso de costo landed (<code className="text-xs">costos.verLanded</code>).
        </p>
      </RecordSection>
    );
  }
  const m = financiero.moneda;
  return (
    <RecordSection
      title="Tributos del embarque"
      description="Valores ingresados en moneda del embarque."
    >
      <RecordFieldGrid>
        <RecordField label="DIE">{`${m} ${fmtMoney(financiero.die)}`}</RecordField>
        <RecordField label="Tasa estadística">{`${m} ${fmtMoney(financiero.tasaEstadistica)}`}</RecordField>
        <RecordField label="Arancel SIM">{`${m} ${fmtMoney(financiero.arancelSim)}`}</RecordField>
        <RecordField label="IVA">{`${m} ${fmtMoney(financiero.iva)}`}</RecordField>
        <RecordField label="IVA adicional">{`${m} ${fmtMoney(financiero.ivaAdicional)}`}</RecordField>
        <RecordField label="IIBB">{`${m} ${fmtMoney(financiero.iibb)}`}</RecordField>
        <RecordField label="Ganancias">{`${m} ${fmtMoney(financiero.ganancias)}`}</RecordField>
      </RecordFieldGrid>
      <p className="mt-2 text-[11px] text-muted-foreground">
        DIE / Tasa / Arancel capitalizan al costo; IVA / IIBB / Ganancias son cash-out / crédito
        recuperable, no costo (CRIT-09).
      </p>
    </RecordSection>
  );
}

function DocumentosBlock() {
  return (
    <RecordSection title="Documentos aduaneros">
      <p className="text-sm text-muted-foreground">
        El checklist documental aduanero (despacho oficial, comprobantes de tributos, documentos del
        despachante) requiere el modelo documental de CX-07 — no disponible en este Record
        (diferido).
      </p>
    </RecordSection>
  );
}

export function EmbarqueAduanaView({ vista, financiero, despachos }: Props) {
  return (
    <div className="flex flex-col gap-4">
      <DespachosBlock vista={vista} despachos={despachos} />
      <TributosBlock financiero={financiero} />
      <DocumentosBlock />
    </div>
  );
}
