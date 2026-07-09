import Link from "next/link";
import { notFound } from "next/navigation";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getOportunidad, type OportunidadInput } from "@/lib/actions/oportunidades";
import { listarContactosDeCliente, listarContactosDeLead } from "@/lib/actions/contactos";
import { listarStages } from "@/lib/actions/pipeline";
import { isCrmEnabled } from "@/lib/features";
import { fmtDate, fmtMoney, fmtMontoPres } from "@/lib/format";
import { resolveActiveTab } from "@/lib/record-tabs";
import { getAuditLog } from "@/lib/services/auditoria";
import { getCotizacionParaFecha } from "@/lib/services/cotizacion";
import { OportunidadEstado } from "@/generated/prisma/client";

import { AuditTrail } from "@/components/ui/audit-trail";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { RecordTabs } from "@/components/ui/record-tabs";
import { RecordLayout } from "@/components/record/record-layout";
import { RecordActionBar } from "@/components/record/record-action-bar";
import { AdaptiveRecordHeader } from "@/components/record/adaptive-record-header";
import { EntityLink } from "@/components/data-grid/entity-link";
import { RegistrarActividadWindow } from "@/app/(dashboard)/crm/_components/registrar-actividad-window";

import { MonedaToggle, type Moneda } from "../../../reportes/_components/moneda-toggle";
import type { ClienteOption, LeadOption } from "../_components/oportunidad-form";
import { CerrarButtons } from "./_components/cerrar-buttons";
import { MoverStageSelect } from "./_components/mover-stage-select";
import { OportunidadActividadesTab } from "./_components/oportunidad-actividades-tab";
import { OportunidadContactosTab } from "./_components/oportunidad-contactos-tab";
import { OportunidadEditWindow } from "./_components/oportunidad-edit-window";
import { OportunidadResumenTab } from "./_components/oportunidad-resumen-tab";

/*
 * Record de oportunidad (CRM-01 · PR-030) — shell canónico (espejo
 * compras/pedidos/[id], PR-029): AdaptiveRecordHeader + RecordActionBar +
 * RecordTabs URL-driven. Las acciones de negocio son las EXISTENTES hospedadas
 * verbatim (MoverStageSelect / CerrarButtons, sólo con estado ABIERTA) + la
 * edición en FloatingWorkWindow (1º consumidor de `editarOportunidadAction`).
 * [Crear presupuesto] deliberadamente AUSENTE (sin backing action hoy).
 */

type PageParams = Promise<{ id: string }>;
type SearchParams = Promise<{ moneda?: string; tab?: string }>;

export const dynamic = "force-dynamic";

type OportunidadDetalle = NonNullable<Awaited<ReturnType<typeof getOportunidad>>>;

function resolverMonedaPres(spMoneda: string | undefined, monedaPreferida: Moneda): Moneda {
  if (spMoneda === "ARS") return "ARS";
  if (spMoneda === "USD") return "USD";
  return monedaPreferida;
}

function resolverTc(cotizacion: Awaited<ReturnType<typeof getCotizacionParaFecha>>): {
  tc: string | null;
  tcInfo: { valor: string; fecha: string; fuente: string | null } | null;
} {
  if (!cotizacion) return { tc: null, tcInfo: null };
  const valor = cotizacion.valor.toString();
  return {
    tc: valor,
    tcInfo: {
      valor,
      fecha: cotizacion.fecha.toISOString().slice(0, 10),
      fuente: cotizacion.fuente,
    },
  };
}

function fmtFechaHora(fecha: Date): string {
  const hora = fecha.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
  return `${fmtDate(fecha)} ${hora}`;
}

// MISMOS reads de /nueva + MERGE del vínculo actual: /nueva sólo lista leads
// sin cliente y clientes activos — sin el merge, el select del form no
// mostraría el vínculo vigente y lo LIMPIARÍA al guardar.
async function cargarOpcionesForm(op: OportunidadDetalle): Promise<{
  leads: LeadOption[];
  clientes: ClienteOption[];
}> {
  const [leads, clientes] = await Promise.all([
    db.lead.findMany({
      where: { clienteId: null },
      select: { id: true, nombre: true, empresa: true },
      orderBy: { nombre: "asc" },
    }),
    db.cliente.findMany({
      where: { estado: "activo" },
      select: { id: true, nombre: true },
      orderBy: { nombre: "asc" },
    }),
  ]);
  return {
    leads: mergeLeadActual(leads, op.lead),
    clientes: mergeClienteActual(clientes, op.cliente),
  };
}

