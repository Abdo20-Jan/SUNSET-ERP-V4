import Link from "next/link";
import type { ReactNode } from "react";

import { fmtMoney } from "@/lib/format";
import { getAuditLog } from "@/lib/services/auditoria";
import type { ContenedorFicha, ContenedorFichaItem } from "@/lib/services/contenedor-ficha";
import { AuditTrail } from "@/components/ui/audit-trail";
import { RecordTabs } from "@/components/ui/record-tabs";
import { buttonVariants } from "@/components/ui/button";
import { RecordLayout } from "@/components/record/record-layout";
import { RecordActionBar } from "@/components/record/record-action-bar";
import { AdaptiveRecordHeader } from "@/components/record/adaptive-record-header";
import { RecordField, RecordFieldGrid, RecordSection } from "@/components/record/record-section";
import { EntityLink } from "@/components/data-grid/entity-link";

import { EstadoContenedorBadge } from "../../_components/contenedores-chips";

/*
 * Record del Contenedor (PR-024b, CX-04 · PAGE-STD-02). DISPLAY puro de
 * `ContenedorFicha` (proyección de sólo lectura, costo mascarado server-side) +
 * LINK a los flujos existentes (desconsolidación/investigación/despacho). NO toca
 * el motor de desconsolidación/counters/rateio: lee campos STORED. El masking de
 * costo ocurre server-side (`verCosto`); acá sólo se omite el bloque/columna.
 */

export const CONTENEDOR_TABS = [
  "resumen",
  "packing",
  "documentos",
  "despachos",
  "costos",
  "auditoria",
] as const;

const DASH = "—";
const COSTO_OCULTO = "Valores de costo ocultos — requiere el permiso «Ver costo landed».";

function fmtFecha(iso: string | null): string {
  if (!iso) return DASH;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? DASH
    : new Intl.DateTimeFormat("es-AR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone: "UTC",
      }).format(d);
}

function ResumenTab({ ficha }: { ficha: ContenedorFicha }) {
  return (
    <div className="flex flex-col gap-3">
      <RecordSection title="Datos del contenedor">
        <RecordFieldGrid>
          <RecordField label="Estado">
            <EstadoContenedorBadge estado={ficha.estado} />
          </RecordField>
          <RecordField label="Embarque">
            <EntityLink
              label={ficha.embarqueCodigo}
              href={`/comex/embarques/${ficha.embarqueId}`}
            />
          </RecordField>
          <RecordField label="Proveedor">{ficha.proveedorNombre}</RecordField>
          <RecordField label="Tipo">{ficha.tipo ?? DASH}</RecordField>
          <RecordField label="BL">{ficha.numeroBL ?? DASH}</RecordField>
          <RecordField label="HBL">{ficha.numeroHBL ?? DASH}</RecordField>
          <RecordField label="Depósito zona primaria">
            {ficha.depositoZonaPrimaria ?? DASH}
          </RecordField>
          <RecordField label="Depósito fiscal">{ficha.depositoFiscal ?? DASH}</RecordField>
          <RecordField label="Depósito destino">{ficha.depositoDestino ?? DASH}</RecordField>
        </RecordFieldGrid>
      </RecordSection>

      <RecordSection title="Ciclo físico / aduanero">
        <RecordFieldGrid>
          <RecordField label="Salida origen">{fmtFecha(ficha.fechaSalidaOrigen)}</RecordField>
          <RecordField label="Llegada puerto">{fmtFecha(ficha.fechaLlegadaPuerto)}</RecordField>
          <RecordField label="Ingreso ZP">{fmtFecha(ficha.fechaIngresoZpa)}</RecordField>
          <RecordField label="Traslado a DF">{fmtFecha(ficha.fechaTrasladoDF)}</RecordField>
          <RecordField label="Desconsolidación">
            {fmtFecha(ficha.fechaDesconsolidacion)}
          </RecordField>
          <RecordField label="Peso bruto (kg)">{ficha.pesoBrutoKg ?? DASH}</RecordField>
          <RecordField label="Peso neto (kg)">{ficha.pesoNetoKg ?? DASH}</RecordField>
          <RecordField label="Volumen (m³)">{ficha.volumenM3 ?? DASH}</RecordField>
        </RecordFieldGrid>
        {ficha.observaciones ? (
          <p className="text-[12px] whitespace-pre-wrap text-muted-foreground">
            {ficha.observaciones}
          </p>
        ) : null}
      </RecordSection>
    </div>
  );
}

function DivergenciaCell({ value }: { value: number | null }) {
  if (value == null) return <span className="text-muted-foreground">{DASH}</span>;
  const cls = value === 0 ? "text-muted-foreground" : "text-destructive font-medium";
  return <span className={`tabular-nums ${cls}`}>{value > 0 ? `+${value}` : value}</span>;
}

