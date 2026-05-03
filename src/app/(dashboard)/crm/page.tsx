import Link from "next/link";

import { db } from "@/lib/db";
import { isCrmEnabled } from "@/lib/features";
import { auth } from "@/lib/auth";
import {
  LeadEstado,
  OportunidadEstado,
} from "@/generated/prisma/client";

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
    session?.user.id
      ? db.actividad.count({
          where: { ownerId: session.user.id, completada: false },
        })
      : 0,
  ]);

  return (
    <main className="container mx-auto space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">CRM</h1>
          <p className="text-sm text-muted-foreground">
            Pipeline comercial · {totalLeads} leads · {oportunidadesAbiertas} oportunidades abiertas
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
        <KpiCard label="Leads totales" value={totalLeads} href="/crm/leads" />
        <KpiCard
          label="Nuevos sin contactar"
          value={leadsNuevos}
          href="/crm/leads?estado=NUEVO"
        />
        <KpiCard
          label="Oportunidades abiertas"
          value={oportunidadesAbiertas}
          href="/crm/oportunidades"
        />
        <KpiCard
          label="Ganadas (acumulado)"
          value={oportunidadesGanadas}
          href="/crm/oportunidades?estado=GANADA"
        />
        <KpiCard
          label="Mis actividades pendientes"
          value={actividadesPendientes}
          href="/crm/actividades"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Link
          href="/crm/oportunidades/pipeline"
          className="rounded-md border p-4 hover:bg-muted"
        >
          <h2 className="font-medium">Pipeline kanban</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Ver oportunidades por etapa, mover entre stages.
          </p>
        </Link>
        <Link href="/crm/contactos" className="rounded-md border p-4 hover:bg-muted">
          <h2 className="font-medium">Contactos</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Personas vinculadas a leads y clientes.
          </p>
        </Link>
      </div>
    </main>
  );
}

function KpiCard({
  label,
  value,
  href,
}: {
  label: string;
  value: number;
  href: string;
}) {
  return (
    <Link href={href} className="rounded-md border p-4 hover:bg-muted">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </Link>
  );
}
