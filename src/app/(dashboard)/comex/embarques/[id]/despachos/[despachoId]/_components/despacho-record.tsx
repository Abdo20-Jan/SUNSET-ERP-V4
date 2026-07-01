import Link from "next/link";
import type { ReactNode } from "react";

import { fmtDateOrDash, fmtMoney, fmtTipoCambio } from "@/lib/format";
import { getAuditLog } from "@/lib/services/auditoria";
import { AuditTrail } from "@/components/ui/audit-trail";
import { StatusBadge } from "@/components/ui/status-badge";
import { RecordTabs } from "@/components/ui/record-tabs";
import { buttonVariants } from "@/components/ui/button";
import { RecordLayout } from "@/components/record/record-layout";
import { RecordActionBar } from "@/components/record/record-action-bar";
import { AdaptiveRecordHeader } from "@/components/record/adaptive-record-header";
import { RecordField, RecordFieldGrid, RecordSection } from "@/components/record/record-section";
import { EntityLink } from "@/components/data-grid/entity-link";

import { DespachoActions } from "../../_components/despacho-actions";
import type { CostosVista } from "./costos-vista";
import { CostosTabContent } from "./costos/costos-tab-content";
import type { DespachoFinanciero, DespachoVista } from "./despacho-vista";

/*
 * Record del Despacho (PR-023a, CX-05 · PAGE-STD-02). DISPLAY puro de
 * `DespachoVista`/`DespachoFinanciero` (proyección mascarada server-side) +
 * HOST de las acciones existentes (`DespachoActions`: contabilizar/anular/
 * eliminar). NO toca el motor de rateio ni recalcula costo: lee campos STORED.
 * El masking de costo/tributos ocurre server-side (financiero === null cuando
 * falta `costos.verLanded`); acá sólo se omite el bloque correspondiente.
 */

export const DESPACHO_TABS = [
  "resumen",
  "items",
  "tributos",
  "facturas",
  "costos",
  "asiento",
  "documentos",
  "auditoria",
] as const;

const COSTO_OCULTO = "Valores de costo ocultos — requiere el permiso «Ver costo landed».";

function AsientoLink({ asiento }: { asiento: DespachoVista["asiento"] }) {
  if (!asiento) return <span className="text-muted-foreground">—</span>;
  return (
    <Link
      href={`/contabilidad/asientos/${asiento.id}`}
      className="text-primary underline-offset-2 hover:underline"
    >
      #{asiento.numero}
    </Link>
  );
}

function ResumenTab({
  vista,
  financiero,
}: {
  vista: DespachoVista;
  financiero: DespachoFinanciero | null;
}) {
  return (
    <div className="flex flex-col gap-3">
      <RecordSection title="Resumen">
        <RecordFieldGrid>
          <RecordField label="Estado">
            <StatusBadge estado={vista.estado} />
          </RecordField>
          <RecordField label="Embarque">
            <EntityLink
              label={vista.embarqueCodigo}
              href={`/comex/embarques/${vista.embarqueId}`}
            />
          </RecordField>
          <RecordField label="Fecha">{fmtDateOrDash(vista.fecha)}</RecordField>
          <RecordField label="Nº OM">{vista.numeroOM ?? "—"}</RecordField>
          <RecordField label="Ítems">{vista.itemsCount}</RecordField>
          <RecordField label="Facturas">{vista.facturasCount}</RecordField>
          <RecordField label="Asiento">
            <AsientoLink asiento={vista.asiento} />
          </RecordField>
        </RecordFieldGrid>
        {vista.notas ? (
          <p className="text-[12px] text-muted-foreground whitespace-pre-wrap">{vista.notas}</p>
        ) : null}
      </RecordSection>

      {financiero ? (
        <RecordSection
          title="Costo (landed)"
          description="Σ costo unitario × cantidad — valores almacenados, sin recálculo."
        >
          <RecordFieldGrid>
            <RecordField label="Costo ítems (ARS)">
              {fmtMoney(financiero.landedItemsTotal)}
            </RecordField>
            <RecordField label="Tributos capitalizables">
              {fmtMoney(financiero.tributosCapitalizables)}
            </RecordField>
            <RecordField label="Cash-out / crédito (no costo)">
              {fmtMoney(financiero.tributosCashOut)}
            </RecordField>
          </RecordFieldGrid>
        </RecordSection>
      ) : null}
    </div>
  );
}