// Packing list por SKU: declarada/física/divergencia + breakdown disponible +
// (con permiso) costo FC unitario. Counters LEÍDOS del motor, sin recálculo.
function PackingTab({ ficha, verCosto }: { ficha: ContenedorFicha; verCosto: boolean }) {
  if (ficha.items.length === 0) {
    return (
      <RecordSection title="Packing list">
        <p className="text-[12px] text-muted-foreground">Sin ítems en el packing list.</p>
      </RecordSection>
    );
  }
  return (
    <RecordSection title="Packing list">
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-[13px]">
          <thead className="bg-muted/40 text-[11px] tracking-wider text-muted-foreground uppercase">
            <tr>
              <th className="px-2.5 py-1.5 text-left">Producto</th>
              <th className="px-2.5 py-1.5 text-right">Declarada</th>
              <th className="px-2.5 py-1.5 text-right">Física</th>
              <th className="px-2.5 py-1.5 text-right">Diverg.</th>
              <th className="px-2.5 py-1.5 text-right">Disponible</th>
              <th className="px-2.5 py-1.5 text-right">En despacho</th>
              <th className="px-2.5 py-1.5 text-right">Despachada</th>
              {verCosto && <th className="px-2.5 py-1.5 text-right">Costo FC unit.</th>}
            </tr>
          </thead>
          <tbody className="divide-y">
            {ficha.items.map((i) => (
              <PackingRow key={i.id} item={i} verCosto={verCosto} />
            ))}
          </tbody>
        </table>
      </div>
    </RecordSection>
  );
}

function PackingRow({ item, verCosto }: { item: ContenedorFichaItem; verCosto: boolean }) {
  return (
    <tr>
      <td className="px-2.5 py-1.5">
        <span className="font-mono text-[12px]">{item.productoCodigo}</span>
        <span className="text-muted-foreground"> · {item.productoNombre}</span>
      </td>
      <td className="px-2.5 py-1.5 text-right tabular-nums">{item.cantidadDeclarada}</td>
      <td className="px-2.5 py-1.5 text-right tabular-nums">{item.cantidadFisica ?? DASH}</td>
      <td className="px-2.5 py-1.5 text-right">
        <DivergenciaCell value={item.divergencia} />
      </td>
      <td className="px-2.5 py-1.5 text-right font-medium tabular-nums">
        {item.cantidadDisponible}
      </td>
      <td className="px-2.5 py-1.5 text-right tabular-nums">{item.cantidadEnDespacho}</td>
      <td className="px-2.5 py-1.5 text-right tabular-nums">{item.cantidadDespachada}</td>
      {verCosto && (
        <td className="px-2.5 py-1.5 text-right tabular-nums">
          {item.costoFCUnitario == null ? DASH : `${fmtMoney(item.costoFCUnitario)} USD`}
        </td>
      )}
    </tr>
  );
}

// Documentos: display de las URLs cargadas por la desconsolidación (fotos de la
// conferencia física / documentos). La CARGA vive en el flujo de desconsolidación.
function DocumentosTab({ ficha }: { ficha: ContenedorFicha }) {
  const docs = ficha.documentos;
  const total = docs ? docs.documentosUrls.length + docs.fotosUrls.length : 0;
  return (
    <RecordSection
      title="Documentos"
      description="Fotos y documentos de la conferencia física — se cargan en el flujo de desconsolidación."
    >
      {total === 0 ? (
        <p className="text-[12px] text-muted-foreground">
          Sin documentos.{" "}
          <Link
            href={`/comex/contenedores/${ficha.id}/desconsolidacion`}
            className="text-primary underline-offset-2 hover:underline"
          >
            Ir a la desconsolidación
          </Link>
          .
        </p>
      ) : (
        <ul className="flex flex-col gap-1 text-[13px]">
          {docs?.documentosUrls.map((url) => (
            <li key={url}>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline-offset-2 hover:underline"
              >
                Documento
              </a>
            </li>
          ))}
          {docs?.fotosUrls.map((url) => (
            <li key={url}>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline-offset-2 hover:underline"
              >
                Foto
              </a>
            </li>
          ))}
        </ul>
      )}
    </RecordSection>
  );
}