function mergeLeadActual(leads: LeadOption[], lead: OportunidadDetalle["lead"]): LeadOption[] {
  if (!lead) return leads;
  if (leads.some((l) => l.id === lead.id)) return leads;
  return [...leads, lead];
}

function mergeClienteActual(
  clientes: ClienteOption[],
  cliente: OportunidadDetalle["cliente"],
): ClienteOption[] {
  if (!cliente) return clientes;
  if (clientes.some((c) => c.id === cliente.id)) return clientes;
  return [...clientes, cliente];
}

type ContactosVinculo = {
  contactos: Awaited<ReturnType<typeof listarContactosDeCliente>>;
  legenda: string;
};

// Contactos del VÍNCULO (Contacto no tiene oportunidadId): cliente con
// precedencia sobre lead. READ-ONLY, rotulado en la pestaña.
async function cargarContactosVinculo(op: OportunidadDetalle): Promise<ContactosVinculo> {
  if (op.clienteId) {
    const contactos = await listarContactosDeCliente(op.clienteId);
    return { contactos, legenda: "Contactos del cliente vinculado" };
  }
  if (op.leadId) {
    const contactos = await listarContactosDeLead(op.leadId);
    return { contactos, legenda: "Contactos del lead vinculado" };
  }
  return { contactos: [], legenda: "La oportunidad no tiene cliente ni lead vinculado" };
}

function fechaInicialCierre(cierreEstimado: Date | null): string | undefined {
  if (!cierreEstimado) return undefined;
  return cierreEstimado.toISOString().slice(0, 10);
}

function buildInitialForm(op: OportunidadDetalle): Partial<OportunidadInput> {
  return {
    titulo: op.titulo,
    monto: op.monto.toString(),
    moneda: op.moneda,
    stageId: op.stageId,
    probabilidad: op.probabilidad,
    cierreEstimado: fechaInicialCierre(op.cierreEstimado),
    leadId: op.leadId ?? undefined,
    clienteId: op.clienteId ?? undefined,
    notas: op.notas ?? undefined,
  };
}

function VinculoEntidad({ op }: { op: OportunidadDetalle }) {
  if (op.cliente) {
    return <EntityLink label={op.cliente.nombre} href={`/maestros/clientes/${op.cliente.id}`} />;
  }
  if (op.lead) {
    return (
      <EntityLink label={op.lead.empresa ?? op.lead.nombre} href={`/crm/leads/${op.lead.id}`} />
    );
  }
  return <span>—</span>;
}

