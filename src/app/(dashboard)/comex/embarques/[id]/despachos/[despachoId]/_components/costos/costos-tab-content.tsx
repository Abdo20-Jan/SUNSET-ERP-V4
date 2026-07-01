import { fmtMoney } from "@/lib/format";
import { RecordField, RecordFieldGrid, RecordSection } from "@/components/record/record-section";

import type { CostosVista } from "../costos-vista";
import { CostoConsistencia } from "./costo-consistencia";
import { CostoFacturasVinculadas } from "./costo-facturas-vinculadas";
import { CostoPorItem } from "./costo-por-item";
import { CostoResumenLanded } from "./costo-resumen-landed";
import { CostoTotalesComponente } from "./costo-totales-componente";
import { CostoTributosPercepciones } from "./costo-tributos-percepciones";

const COSTO_OCULTO = "Valores de costo ocultos — requiere el permiso «Ver costo landed».";

function MensajeSimple({ mensaje }: { mensaje: string }) {
  return (
    <RecordSection title="Costos">
      <p className="text-[12px] text-muted-foreground">{mensaje}</p>
    </RecordSection>
  );
}

function CostosLegacy({ costos }: { costos: Extract<CostosVista, { kind: "LEGACY" }> }) {
  return (
    <div className="flex flex-col gap-3">
      <RecordSection
        title="Costos (despacho legacy)"
        description="Despacho sin rateio cruzado — resumen de valores almacenados (sin memoria de landed)."
      >
        <RecordFieldGrid>
          <RecordField label="Costo landed ítems (ARS)">
            {fmtMoney(costos.resumen.landedItemsTotal)}
          </RecordField>
          <RecordField label="Tributos capitalizables (DIE + Tasa + Arancel)">
            {fmtMoney(costos.resumen.tributosCapitalizables)}
          </RecordField>
          <RecordField label="Cash-out / crédito (IVA + IIBB + Ganancias — no costo)">
            {fmtMoney(costos.resumen.tributosCashOut)}
          </RecordField>
        </RecordFieldGrid>
      </RecordSection>
      <CostoTributosPercepciones tributos={costos.tributos} />
      <CostoFacturasVinculadas facturas={costos.facturas} />
    </div>
  );
}

function CostosCruzado({ costos }: { costos: Extract<CostosVista, { kind: "CRUZADO" }> }) {
  return (
    <div className="flex flex-col gap-3">
      <CostoResumenLanded componentes={costos.componentes} baseRateio={costos.baseRateio} />
      <CostoTotalesComponente componentes={costos.componentes} />
      <CostoPorItem items={costos.items} />
      <CostoTributosPercepciones tributos={costos.tributos} />
      <CostoFacturasVinculadas facturas={costos.facturas} />
      <CostoConsistencia consistencia={costos.consistencia} />
    </div>
  );
}

/** Dispatcher read-only de la pestaña Costos. `costos === null` ⇒ oculto por
 * permiso (el valor jamás se serializó server-side). */
export function CostosTabContent({ costos }: { costos: CostosVista | null }) {
  if (costos === null) return <MensajeSimple mensaje={COSTO_OCULTO} />;
  if (costos.kind === "COSTOS_ABIERTOS") {
    return (
      <MensajeSimple mensaje="Cerrá los costos del contenedor para ver la memoria de costo landed." />
    );
  }
  if (costos.kind === "LEGACY") return <CostosLegacy costos={costos} />;
  return <CostosCruzado costos={costos} />;
}
