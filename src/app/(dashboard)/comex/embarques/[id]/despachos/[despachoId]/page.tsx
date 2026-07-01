import { notFound } from "next/navigation";

import { obtenerDespachoPorId } from "@/lib/actions/despachos";
import { puedeVerCostoLanded } from "@/lib/permisos-masking";
import { resolveActiveTab } from "@/lib/record-tabs";

import { proyectarCostos } from "./_components/costos-vista";
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

  // Lazy: la memoria de costo (que invoca el motor read-only) sólo se computa al
  // abrir la pestaña Costos y con permiso — fuera de ahí, ningún valor cruza.
  const costos =
    activeTab === "costos" ? await proyectarCostos(despachoId, vista, financiero, verCosto) : null;

  return (
    <DespachoRecord vista={vista} financiero={financiero} activeTab={activeTab} costos={costos} />
  );
}
