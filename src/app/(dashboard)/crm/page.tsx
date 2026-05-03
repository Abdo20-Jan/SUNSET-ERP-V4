import Link from "next/link";

import { db } from "@/lib/db";
import { isCrmEnabled } from "@/lib/features";
import { auth } from "@/lib/auth";
import {
  LeadEstado,
  OportunidadEstado,
} from "@/generated/prisma/client";

import { KpiCard, NavTile } from "./_components/dashboard-tiles";

type Kpis = {
  totalLeads: number;
  leadsNuevos: number;
  oportunidadesAbiertas: number;
  oportunidadesGanadas: number;
  actividadesPendientes: number;
};

async function fetchKpis(userId: string | undefined): Promise<Kpis> {
  const [
    totalLeads,
    leadsNuevos,
    oportunidadesAbiertas,
    oportunidadesGanadas,
    actividadesPendientes,
  ] = await Promise.all([
    db.lead.count(),
    db.lead.count({ where: { estado: LeadEstado.NUEVO } }),
    db.oportunidad.count({ where: { estado: OportunidadEstado.ABIERTA } }),
    db.oportunidad.count({ where: { estado: OportunidadEstado.GANADA } }),
    userId
      ? db.actividad.count({ where: { ownerId: userId, completada: false } })
      : Promise.resolve(0),
  ]);
  return {
    totalLeads,
    leadsNuevos,
    oportunidadesAbiertas,
    oportunidadesGanadas,
    actividadesPendientes,
  };
}

export default async function CrmDashboardPage() {
  if (!isCrmEnabled()) {
    return (
      <main className="container mx-auto p-6">
        <h1 className="text-2xl font-semibold">CRM</h1>
        <p className="mt-4 text-muted-foreground">
          CRM no habilitado. Setear <code>CRM_ENABLED=true</code>.
        </p>
      </main>
    );
  }

  const session = await auth();
  const kpis = await fetchKpis(session?.user.id);

  return (
    <main className="container mx-auto space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">CRM</h1>
          <p className="text-sm text-muted-foreground">
            Pipeline comercial · {kpis.totalLeads} leads · {kpis.oportunidadesAbiertas} oportunidades abiertas
          </p>
        </div>
        <Link
          href="/crm/leads/nuevo"
          className="rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90"
        >
          Nuevo lead
        </Link>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard label="Leads totales" value={kpis.totalLeads} href="/crm/leads" />
        <KpiCard
          label="Nuevos sin contactar"
          value={kpis.leadsNuevos}
          href="/crm/leads?estado=NUEVO"
        />
        <KpiCard
          label="Oportunidades abiertas"
          value={kpis.oportunidadesAbiertas}
          href="/crm/oportunidades"
        />
        <KpiCard
          label="Ganadas (acumulado)"
          value={kpis.oportunidadesGanadas}
          href="/crm/oportunidades?estado=GANADA"
        />
        <KpiCard
          label="Mis actividades pendientes"
          value={kpis.actividadesPendientes}
          href="/crm/actividades"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <NavTile
          href="/crm/oportunidades/pipeline"
          title="Pipeline kanban"
          description="Ver oportunidades por etapa, mover entre stages."
        />
        <NavTile
          href="/crm/contactos"
          title="Contactos"
          description="Personas vinculadas a leads y clientes."
        />
      </div>
    </main>
  );
}
