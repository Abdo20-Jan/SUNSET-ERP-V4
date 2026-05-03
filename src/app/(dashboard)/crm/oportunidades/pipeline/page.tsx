import Link from "next/link";

import { listarOportunidades } from "@/lib/actions/oportunidades";
import { listarStages } from "@/lib/actions/pipeline";
import { isCrmEnabled } from "@/lib/features";
import { fmtMoney } from "@/lib/format";
import { OportunidadEstado } from "@/generated/prisma/client";

import { KanbanBoard } from "./_components/kanban-board";

export default async function PipelinePage() {
  if (!isCrmEnabled()) {
    return (
      <main className="container mx-auto p-6">
        <h1 className="text-2xl font-semibold">Pipeline</h1>
        <p className="mt-4 text-muted-foreground">
          CRM no habilitado. Setear <code>CRM_ENABLED=true</code>.
        </p>
      </main>
    );
  }

  const [stages, ops] = await Promise.all([
    listarStages(),
    listarOportunidades({ estado: OportunidadEstado.ABIERTA }),
  ]);

  const cards = ops.map((o) => ({
    id: o.id,
    numero: o.numero,
    titulo: o.titulo,
    montoLabel: `${o.moneda} ${fmtMoney(o.monto)}`,
    stageId: o.stageId,
    leadOClienteId: o.clienteId ?? o.leadId,
    leadOClienteNombre: o.clienteNombre ?? o.leadEmpresa ?? o.leadNombre ?? "—",
    leadOClienteHref: o.clienteId
      ? `/maestros/clientes/${o.clienteId}`
      : o.leadId
      ? `/crm/leads/${o.leadId}`
      : null,
  }));

  return (
    <main className="container mx-auto space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Pipeline</h1>
          <p className="text-sm text-muted-foreground">
            {cards.length} oportunidad(es) abierta(s)
          </p>
        </div>
        <Link
          href="/crm/oportunidades/nueva"
          className="rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90"
        >
          Nueva oportunidad
        </Link>
      </header>

      <KanbanBoard stages={stages.map((s) => ({ id: s.id, nombre: s.nombre }))} cards={cards} />
    </main>
  );
}
