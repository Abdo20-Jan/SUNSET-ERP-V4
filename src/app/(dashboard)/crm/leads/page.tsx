import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
import { parsePaginationParams } from "@/components/ui/pagination-params";
import type { LeadEstado, LeadFuente } from "@/generated/prisma/client";
import { listarLeads, type LeadRow } from "@/lib/actions/leads";
import { auth } from "@/lib/auth";
import { isCrmEnabled } from "@/lib/features";
import {
  cargarActividadesSeguimiento,
  listarLeadsSinFollowUp,
} from "@/lib/services/crm/lead-seguimiento";

import { LeadsFilterBar } from "./_components/leads-filter-bar";
import {
  buildLeadsHref,
  derivarSeguimiento,
  flattenLeads,
  type LeadsVista,
  parseLeadEstado,
  parseLeadFuente,
  resolverVista,
  VISTA_LABELS,
} from "./_components/leads-presentacion";
import { LeadsWorklist } from "./_components/leads-worklist";

/*
 * Worklist de leads (CRM-01 · PR-030) sobre EnterpriseDataGrid. Sub-vistas
 * oficiales = presets de URL server-side (`?vista=`): «Míos» y «Sin
 * follow-up» filtran EN LA QUERY (total honesto para la paginación server);
 * el grid client sólo busca/ordena sobre la página cargada.
 */

type SearchParams = Promise<{
  vista?: string;
  estado?: string;
  fuente?: string;
  q?: string;
  page?: string;
  perPage?: string;
}>;

export const dynamic = "force-dynamic";

const VISTAS: LeadsVista[] = ["todos", "mios", "sin-follow-up"];

type FiltrosLeads = {
  estado?: LeadEstado;
  fuente?: LeadFuente;
  search?: string;
  page: number;
  perPage: number;
};

// Carga condicional por vista. «Míos» es un preset de PRESENTACIÓN (filtra
// por el owner de la sesión para la vista personal) — NO es una barrera de
// seguridad: cualquier usuario puede ver «Todos». Sin sesión degrada a
// «Todos» (el gate real de mutación es requireCrmAuth en las actions).
async function cargarLeads(
  vista: LeadsVista,
  ownerId: string | undefined,
  filtros: FiltrosLeads,
): Promise<{ rows: LeadRow[]; total: number }> {
  if (vista === "sin-follow-up") return listarLeadsSinFollowUp(filtros);
  if (vista === "mios" && ownerId) return listarLeads({ ...filtros, ownerId });
  return listarLeads(filtros);
}

function emptyMessageParaVista(vista: LeadsVista): string {
  if (vista === "sin-follow-up") return "Ningún lead sin follow-up.";
  if (vista === "mios") return "No hay leads asignados a vos.";
  return "No hay leads.";
}

export default async function LeadsPage({ searchParams }: { searchParams: SearchParams }) {
  if (!isCrmEnabled()) {
    return (
      <main className="container mx-auto p-6">
        <h1 className="text-2xl font-semibold">Leads</h1>
        <p className="mt-4 text-muted-foreground">
          CRM no habilitado. Setear <code>CRM_ENABLED=true</code>.
        </p>
      </main>
    );
  }

  const [params, session] = await Promise.all([searchParams, auth()]);
  const vista = resolverVista(params.vista);
  const estado = parseLeadEstado(params.estado);
  const fuente = parseLeadFuente(params.fuente);
  const { page, perPage } = parsePaginationParams(params);

  const { rows, total } = await cargarLeads(vista, session?.user.id, {
    estado,
    fuente,
    search: params.q,
    page,
    perPage,
  });

  // Seguimiento derivado de Actividad (el Lead no tiene proximaAccion/último
  // contacto en el schema): 1 query acotada a los ids de la página.
  const seguimiento = derivarSeguimiento(await cargarActividadesSeguimiento(rows.map((r) => r.id)));
  const filas = flattenLeads(rows, seguimiento, new Date());

  return (
    <main className="container mx-auto space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Leads</h1>
          <p className="text-sm text-muted-foreground">{total} lead(s)</p>
        </div>
        <div className="flex gap-2">
          <Link href="/crm/leads/import" className="rounded-md border px-4 py-2 hover:bg-muted">
            Importar CSV
          </Link>
          <Link
            href="/crm/leads/nuevo"
            className="rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90"
          >
            Nuevo lead
          </Link>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {VISTAS.map((v) => (
          <Link
            key={v}
            href={buildLeadsHref({
              vista: v,
              q: params.q,
              estado: params.estado,
              fuente: params.fuente,
              perPage: params.perPage,
            })}
            className={buttonVariants({
              variant: vista === v ? "default" : "outline",
              size: "sm",
            })}
          >
            {VISTA_LABELS[v]}
          </Link>
        ))}
      </div>

      <LeadsFilterBar
        q={params.q}
        estado={params.estado}
        fuente={params.fuente}
        vista={params.vista}
      />

      <LeadsWorklist rows={filas} emptyMessage={emptyMessageParaVista(vista)}>
        {total > 0 && <Pagination page={page} perPage={perPage} total={total} />}
      </LeadsWorklist>
    </main>
  );
}
