import Link from "next/link";
import { notFound } from "next/navigation";

import { EmbarqueEstado } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { isContenedorDesconsolidacionEnabled } from "@/lib/features";
import { fmtDate, fmtDateOrDash, fmtMoney, fmtTipoCambio } from "@/lib/format";
import { puedeVerCostoLanded } from "@/lib/permisos-masking";
import { getAuditLog } from "@/lib/services/auditoria";
import { listarPackingListDeEmbarque } from "@/lib/services/contenedor";
import { resolveActiveTab } from "@/lib/record-tabs";
import {
  listarCuentasParaCostoLogistico,
  listarDepositosParaEmbarque,
  listarProductosParaEmbarque,
  listarProveedoresParaEmbarque,
  obtenerEmbarquePorId,
} from "@/lib/actions/embarques";
import { type DespachoListRow, listarDespachosDeEmbarque } from "@/lib/actions/despachos";
import { getDefaultFecha } from "@/lib/server/fecha-default";
import { AuditTrail } from "@/components/ui/audit-trail";
import { StatusBadge } from "@/components/ui/status-badge";
import { RecordTabs } from "@/components/ui/record-tabs";
import { buttonVariants } from "@/components/ui/button";
import { RecordLayout } from "@/components/record/record-layout";
import { RecordActionBar } from "@/components/record/record-action-bar";
import { AdaptiveRecordHeader } from "@/components/record/adaptive-record-header";
import { RecordSection } from "@/components/record/record-section";
import { EntityLink } from "@/components/data-grid/entity-link";

import { EmbarqueEditWindow } from "./_components/embarque-edit-window";
import { type EmbarqueAlerta, EmbarqueAlertasBand } from "./_components/embarque-alertas-band";
import {
  calcularFiscalCounters,
  type EmbarqueFinanciero,
  type EmbarqueVista,
  type FiscalCounters,
  proyectarContenedores,
  proyectarEmbarque,
} from "./_components/embarque-vista";
import { EmbarqueResumenView, type ProximaAccion } from "./_components/embarque-resumen-view";
import { EmbarqueOperacionView } from "./_components/embarque-operacion-view";
import { EmbarqueComercialView } from "./_components/embarque-comercial-view";
import { EmbarqueAduanaView } from "./_components/embarque-aduana-view";
import { EmbarqueFinanzasView } from "./_components/embarque-finanzas-view";

type PageParams = Promise<{ id: string }>;
type SearchParams = Promise<{ tab?: string }>;

const TABS = ["resumen", "operacion", "comercial", "aduana", "finanzas", "sistema"] as const;

export const dynamic = "force-dynamic";

function fmtFechaHora(fecha: Date): string {
  const hora = fecha.toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
  return `${fmtDate(fecha)} ${hora}`;
}

// Alertas SÓLO de datos ya cargados (sin motor): estado, asientos ZP/cierre.
function derivarAlertas(vista: EmbarqueVista): EmbarqueAlerta[] {
  const alertas: EmbarqueAlerta[] = [];
  if (vista.estado === "CERRADO") {
    alertas.push({ nivel: "info", mensaje: "Embarque CERRADO — registro de sólo lectura." });
  }
  if (!vista.asientoZonaPrimaria && !vista.asiento) {
    alertas.push({ nivel: "warning", mensaje: "Zona primaria sin confirmar." });
  }
  if (vista.asientoZonaPrimaria && !vista.asiento) {
    alertas.push({
      nivel: "info",
      mensaje: "Zona primaria confirmada — cierre pendiente.",
      href: "?tab=finanzas",
      hrefLabel: "Ver cierre",
    });
  }
  return alertas;
}

function derivarProximaAccion(vista: EmbarqueVista): ProximaAccion {
  if (vista.estado === "CERRADO") {
    return { titulo: "Sin próxima acción", descripcion: "Embarque cerrado (sólo lectura)." };
  }
  if (!vista.asientoZonaPrimaria && !vista.asiento) {
    return {
      titulo: "Confirmar zona primaria",
      descripcion: "Genere el asiento de mercadería en tránsito desde «Editar embarque».",
    };
  }
  if (vista.asientoZonaPrimaria && !vista.asiento && vista.despachosActivosCount > 0) {
    return {
      titulo: "Gestionar despachos parciales",
      descripcion: "Hay despachos activos por contabilizar.",
      href: `/comex/embarques/${vista.id}/despachos`,
      hrefLabel: "Ver despachos",
    };
  }
  if (vista.asientoZonaPrimaria && !vista.asiento) {
    return {
      titulo: "Cerrar y contabilizar",
      descripcion: "Genere el asiento de nacionalización desde «Editar embarque».",
    };
  }
  return { titulo: "Embarque en proceso", descripcion: "Sin acción inmediata." };
}

