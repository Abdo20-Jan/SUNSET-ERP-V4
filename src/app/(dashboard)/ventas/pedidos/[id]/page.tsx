import { notFound } from "next/navigation";

import { db } from "@/lib/db";
import {
  listarClientesParaPedidoVenta,
  listarProductosParaPedidoVenta,
  obtenerPedidoVentaPorId,
} from "@/lib/actions/pedidos-venta";

import { PedidoVentaDetail } from "../_components/pedido-venta-detail";
import { PedidoVentaForm } from "../_components/pedido-venta-form";

type PageParams = Promise<{ id: string }>;
type SearchParams = Promise<{ editar?: string }>;

export default async function PedidoVentaDetailPage({
  params,
  searchParams,
}: {
  params: PageParams;
  searchParams: SearchParams;
}) {
  const { id: idStr } = await params;
  const { editar } = await searchParams;
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
      <PedidoVentaForm
        mode="edit"
        initialData={pedido}
        clientes={clientes}
        productos={productos}
      />
    );
  }

  const [cliente, productos, ventasVinculadas] = await Promise.all([
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
  ]);

  const productosMap: Record<string, { codigo: string; nombre: string }> = {};
  for (const p of productos) productosMap[p.id] = { codigo: p.codigo, nombre: p.nombre };

  return (
    <PedidoVentaDetail
      pedido={pedido}
      clienteNombre={cliente?.nombre ?? "—"}
      productosMap={productosMap}
      ventasVinculadas={ventasVinculadas}
    />
  );
}
