import { notFound } from "next/navigation";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isApprovalsEnabled } from "@/lib/features";
import {
  listarClientesParaPedidoVenta,
  listarProductosParaPedidoVenta,
  obtenerPedidoVentaPorId,
} from "@/lib/actions/pedidos-venta";
import { getCotizacionParaFecha } from "@/lib/services/cotizacion";
import { TIPOS_VENTA } from "@/lib/services/aprobaciones-constants";
import { listarAprobacionesDeDocumento } from "@/lib/services/aprobaciones-query";
import { resolveActiveTab } from "@/lib/record-tabs";
import { AutorizacionesTab } from "@/components/aprobaciones/autorizaciones-tab";
import { RecordTabs } from "@/components/ui/record-tabs";

import type { Moneda } from "../../../reportes/_components/moneda-toggle";
import { PedidoVentaDetail } from "../_components/pedido-venta-detail";
import { PedidoVentaForm } from "../_components/pedido-venta-form";

type PageParams = Promise<{ id: string }>;
type SearchParams = Promise<{ editar?: string; moneda?: string; tab?: string }>;

export const dynamic = "force-dynamic";

export default async function PedidoVentaDetailPage({
  params,
  searchParams,
}: {
  params: PageParams;
  searchParams: SearchParams;
}) {
  const { id: idStr } = await params;
  const { editar, moneda: monedaParam, tab } = await searchParams;
  const id = Number.parseInt(idStr, 10);
  if (Number.isNaN(id)) notFound();

  const pedido = await obtenerPedidoVentaPorId(id);
  if (!pedido) notFound();

  const editable = pedido.estado === "BORRADOR" || pedido.estado === "ENVIADO";

  if (editable && editar === "1") {
    const [clientes, productos] = await Promise.all([
      listarClientesParaPedidoVenta(),
      listarProductosParaPedidoVenta(),
    ]);
    return (
      <PedidoVentaForm mode="edit" initialData={pedido} clientes={clientes} productos={productos} />
    );
  }

  const [cliente, productos, ventasVinculadas, session, cotizacion] = await Promise.all([
    db.cliente.findUnique({
      where: { id: pedido.clienteId },
      select: { nombre: true },
    }),
    db.producto.findMany({
      where: { id: { in: pedido.items.map((it) => it.productoId) } },
      select: { id: true, codigo: true, nombre: true },
    }),
    db.venta.findMany({
      where: { pedidoVentaId: id },
      select: { id: true, numero: true, estado: true },
      orderBy: { createdAt: "desc" },
    }),
    auth(),
    getCotizacionParaFecha(new Date()),
  ]);

  const productosMap: Record<string, { codigo: string; nombre: string }> = {};
  for (const p of productos) productosMap[p.id] = { codigo: p.codigo, nombre: p.nombre };

  const monedaPreferida: Moneda = session?.user.monedaPreferida === "ARS" ? "ARS" : "USD";
  const moneda: Moneda =
    monedaParam === "ARS" ? "ARS" : monedaParam === "USD" ? "USD" : monedaPreferida;
  const tc = cotizacion ? cotizacion.valor.toString() : null;
  const tcInfo = cotizacion
    ? {
        valor: cotizacion.valor.toString(),
        fecha: cotizacion.fecha.toISOString().slice(0, 10),
        fuente: cotizacion.fuente,
      }
    : null;

  // PR-014: aba contextual "Autorizaciones" (reusa PR-013). INERTE con la flag off
  // (la query cortocircuita a [] → "Sin aprobaciones", sin botón). El detalle queda
  // como la pestaña "General"; no se migra `PedidoVentaDetail` (fuera de alcance Onda 2).
  const approvalsOn = isApprovalsEnabled();
  const activeTab = resolveActiveTab(tab, ["general", "autorizaciones"], "general");
  const solicitudesPedido = await listarAprobacionesDeDocumento("PedidoVenta", String(id));

  return (
    <div className="flex flex-col gap-3">
      <RecordTabs
        activeValue={activeTab}
        tabs={[
          { value: "general", label: "General" },
          { value: "autorizaciones", label: "Autorizaciones", count: solicitudesPedido.length },
        ]}
      />
      {activeTab === "general" && (
        <PedidoVentaDetail
          pedido={pedido}
          clienteNombre={cliente?.nombre ?? "—"}
          productosMap={productosMap}
          ventasVinculadas={ventasVinculadas}
          moneda={moneda}
          tc={tc}
          tcInfo={tcInfo}
        />
      )}
      {activeTab === "autorizaciones" && (
        <AutorizacionesTab
          tabla="PedidoVenta"
          registroId={String(id)}
          solicitudes={solicitudesPedido}
          approvalsEnabled={approvalsOn}
          tiposPermitidos={TIPOS_VENTA}
        />
      )}
    </div>
  );
}
