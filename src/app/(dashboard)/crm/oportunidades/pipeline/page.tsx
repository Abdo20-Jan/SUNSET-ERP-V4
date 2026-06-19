import Link from "next/link";

import { auth } from "@/lib/auth";
import { listarOportunidades } from "@/lib/actions/oportunidades";
import { listarStages } from "@/lib/actions/pipeline";
import { isCrmEnabled } from "@/lib/features";
import { getCotizacionParaFecha } from "@/lib/services/cotizacion";
import { OportunidadEstado } from "@/generated/prisma/client";

import { MonedaToggle, type Moneda } from "../../../reportes/_components/moneda-toggle";

import { KanbanBoard } from "./_components/kanban-board";
import { buildKanbanCards } from "./_helpers";

type SearchParams = Promise<{ moneda?: string }>;

export const dynamic = "force-dynamic";

export default async function PipelinePage({ searchParams }: { searchParams: SearchParams }) {
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

  const [params, session, cotizacion, stages, ops] = await Promise.all([
    searchParams,
    auth(),
    getCotizacionParaFecha(new Date()),
    listarStages(),
    listarOportunidades({ estado: OportunidadEstado.ABIERTA }),
  ]);

  const monedaPreferida: Moneda = session?.user.monedaPreferida === "ARS" ? "ARS" : "USD";
  const moneda: Moneda =
    params.moneda === "ARS" ? "ARS" : params.moneda === "USD" ? "USD" : monedaPreferida;
  const tc = cotizacion ? cotizacion.valor.toString() : null;
  const tcInfo = cotizacion
    ? {
        valor: cotizacion.valor.toString(),
        fecha: cotizacion.fecha.toISOString().slice(0, 10),
        fuente: cotizacion.fuente,
      }
    : null;

  const cards = buildKanbanCards(ops, moneda, tc);

  return (
    <main className="container mx-auto space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Pipeline</h1>
          <p className="text-sm text-muted-foreground">{cards.length} oportunidad(es) abierta(s)</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <MonedaToggle current={moneda} tcInfo={tcInfo} />
          <Link
            href="/crm/oportunidades/nueva"
            className="rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90"
          >
            Nueva oportunidad
          </Link>
        </div>
      </header>

      <KanbanBoard stages={stages.map((s) => ({ id: s.id, nombre: s.nombre }))} cards={cards} />
    </main>
  );
}
