import { notFound } from "next/navigation";

import { isContenedorDesconsolidacionEnabled } from "@/lib/features";
import { puedeVerCostoLanded } from "@/lib/permisos-masking";
import { obtenerContenedorFicha } from "@/lib/services/contenedor-ficha";
import { resolveActiveTab } from "@/lib/record-tabs";

import { CONTENEDOR_TABS, ContenedorRecord } from "./_components/contenedor-record";

type PageParams = Promise<{ id: string }>;
type SearchParams = Promise<{ tab?: string }>;

export const dynamic = "force-dynamic";

export default async function ContenedorRecordPage({
  params,
  searchParams,
}: {
  params: PageParams;
  searchParams: SearchParams;
}) {
  // Gate de flag PRIMERO: con la feature apagada la ruta no existe (cero query).
  if (!isContenedorDesconsolidacionEnabled()) notFound();

  const { id } = await params;
  const sp = await searchParams;

  // Gate de costo server-side: `verCosto` decide si el costo FC viaja al cliente.
  const verCosto = await puedeVerCostoLanded();
  const ficha = await obtenerContenedorFicha(id, verCosto);
  if (!ficha) notFound();

  const activeTab = resolveActiveTab(sp.tab, CONTENEDOR_TABS, "resumen");

  return <ContenedorRecord ficha={ficha} verCosto={verCosto} activeTab={activeTab} />;
}
