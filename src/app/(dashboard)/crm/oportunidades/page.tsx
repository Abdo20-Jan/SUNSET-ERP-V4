import Link from "next/link";
import type { Session } from "next-auth";

import { auth } from "@/lib/auth";
import { listarOportunidades, listarUsuariosParaAsignar } from "@/lib/actions/oportunidades";
import { listarStages } from "@/lib/actions/pipeline";
import { isCrmEnabled } from "@/lib/features";
import { getCotizacionParaFecha } from "@/lib/services/cotizacion";
import { listarProximasAccionesPendientes } from "@/lib/services/crm-proxima-accion";
import { OportunidadEstado } from "@/generated/prisma/client";
import { buttonVariants } from "@/components/ui/button";

import { MonedaToggle, type Moneda } from "../../reportes/_components/moneda-toggle";
import { KanbanBoard } from "./pipeline/_components/kanban-board";
import { buildKanbanCards } from "./pipeline/_helpers";
import {
  armarWorklistRows,
  buildOportunidadesHref,
  derivarProximaAccionPorOportunidad,
  filtrarSinAccion,
  type OportunidadesFiltro,
  type OportunidadesVista,
  parseEstadoParam,
  resolverFiltro,
  resolverVista,
} from "./_components/oportunidades-presentacion";
import { OportunidadesWorklist } from "./_components/oportunidades-worklist";
import { VistaToggle } from "./_components/vista-toggle";

/*
 * Worklist unificada de oportunidades (CRM-01 · PR-030): `?vista=lista`
 * (default, EnterpriseDataGrid) o `?vista=tablero` (el kanban EXISTENTE de
 * /crm/oportunidades/pipeline, reusado in-place — `KanbanBoard` y
 * `buildKanbanCards` intactos). Presets server-side por URL (lección PR-010):
 * `?estado=` · `?filtro=sin_accion` · `?owner=me`.
 */

type Params = {
  estado?: string;
  moneda?: string;
  vista?: string;
  filtro?: string;
  owner?: string;
};
type SearchParams = Promise<Params>;

export const dynamic = "force-dynamic";

type Presentacion = {
  moneda: Moneda;
  tc: string | null;
  tcInfo: { valor: string; fecha: string; fuente: string | null } | null;
};

function resolverPresentacion(
  session: Session | null,
  cotizacion: Awaited<ReturnType<typeof getCotizacionParaFecha>>,
  monedaParam: string | undefined,
): Presentacion {
  const monedaPreferida: Moneda = session?.user.monedaPreferida === "ARS" ? "ARS" : "USD";
  const moneda: Moneda =
    monedaParam === "ARS" ? "ARS" : monedaParam === "USD" ? "USD" : monedaPreferida;
  if (!cotizacion) return { moneda, tc: null, tcInfo: null };
  const valor = cotizacion.valor.toString();
  return {
    moneda,
    tc: valor,
    tcInfo: {
      valor,
      fecha: cotizacion.fecha.toISOString().slice(0, 10),
      fuente: cotizacion.fuente,
    },
  };
}

type Chip = { id: string; label: string; href: string; activo: boolean };

// Presets oficiales = Links server-side (jamás SavedViews in-memory). Todos
// preservan moneda (la vista lista es el default y se omite del href).
function buildChips(params: Params, filtro: OportunidadesFiltro): Chip[] {
  const comun = { moneda: params.moneda };
  const esMe = params.owner === "me";
  const sinPresets = !params.estado && filtro === "todas" && !esMe;
  return [
    { id: "todas", label: "Todas", href: buildOportunidadesHref(comun), activo: sinPresets },
    {
      id: "abiertas",
      label: "Abiertas",
      href: buildOportunidadesHref({ ...comun, estado: "ABIERTA" }),
      activo: params.estado === "ABIERTA",
    },
    {
      id: "ganadas",
      label: "Ganadas",
      href: buildOportunidadesHref({ ...comun, estado: "GANADA" }),
      activo: params.estado === "GANADA",
    },
    {
      id: "perdidas",
      label: "Perdidas",
      href: buildOportunidadesHref({ ...comun, estado: "PERDIDA" }),
      activo: params.estado === "PERDIDA",
    },
    {
      id: "en-pausa",
      label: "En pausa",
      href: buildOportunidadesHref({ ...comun, estado: "EN_PAUSA" }),
      activo: params.estado === "EN_PAUSA",
    },
    {
      id: "sin-accion",
      label: "Sin próxima acción",
      href: buildOportunidadesHref({ ...comun, filtro: "sin_accion" }),
      activo: filtro === "sin_accion",
    },
    {
      id: "mis",
      label: "Mis registros",
      href: buildOportunidadesHref({ ...comun, owner: "me" }),
      activo: esMe,
    },
  ];
}

