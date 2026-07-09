import Link from "next/link";
import { notFound } from "next/navigation";

import { AdaptiveRecordHeader } from "@/components/record/adaptive-record-header";
import { RecordActionBar } from "@/components/record/record-action-bar";
import { RecordLayout } from "@/components/record/record-layout";
import { AuditTrail } from "@/components/ui/audit-trail";
import { buttonVariants } from "@/components/ui/button";
import { RecordTabs } from "@/components/ui/record-tabs";
import { StatusBadge } from "@/components/ui/status-badge";
import { getLead } from "@/lib/actions/leads";
import { db } from "@/lib/db";
import { isCrmEnabled } from "@/lib/features";
import { fmtDate } from "@/lib/format";
import { resolveActiveTab } from "@/lib/record-tabs";
import { getAuditLog } from "@/lib/services/auditoria";

import { RegistrarActividadWindow } from "../../_components/registrar-actividad-window";
import { ConvertirClienteButton } from "./_components/convertir-cliente-button";
import type { ContactoResumen } from "./_components/contacto-window";
import { EliminarLeadButton } from "./_components/eliminar-lead-button";
import { LeadActividadesTab } from "./_components/lead-actividades-tab";
import { LeadContactosTab } from "./_components/lead-contactos-tab";
import { LeadEditWindow } from "./_components/lead-edit-window";
import { LeadResumenTab, type LeadDetalle } from "./_components/lead-resumen-tab";

/*
 * Record de lead (CRM-01 · PR-030) — record-shell canónico (espejo del record
 * de pedido de compra, PR-029): AdaptiveRecordHeader + RecordActionBar +
 * RecordTabs URL-driven. Todas las mutaciones pasan por las actions
 * existentes, INTACTAS (editar via FWW, convertir/eliminar VERBATIM,
 * actividad/contactos en ventanas propias).
 */

type PageParams = Promise<{ id: string }>;
type SearchParams = Promise<{ tab?: string }>;

export const dynamic = "force-dynamic";

const TABS = ["resumen", "actividades", "contactos", "historial"] as const;

function toContactoResumen(c: LeadDetalle["contactos"][number]): ContactoResumen {
  return {
    id: c.id,
    nombre: c.nombre,
    cargo: c.cargo,
    email: c.email,
    telefono: c.telefono,
    esPrincipal: c.esPrincipal,
  };
}

export default async function LeadDetailPage({
  params,
  searchParams,
}: {
  params: PageParams;
  searchParams: SearchParams;
}) {
  if (!isCrmEnabled()) {
    return (
      <main className="container mx-auto p-6">
        <h1 className="text-2xl font-semibold">Lead</h1>
        <p className="mt-4 text-muted-foreground">
          CRM no habilitado. Setear <code>CRM_ENABLED=true</code>.
        </p>
      </main>
    );
  }

  const { id } = await params;
  const sp = await searchParams;

  const [lead, historialCount] = await Promise.all([
    getLead(id),
    db.auditLog.count({ where: { tabla: "Lead", registroId: id } }),
  ]);
  if (!lead) notFound();

  const activeTab = resolveActiveTab(sp.tab, TABS, "resumen");
  const contactos = lead.contactos.map(toContactoResumen);

  return (
    <RecordLayout
      header={
        <AdaptiveRecordHeader
          breadcrumb={[
            { label: "CRM", href: "/crm" },
            { label: "Leads", href: "/crm/leads" },
            { label: lead.nombre },
          ]}
          codigo={lead.nombre}
          status={<StatusBadge estado={lead.estado} />}
          entidad={lead.empresa ?? "—"}
          valor={`Score ${lead.score} pts`}
          responsable={lead.owner.nombre}
          meta={[
            { label: "Fuente", value: lead.fuente },
            { label: "Email", value: lead.email ?? "—" },
            { label: "Teléfono", value: lead.telefono ?? "—" },
            { label: "CUIT", value: lead.cuit ?? "—" },
            { label: "Creado", value: fmtDate(lead.createdAt) },
            { label: "Actualizado", value: fmtDate(lead.updatedAt) },
          ]}
        />
      }
      actionBar={
        <RecordActionBar
          className="top-11"
          left={
            <Link href="/crm/leads" className={buttonVariants({ variant: "outline", size: "sm" })}>
              Volver
            </Link>
          }
        >
          <LeadEditWindow
            leadId={lead.id}
            // Mismo mapeo `?? undefined` en nullables que la ex-page /editar.
            initial={{
              nombre: lead.nombre,
              empresa: lead.empresa ?? undefined,
              cuit: lead.cuit ?? undefined,
              email: lead.email ?? undefined,
              telefono: lead.telefono ?? undefined,
              fuente: lead.fuente,
              estado: lead.estado,
              notas: lead.notas ?? undefined,
            }}
          />
          <RegistrarActividadWindow target={{ leadId: lead.id }} />
          {!lead.clienteId && <ConvertirClienteButton leadId={lead.id} />}
          <EliminarLeadButton leadId={lead.id} />
        </RecordActionBar>
      }
    >
      <RecordTabs
        activeValue={activeTab}
        tabs={[
          { value: "resumen", label: "Resumen" },
          { value: "actividades", label: "Actividades", count: lead.actividades.length },
          { value: "contactos", label: "Contactos", count: contactos.length },
          { value: "historial", label: "Historial", count: historialCount },
        ]}
      />

      <LeadTabContent activeTab={activeTab} lead={lead} contactos={contactos} />
    </RecordLayout>
  );
}

function LeadTabContent({
  activeTab,
  lead,
  contactos,
}: {
  activeTab: string;
  lead: LeadDetalle;
  contactos: ContactoResumen[];
}) {
  if (activeTab === "resumen") {
    return <LeadResumenTab lead={lead} />;
  }
  if (activeTab === "actividades") {
    return <LeadActividadesTab leadId={lead.id} actividades={lead.actividades} />;
  }
  if (activeTab === "contactos") {
    return <LeadContactosTab leadId={lead.id} contactos={contactos} />;
  }
  if (activeTab === "historial") {
    return <HistorialTab registroId={lead.id} />;
  }
  return null;
}

// Historial honesto: NINGUNA action CRM escribe AuditLog hoy, así que
// `getAuditLog("Lead", id)` devuelve vacío y el AuditTrail muestra
// «Sin historial de cambios.» — verdadero (no hay rastro que mostrar).
// Cuando las actions CRM adopten `registrarAuditoria`, esta pestaña se
// llena sola.
async function HistorialTab({ registroId }: { registroId: string }) {
  const entries = await getAuditLog("Lead", registroId);
  return <AuditTrail entries={entries} />;
}
