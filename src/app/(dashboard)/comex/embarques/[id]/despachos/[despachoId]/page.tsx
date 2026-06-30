import { notFound } from "next/navigation";

import { obtenerDespachoPorId } from "@/lib/actions/despachos";
import { puedeVerCostoLanded } from "@/lib/permisos-masking";
import { resolveActiveTab } from "@/lib/record-tabs";

import { DESPACHO_TABS, DespachoRecord } from "./_components/despacho-record";
import { proyectarDespacho } from "./_components/despacho-vista";

type PageParams = Promise<{ id: string; despachoId: string }>;
type SearchParams = Promise<{ tab?: string }>;

export const dynamic = "force-dynamic";

export default async function DespachoRecordPage({
  params,
  searchParams,
}: {
  params: PageParams;
  searchParams: SearchParams;
}) {
  const { despachoId } = await params;
  const sp = await searchParams;

  const detalle = await obtenerDespachoPorId(despachoId);
  if (!detalle) notFound();

  const verCosto = await puedeVerCostoLanded();
  const { vista, financiero } = proyectarDespacho(detalle, verCosto);
  const activeTab = resolveActiveTab(sp.tab, DESPACHO_TABS, "resumen");

  return <DespachoRecord vista={vista} financiero={financiero} activeTab={activeTab} />;
}
