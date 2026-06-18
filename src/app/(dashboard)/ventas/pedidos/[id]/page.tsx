import { notFound } from "next/navigation";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  listarClientesParaPedidoVenta,
  listarProductosParaPedidoVenta,
  obtenerPedidoVentaPorId,
} from "@/lib/actions/pedidos-venta";
import { getCotizacionParaFecha } from "@/lib/services/cotizacion";

import type { Moneda } from "../../../reportes/_components/moneda-toggle";
import { PedidoVentaDetail } from "../_components/pedido-venta-detail";
import { PedidoVentaForm } from "../_components/pedido-venta-form";

type PageParams = Promise<{ id: string }>;
type SearchParams = Promise<{ editar?: string; moneda?: string }>;

export const dynamic = "force-dynamic";

export default async function PedidoVentaDetailPage({
  params,
  searchParams,
}: {
  params: PageParams;
  searchParams: SearchParams;
}) {
  const { id: idStr } = await params;
  const { editar, moneda: monedaParam } = await searchParams;
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

  return (
    <PedidoVentaDetail
      pedido={pedido}
      clienteNombre={cliente?.nombre ?? "—"}
      productosMap={productosMap}
      ventasVinculadas={ventasVinculadas}
      moneda={moneda}
      tc={tc}
      tcInfo={tcInfo}
    />
  );
}