function ItemsTab({
  vista,
  financiero,
}: {
  vista: DespachoVista;
  financiero: DespachoFinanciero | null;
}) {
  const verCosto = financiero !== null;
  if (vista.items.length === 0) {
    return (
      <RecordSection title="Ítems">
        <p className="text-[12px] text-muted-foreground">Sin ítems.</p>
      </RecordSection>
    );
  }
  return (
    <RecordSection title="Ítems">
      <div className="overflow-hidden rounded-md border">
        <table className="w-full text-[13px]">
          <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-2.5 py-1.5 text-left">#</th>
              <th className="px-2.5 py-1.5 text-left">Producto</th>
              <th className="px-2.5 py-1.5 text-right">Cantidad</th>
              <th className="px-2.5 py-1.5 text-right">Cant. embarque</th>
              {verCosto && <th className="px-2.5 py-1.5 text-right">Costo FC unit.</th>}
            </tr>
          </thead>
          <tbody className="divide-y">
            {vista.items.map((i, idx) => (
              <tr key={i.id}>
                <td className="px-2.5 py-1.5 text-muted-foreground">{idx + 1}</td>
                <td className="px-2.5 py-1.5">
                  <span className="font-mono text-[12px]">{i.productoCodigo}</span>
                  <span className="text-muted-foreground"> · {i.productoNombre}</span>
                </td>
                <td className="px-2.5 py-1.5 text-right tabular-nums">{i.cantidad}</td>
                <td className="px-2.5 py-1.5 text-right tabular-nums text-muted-foreground">
                  {i.cantidadEmbarque}
                </td>
                {verCosto && (
                  <td className="px-2.5 py-1.5 text-right tabular-nums">
                    {fmtMoney(financiero.costoUnitarioPorItem[i.id] ?? "0")}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </RecordSection>
  );
}

function TributosTab({ financiero }: { financiero: DespachoFinanciero | null }) {
  if (!financiero) {
    return (
      <RecordSection title="Tributos">
        <p className="text-[12px] text-muted-foreground">{COSTO_OCULTO}</p>
      </RecordSection>
    );
  }
  return (
    <RecordSection
      title="Tributos"
      description="IVA, IVA adicional, IIBB y Ganancias son cash-out / crédito recuperable — no costo del producto."
    >
      <RecordFieldGrid>
        <RecordField label="Tipo de cambio">{fmtTipoCambio(financiero.tipoCambio)}</RecordField>
        <RecordField label="DIE">{fmtMoney(financiero.die)}</RecordField>
        <RecordField label="Tasa estadística">{fmtMoney(financiero.tasaEstadistica)}</RecordField>
        <RecordField label="Arancel SIM">{fmtMoney(financiero.arancelSim)}</RecordField>
        <RecordField label="IVA">{fmtMoney(financiero.iva)}</RecordField>
        <RecordField label="IVA adicional">{fmtMoney(financiero.ivaAdicional)}</RecordField>
        <RecordField label="IIBB">{fmtMoney(financiero.iibb)}</RecordField>
        <RecordField label="Ganancias">{fmtMoney(financiero.ganancias)}</RecordField>
      </RecordFieldGrid>
    </RecordSection>
  );
}

function FacturasTab({
  vista,
  financiero,
}: {
  vista: DespachoVista;
  financiero: DespachoFinanciero | null;
}) {
  const verCosto = financiero !== null;
  if (vista.facturas.length === 0) {
    return (
      <RecordSection title="Facturas">
        <p className="text-[12px] text-muted-foreground">Sin facturas vinculadas.</p>
      </RecordSection>
    );
  }
  return (
    <RecordSection title="Facturas">
      <div className="overflow-hidden rounded-md border">
        <table className="w-full text-[13px]">
          <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-2.5 py-1.5 text-left">Proveedor</th>
              <th className="px-2.5 py-1.5 text-left">Número</th>
              <th className="px-2.5 py-1.5 text-left">Momento</th>
              {verCosto && <th className="px-2.5 py-1.5 text-right">Total ARS</th>}
            </tr>
          </thead>
          <tbody className="divide-y">
            {vista.facturas.map((f) => (
              <tr key={f.id}>
                <td className="px-2.5 py-1.5">{f.proveedorNombre}</td>
                <td className="px-2.5 py-1.5 font-mono text-[12px]">{f.facturaNumero ?? "—"}</td>
                <td className="px-2.5 py-1.5 text-muted-foreground">{f.momento}</td>
                {verCosto && (
                  <td className="px-2.5 py-1.5 text-right tabular-nums">
                    {fmtMoney(financiero.totalArsPorFactura[f.id] ?? "0")}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </RecordSection>
  );
}

function AsientoTab({ vista }: { vista: DespachoVista }) {
  return (
    <RecordSection title="Asiento">
      {vista.asiento ? (
        <RecordFieldGrid>
          <RecordField label="Asiento contable">
            <AsientoLink asiento={vista.asiento} />
          </RecordField>
        </RecordFieldGrid>
      ) : (
        <p className="text-[12px] text-muted-foreground">
          Sin asiento — el despacho aún no fue contabilizado.
        </p>
      )}
    </RecordSection>
  );
}

function DocumentosTab() {
  return (
    <RecordSection title="Documentos">
      <p className="text-[12px] text-muted-foreground">
        Sin documentos. La gestión documental del despacho se habilita en una entrega futura
        (CX-07).
      </p>
    </RecordSection>
  );
}

// Auditoría — `despachos.ts` no instrumenta `registrarAuditoria` hoy (fuera de
// alcance PR-023a) → normalmente vacío ("Sin historial"). DISPLAY puro de
// AuditLog vía getAuditLog (PR-008), igual que el embarque (PR-021).
async function AuditoriaTab({ despachoId }: { despachoId: string }) {
  const entries = await getAuditLog("Despacho", despachoId);
  return (
    <RecordSection title="Auditoría">
      <AuditTrail entries={entries} />
    </RecordSection>
  );
}

function DespachoTabContent({
  activeTab,
  vista,
  financiero,
  costos,
}: {
  activeTab: string;
  vista: DespachoVista;
  financiero: DespachoFinanciero | null;
  costos: CostosVista | null;
}): ReactNode {
  // Mapa de elementos (lazy: el componente sólo se ejecuta al renderizar el
  // elegido) → dispatcher de complejidad 1, sin switch de 8 ramas.
  const content: Record<string, ReactNode> = {
    resumen: <ResumenTab vista={vista} financiero={financiero} />,
    items: <ItemsTab vista={vista} financiero={financiero} />,
    tributos: <TributosTab financiero={financiero} />,
    facturas: <FacturasTab vista={vista} financiero={financiero} />,
    costos: <CostosTabContent costos={costos} />,
    asiento: <AsientoTab vista={vista} />,
    documentos: <DocumentosTab />,
    auditoria: <AuditoriaTab despachoId={vista.id} />,
  };
  return content[activeTab] ?? content.resumen;
}

export function DespachoRecord({
  vista,
  financiero,
  activeTab,
  costos,
}: {
  vista: DespachoVista;
  financiero: DespachoFinanciero | null;
  activeTab: string;
  costos: CostosVista | null;
}) {
  return (
    <RecordLayout
      header={
        <AdaptiveRecordHeader
          breadcrumb={[
            { label: "Comex", href: "/comex" },
            { label: "Embarques", href: "/comex/embarques" },
            { label: vista.embarqueCodigo, href: `/comex/embarques/${vista.embarqueId}` },
            { label: "Despachos", href: `/comex/embarques/${vista.embarqueId}/despachos` },
            { label: vista.codigo },
          ]}
          codigo={`Despacho ${vista.codigo}`}
          status={<StatusBadge estado={vista.estado} />}
          entidad={
            <EntityLink
              label={vista.embarqueCodigo}
              href={`/comex/embarques/${vista.embarqueId}`}
            />
          }
          valor={
            financiero ? (
              <span>Landed ARS {fmtMoney(financiero.landedItemsTotal)}</span>
            ) : (
              <span className="text-xs text-muted-foreground">— costo oculto</span>
            )
          }
          responsable="Comex"
          meta={[
            { label: "Fecha", value: fmtDateOrDash(vista.fecha) },
            { label: "Nº OM", value: vista.numeroOM ?? "—" },
            { label: "Asiento", value: <AsientoLink asiento={vista.asiento} /> },
          ]}
        />
      }
      actionBar={
        <RecordActionBar
          className="top-11"
          left={
            <Link
              href={`/comex/embarques/${vista.embarqueId}/despachos`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Volver
            </Link>
          }
        >
          <DespachoActions despachoId={vista.id} estado={vista.estado} codigo={vista.codigo} />
        </RecordActionBar>
      }
    >
      <RecordTabs
        activeValue={activeTab}
        tabs={[
          { value: "resumen", label: "Resumen" },
          { value: "items", label: "Ítems", count: vista.itemsCount || undefined },
          { value: "tributos", label: "Tributos" },
          { value: "facturas", label: "Facturas", count: vista.facturasCount || undefined },
          { value: "costos", label: "Costos" },
          { value: "asiento", label: "Asiento" },
          { value: "documentos", label: "Documentos" },
          { value: "auditoria", label: "Auditoría" },
        ]}
      />

      <DespachoTabContent
        activeTab={activeTab}
        vista={vista}
        financiero={financiero}
        costos={costos}
      />
    </RecordLayout>
  );
}