// Despachos: EntityLinks al record de despacho existente (PR-023a) por embarque.
function DespachosTab({ ficha }: { ficha: ContenedorFicha }) {
  if (ficha.despachos.length === 0) {
    return (
      <RecordSection title="Despachos">
        <p className="text-[12px] text-muted-foreground">
          Ningún despacho consumió este contenedor todavía.
        </p>
      </RecordSection>
    );
  }
  return (
    <RecordSection title="Despachos">
      <div className="overflow-hidden rounded-md border">
        <table className="w-full text-[13px]">
          <thead className="bg-muted/40 text-[11px] tracking-wider text-muted-foreground uppercase">
            <tr>
              <th className="px-2.5 py-1.5 text-left">Despacho</th>
              <th className="px-2.5 py-1.5 text-left">Estado</th>
              <th className="px-2.5 py-1.5 text-right">Cant. consumida</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {ficha.despachos.map((d) => (
              <tr key={d.despachoId}>
                <td className="px-2.5 py-1.5">
                  <EntityLink
                    label={d.numeroOM ?? `Despacho ${d.despachoId.slice(0, 8)}`}
                    href={`/comex/embarques/${d.embarqueId}/despachos/${d.despachoId}`}
                  />
                </td>
                <td className="px-2.5 py-1.5 text-muted-foreground">{d.estado}</td>
                <td className="px-2.5 py-1.5 text-right tabular-nums">{d.cantidad}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </RecordSection>
  );
}

function CostosTab({ ficha, verCosto }: { ficha: ContenedorFicha; verCosto: boolean }) {
  if (!verCosto) {
    return (
      <RecordSection title="Costos">
        <p className="text-[12px] text-muted-foreground">{COSTO_OCULTO}</p>
      </RecordSection>
    );
  }
  return (
    <RecordSection
      title="Costos (landed FC)"
      description="Σ costo FC unitario × cantidad declarada — valores almacenados, sin recálculo del motor."
    >
      <RecordFieldGrid>
        <RecordField label="Costo FC total (USD)">
          {ficha.costoFCTotal == null ? DASH : fmtMoney(ficha.costoFCTotal)}
        </RecordField>
        <RecordField label="SKUs con costo cerrado">
          {ficha.items.filter((i) => i.costoFCUnitario != null).length} / {ficha.items.length}
        </RecordField>
      </RecordFieldGrid>
    </RecordSection>
  );
}

async function AuditoriaTab({ contenedorId }: { contenedorId: string }) {
  const entries = await getAuditLog("Contenedor", contenedorId);
  return (
    <RecordSection title="Auditoría">
      <AuditTrail entries={entries} />
    </RecordSection>
  );
}

function ContenedorTabContent({
  activeTab,
  ficha,
  verCosto,
}: {
  activeTab: string;
  ficha: ContenedorFicha;
  verCosto: boolean;
}): ReactNode {
  // Mapa de elementos (lazy: sólo se ejecuta el elegido) → dispatcher de complejidad 1.
  const content: Record<string, ReactNode> = {
    resumen: <ResumenTab ficha={ficha} />,
    packing: <PackingTab ficha={ficha} verCosto={verCosto} />,
    documentos: <DocumentosTab ficha={ficha} />,
    despachos: <DespachosTab ficha={ficha} />,
    costos: <CostosTab ficha={ficha} verCosto={verCosto} />,
    auditoria: <AuditoriaTab contenedorId={ficha.id} />,
  };
  return content[activeTab] ?? content.resumen;
}

export function ContenedorRecord({
  ficha,
  verCosto,
  activeTab,
}: {
  ficha: ContenedorFicha;
  verCosto: boolean;
  activeTab: string;
}) {
  const disponibleTotal = ficha.items.reduce((acc, i) => acc + i.cantidadDisponible, 0);
  return (
    <RecordLayout
      header={
        <AdaptiveRecordHeader
          breadcrumb={[
            { label: "Comex", href: "/comex" },
            { label: "Contenedores", href: "/comex/contenedores" },
            { label: ficha.numeroContenedor },
          ]}
          codigo={`Contenedor ${ficha.numeroContenedor}`}
          status={<EstadoContenedorBadge estado={ficha.estado} />}
          entidad={
            <EntityLink
              label={ficha.embarqueCodigo}
              href={`/comex/embarques/${ficha.embarqueId}`}
            />
          }
          valor={
            verCosto && ficha.costoFCTotal != null ? (
              <span>Costo FC USD {fmtMoney(ficha.costoFCTotal)}</span>
            ) : verCosto ? (
              <span className="text-xs text-muted-foreground">Sin costo cerrado</span>
            ) : (
              <span className="text-xs text-muted-foreground">— costo oculto</span>
            )
          }
          responsable="Comex"
          meta={[
            { label: "Embarque", value: ficha.embarqueCodigo },
            { label: "Depósito fiscal", value: ficha.depositoFiscal ?? DASH },
            { label: "Disponible", value: String(disponibleTotal) },
          ]}
        />
      }
      actionBar={
        <RecordActionBar
          className="top-11"
          left={
            <Link
              href="/comex/contenedores"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Volver
            </Link>
          }
        >
          <Link
            href={`/comex/contenedores/${ficha.id}/desconsolidacion`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Desconsolidar / Conferencia
          </Link>
          <Link
            href={`/comex/contenedores/${ficha.id}/investigacion`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Investigación
          </Link>
        </RecordActionBar>
      }
    >
      <RecordTabs
        activeValue={activeTab}
        tabs={[
          { value: "resumen", label: "Resumen" },
          { value: "packing", label: "Packing list", count: ficha.items.length || undefined },
          { value: "documentos", label: "Documentos" },
          { value: "despachos", label: "Despachos", count: ficha.despachos.length || undefined },
          { value: "costos", label: "Costos" },
          { value: "auditoria", label: "Auditoría" },
        ]}
      />

      <ContenedorTabContent activeTab={activeTab} ficha={ficha} verCosto={verCosto} />
    </RecordLayout>
  );
}