function claseChip(activo: boolean): string {
  if (activo) return buttonVariants({ variant: "default", size: "sm" });
  return buttonVariants({ variant: "outline", size: "sm" });
}

function hrefsVistaToggle(params: Params, filtro: OportunidadesFiltro, vista: OportunidadesVista) {
  return {
    vista,
    hrefLista: buildOportunidadesHref({
      vista: "lista",
      estado: params.estado,
      filtro,
      owner: params.owner,
      moneda: params.moneda,
    }),
    hrefTablero: buildOportunidadesHref({ vista: "tablero", moneda: params.moneda }),
  };
}

export default async function OportunidadesPage({ searchParams }: { searchParams: SearchParams }) {
  if (!isCrmEnabled()) {
    return (
      <main className="container mx-auto p-6">
        <h1 className="text-2xl font-semibold">Oportunidades</h1>
        <p className="mt-4 text-muted-foreground">
          CRM no habilitado. Setear <code>CRM_ENABLED=true</code>.
        </p>
      </main>
    );
  }

  const params = await searchParams;
  const vista = resolverVista(params.vista);
  if (vista === "tablero") return renderTablero(params);
  return renderLista(params);
}

async function renderLista(params: Params) {
  // La sesión primero: `owner=me` filtra por el usuario logueado. Es un preset
  // de PRESENTACIÓN (worklist personal), NO seguridad — todo usuario CRM ve
  // todas las oportunidades igual.
  const session = await auth();
  const ownerId = params.owner === "me" ? session?.user.id : undefined;

  const [cotizacion, ops, usuarios, pendientes] = await Promise.all([
    getCotizacionParaFecha(new Date()),
    listarOportunidades({ estado: parseEstadoParam(params.estado), ownerId }),
    listarUsuariosParaAsignar(),
    listarProximasAccionesPendientes(),
  ]);

  const { moneda, tc, tcInfo } = resolverPresentacion(session, cotizacion, params.moneda);

  const filtro = resolverFiltro(params.filtro);
  const rowsBase = armarWorklistRows(ops, derivarProximaAccionPorOportunidad(pendientes));
  const rows = filtro === "sin_accion" ? filtrarSinAccion(rowsBase) : rowsBase;
  const hayPresets = Boolean(params.estado) || filtro === "sin_accion" || params.owner === "me";

  return (
    <main className="container mx-auto space-y-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Oportunidades</h1>
          <p className="text-sm text-muted-foreground">{rows.length} oportunidad(es)</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MonedaToggle current={moneda} tcInfo={tcInfo} />
          <VistaToggle {...hrefsVistaToggle(params, filtro, "lista")} />
          <Link
            href="/crm/oportunidades/nueva"
            className="rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90"
          >
            Nueva oportunidad
          </Link>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {buildChips(params, filtro).map((chip) => (
          <Link key={chip.id} href={chip.href} className={claseChip(chip.activo)}>
            {chip.label}
          </Link>
        ))}
      </div>

      <OportunidadesWorklist
        rows={rows}
        usuarios={usuarios}
        moneda={moneda}
        tc={tc}
        emptyMessage={
          hayPresets ? "Ninguna oportunidad para el preset seleccionado." : "Sin oportunidades."
        }
      />
    </main>
  );
}

// EXACTAMENTE los reads del pipeline/page.tsx anterior (call-shape copiado
// antes de reescribirlo): stages activos + oportunidades ABIERTAS →
// `buildKanbanCards` → `KanbanBoard` (ambos reusados IN-PLACE, cero cambios;
// `moverStageAction(id, stageId)` se dispara adentro del kanban, intacto).
async function renderTablero(params: Params) {
  const [session, cotizacion, stages, ops] = await Promise.all([
    auth(),
    getCotizacionParaFecha(new Date()),
    listarStages(),
    listarOportunidades({ estado: OportunidadEstado.ABIERTA }),
  ]);

  const { moneda, tc, tcInfo } = resolverPresentacion(session, cotizacion, params.moneda);
  const cards = buildKanbanCards(ops, moneda, tc);

  return (
    <main className="container mx-auto space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Oportunidades</h1>
          <p className="text-sm text-muted-foreground">{cards.length} oportunidad(es) abierta(s)</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <MonedaToggle current={moneda} tcInfo={tcInfo} />
          <VistaToggle {...hrefsVistaToggle(params, "todas", "tablero")} />
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