export default async function OportunidadDetailPage({
  params,
  searchParams,
}: {
  params: PageParams;
  searchParams: SearchParams;
}) {
  if (!isCrmEnabled()) {
    return (
      <main className="container mx-auto p-6">
        <h1 className="text-2xl font-semibold">Oportunidad</h1>
        <p className="mt-4 text-muted-foreground">
          CRM no habilitado. Setear <code>CRM_ENABLED=true</code>.
        </p>
      </main>
    );
  }

  const { id } = await params;
  const sp = await searchParams;

  const op = await getOportunidad(id);
  if (!op) notFound();

  const [session, cotizacion, stages, historialCount, opciones, contactosVinculo] =
    await Promise.all([
      auth(),
      getCotizacionParaFecha(new Date()),
      listarStages(),
      db.auditLog.count({ where: { tabla: "Oportunidad", registroId: id } }),
      cargarOpcionesForm(op),
      cargarContactosVinculo(op),
    ]);

  const monedaPreferida: Moneda = session?.user.monedaPreferida === "ARS" ? "ARS" : "USD";
  const moneda = resolverMonedaPres(sp.moneda, monedaPreferida);
  const { tc, tcInfo } = resolverTc(cotizacion);

  const activeTab = resolveActiveTab(
    sp.tab,
    ["resumen", "actividades", "contactos", "historial"],
    "resumen",
  );

  const montoNativo = op.monto.toString();
  const stageOptions = stages.map((s) => ({ id: s.id, nombre: s.nombre }));

  return (
    <RecordLayout
      header={
        <AdaptiveRecordHeader
          breadcrumb={[
            { label: "CRM", href: "/crm" },
            { label: "Oportunidades", href: "/crm/oportunidades" },
            { label: op.numero },
          ]}
          codigo={op.numero}
          status={<StatusBadge estado={op.estado} />}
          entidad={<VinculoEntidad op={op} />}
          valor={
            <>
              <span>
                {fmtMoney(montoNativo)} {op.moneda}
              </span>
              <span className="ml-2 text-xs text-muted-foreground">
                {fmtMontoPres(montoNativo, op.moneda, moneda, tc)} {moneda}
              </span>
            </>
          }
          responsable={op.owner.nombre}
          meta={[
            { label: "Stage", value: op.stage.nombre },
            { label: "Probabilidad", value: `${op.probabilidad}%` },
            {
              label: "Cierre est.",
              value: op.cierreEstimado ? fmtDate(op.cierreEstimado) : "—",
            },
            { label: "Última actualización", value: fmtFechaHora(op.updatedAt) },
          ]}
        />
      }
      actionBar={
        <RecordActionBar
          className="top-11"
          left={
            <Link
              href="/crm/oportunidades"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Volver
            </Link>
          }
        >
          <MonedaToggle current={moneda} tcInfo={tcInfo} />
          <RegistrarActividadWindow
            target={{ oportunidadId: op.id }}
            triggerLabel="Registrar actividad"
          />
          <OportunidadEditWindow
            opId={op.id}
            numero={op.numero}
            initial={buildInitialForm(op)}
            stages={stageOptions}
            leads={opciones.leads}
            clientes={opciones.clientes}
          />
          {op.estado === OportunidadEstado.ABIERTA && (
            <div className="flex flex-wrap gap-2">
              <MoverStageSelect opId={op.id} stageActual={op.stageId} stages={stageOptions} />
              <CerrarButtons opId={op.id} />
            </div>
          )}
        </RecordActionBar>
      }
    >
      <RecordTabs
        activeValue={activeTab}
        tabs={[
          { value: "resumen", label: "Resumen" },
          { value: "actividades", label: "Actividades", count: op.actividades.length },
          { value: "contactos", label: "Contactos", count: contactosVinculo.contactos.length },
          { value: "historial", label: "Historial", count: historialCount },
        ]}
      />

      <OportunidadTabContent
        activeTab={activeTab}
        op={op}
        moneda={moneda}
        tc={tc}
        contactosVinculo={contactosVinculo}
      />
    </RecordLayout>
  );
}

function OportunidadTabContent({
  activeTab,
  op,
  moneda,
  tc,
  contactosVinculo,
}: {
  activeTab: string;
  op: OportunidadDetalle;
  moneda: Moneda;
  tc: string | null;
  contactosVinculo: ContactosVinculo;
}) {
  if (activeTab === "resumen") {
    return <OportunidadResumenTab op={op} moneda={moneda} tc={tc} />;
  }
  if (activeTab === "actividades") {
    return <OportunidadActividadesTab oportunidadId={op.id} actividades={op.actividades} />;
  }
  if (activeTab === "contactos") {
    return (
      <OportunidadContactosTab
        contactos={contactosVinculo.contactos}
        legenda={contactosVinculo.legenda}
      />
    );
  }
  if (activeTab === "historial") {
    return <HistorialTab id={op.id} />;
  }
  return null;
}

// Ninguna action CRM escribe AuditLog hoy → `getAuditLog("Oportunidad", id)`
// devuelve vacío y el AuditTrail muestra "Sin historial de cambios" HONESTO
// (no se fabrica una línea de tiempo sintética; cuando las actions de CRM
// registren auditoría, esta pestaña la mostrará sin cambios).
async function HistorialTab({ id }: { id: string }) {
  const entries = await getAuditLog("Oportunidad", id);
  return <AuditTrail entries={entries} />;
}
