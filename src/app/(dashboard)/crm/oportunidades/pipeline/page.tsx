import { redirect } from "next/navigation";

import { buildOportunidadesHref } from "../_components/oportunidades-presentacion";

/*
 * Ruta preservada para bookmarks/links viejos (CRM-01 · PR-030): el tablero
 * kanban ahora vive en la worklist unificada `/crm/oportunidades?vista=tablero`
 * — redirect server-side preservando la moneda de presentación (precedente:
 * ventas/[id]/entregas). Los componentes del kanban (`pipeline/_components/`
 * y `pipeline/_helpers.ts`) SIGUEN acá y se reusan in-place desde la page
 * unificada — cero cambios en ellos.
 */

type SearchParams = Promise<{ moneda?: string }>;

export const dynamic = "force-dynamic";

export default async function PipelinePage({ searchParams }: { searchParams: SearchParams }) {
  const { moneda } = await searchParams;
  redirect(buildOportunidadesHref({ vista: "tablero", moneda }));
}