// Cantidades despachadas por estado (read-only; conteo, no motor de rateio).
async function cargarDespachoCantidades(
  id: string,
): Promise<Array<{ estado: "BORRADOR" | "CONTABILIZADO" | "ANULADO"; cantidad: number }>> {
  const despachos = await db.despacho.findMany({
    where: { embarqueId: id, estado: { not: "ANULADO" } },
    select: { estado: true, items: { select: { cantidad: true } } },
  });
  return despachos.map((d) => ({
    estado: d.estado,
    cantidad: d.items.reduce((acc, it) => acc + it.cantidad, 0),
  }));
}

async function cargarDatos(id: string, contenedorEnabled: boolean) {
  const [
    proveedores,
    productos,
    depositos,
    cuentasGasto,
    defaultFecha,
    despachos,
    despachoCantidades,
    contenedores,
    meta,
    historialCount,
    verCosto,
  ] = await Promise.all([
    listarProveedoresParaEmbarque(),
    listarProductosParaEmbarque(),
    listarDepositosParaEmbarque(),
    listarCuentasParaCostoLogistico(),
    getDefaultFecha(),
    listarDespachosDeEmbarque(id),
    cargarDespachoCantidades(id),
    contenedorEnabled ? listarPackingListDeEmbarque(id) : Promise.resolve([]),
    db.embarque.findUnique({ where: { id }, select: { updatedAt: true } }),
    db.auditLog.count({ where: { tabla: "Embarque", registroId: id } }),
    puedeVerCostoLanded(),
  ]);
  return {
    proveedores,
    productos,
    depositos,
    cuentasGasto,
    defaultFecha,
    despachos,
    despachoCantidades,
    contenedores,
    updatedAt: meta?.updatedAt ?? new Date(),
    historialCount,
    verCosto,
  };
}

export default async function EmbarqueRecordPage({
  params,
  searchParams,
}: {
  params: PageParams;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const embarque = await obtenerEmbarquePorId(id);
  if (!embarque) notFound();

  const readonly = embarque.estado === EmbarqueEstado.CERRADO;
  const contenedorEnabled = isContenedorDesconsolidacionEnabled();
  const d = await cargarDatos(id, contenedorEnabled);

  const proveedoresMap: Record<string, string> = {};
  for (const p of d.proveedores) proveedoresMap[p.id] = p.nombre;
  const productosMap: Record<string, { codigo: string; nombre: string }> = {};
  for (const p of d.productos) productosMap[p.id] = { codigo: p.codigo, nombre: p.nombre };

  const proveedorNombre = proveedoresMap[embarque.proveedorId] ?? "—";
  const { vista, financiero } = proyectarEmbarque(embarque, proveedorNombre, d.verCosto);
  const contenedoresVista = proyectarContenedores(d.contenedores);
  const fiscal = calcularFiscalCounters(vista.totalCantidad, d.despachoCantidades);

  const alertas = derivarAlertas(vista);
  const proximaAccion = derivarProximaAccion(vista);
  const activeTab = resolveActiveTab(sp.tab, TABS, "resumen");

  return (
    <RecordLayout
      header={
        <AdaptiveRecordHeader
          breadcrumb={[
            { label: "Comex", href: "/comex" },
            { label: "Embarques", href: "/comex/embarques" },
            { label: embarque.codigo },
          ]}
          codigo={`Embarque ${embarque.codigo}`}
          status={<StatusBadge estado={embarque.estado} />}
          entidad={
            <span className="flex flex-wrap items-center gap-x-2">
              <EntityLink
                label={proveedorNombre}
                href={`/maestros/proveedores/${embarque.proveedorId}`}
              />
              <span className="text-xs text-muted-foreground">· {vista.totalCantidad} u.</span>
              {contenedoresVista.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  · {contenedoresVista.length} cont.
                </span>
              )}
            </span>
          }
          valor={
            financiero ? (
              <span>
                FOB {vista.moneda} {fmtMoney(financiero.fobTotal)}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">— costo oculto</span>
            )
          }
          responsable="Comex"
          meta={[
            { label: "ETA", value: fmtDateOrDash(vista.fechaLlegada) },
            {
              label: "Moneda",
              value: vista.moneda === "ARS" ? "ARS" : `USD · TC ${fmtTipoCambio(vista.tipoCambio)}`,
            },
            { label: "Última actualización", value: fmtFechaHora(d.updatedAt) },
          ]}
        />
      }
      actionBar={
        <RecordActionBar
          className="top-11"
          left={
            <Link
              href="/comex/embarques"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Volver
            </Link>
          }
        >
          <EmbarqueEditWindow
            embarque={embarque}
            proveedores={d.proveedores}
            productos={d.productos}
            depositos={d.depositos}
            cuentasGasto={d.cuentasGasto}
            contenedorEnabled={contenedorEnabled}
            contenedores={d.contenedores}
            readonly={readonly}
            defaultFecha={d.defaultFecha}
          />
        </RecordActionBar>
      }
    >
      <EmbarqueAlertasBand alertas={alertas} />

      <RecordTabs
        activeValue={activeTab}
        tabs={[
          { value: "resumen", label: "Resumen" },
          { value: "operacion", label: "Operación" },
          { value: "comercial", label: "Comercial" },
          { value: "aduana", label: "Aduana", count: d.despachos.length || undefined },
          { value: "finanzas", label: "Finanzas" },
          { value: "sistema", label: "Sistema", count: d.historialCount || undefined },
        ]}
      />

      <EmbarqueTabContent
        activeTab={activeTab}
        embarqueId={id}
        vista={vista}
        financiero={financiero}
        productosMap={productosMap}
        proveedoresMap={proveedoresMap}
        contenedores={contenedoresVista}
        despachos={d.despachos}
        fiscal={fiscal}
        proximaAccion={proximaAccion}
      />
    </RecordLayout>
  );
}

function EmbarqueTabContent({
  activeTab,
  embarqueId,
  vista,
  financiero,
  productosMap,
  proveedoresMap,
  contenedores,
  despachos,
  fiscal,
  proximaAccion,
}: {
  activeTab: string;
  embarqueId: string;
  vista: EmbarqueVista;
  financiero: EmbarqueFinanciero | null;
  productosMap: Record<string, { codigo: string; nombre: string }>;
  proveedoresMap: Record<string, string>;
  contenedores: ReturnType<typeof proyectarContenedores>;
  despachos: DespachoListRow[];
  fiscal: FiscalCounters;
  proximaAccion: ProximaAccion;
}) {
  if (activeTab === "resumen") {
    return (
      <EmbarqueResumenView
        vista={vista}
        financiero={financiero}
        contenedores={contenedores}
        despachos={despachos}
        fiscal={fiscal}
        proximaAccion={proximaAccion}
      />
    );
  }
  if (activeTab === "operacion") {
    return (
      <EmbarqueOperacionView
        vista={vista}
        financiero={financiero}
        productosMap={productosMap}
        contenedores={contenedores}
      />
    );
  }
  if (activeTab === "comercial") {
    return <EmbarqueComercialView vista={vista} />;
  }
  if (activeTab === "aduana") {
    return <EmbarqueAduanaView vista={vista} financiero={financiero} despachos={despachos} />;
  }
  if (activeTab === "finanzas") {
    return (
      <EmbarqueFinanzasView vista={vista} financiero={financiero} proveedoresMap={proveedoresMap} />
    );
  }
  return <HistorialTab embarqueId={embarqueId} />;
}

// Sistema > Historial — auditoría del embarque. `embarques.ts` no instrumenta
// `registrarAuditoria` hoy (fuera de alcance PR-021) → normalmente vacío
// ("Sin historial"). DISPLAY puro de AuditLog vía getAuditLog (PR-008).
async function HistorialTab({ embarqueId }: { embarqueId: string }) {
  const entries = await getAuditLog("Embarque", embarqueId);
  return (
    <RecordSection title="Historial / Auditoría">
      <AuditTrail entries={entries} />
    </RecordSection>
  );
}
