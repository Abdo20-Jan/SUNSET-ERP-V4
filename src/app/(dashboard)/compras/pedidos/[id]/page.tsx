import { notFound } from "next/navigation";

import { db } from "@/lib/db";
import {
  listarProductosParaPedidoCompra,
  listarProveedoresParaPedidoCompra,
  obtenerPedidoCompraPorId,
} from "@/lib/actions/pedidos-compra";

import { PedidoCompraDetail } from "../_components/pedido-compra-detail";
import { PedidoCompraForm } from "../_components/pedido-compra-form";

type PageParams = Promise<{ id: string }>;
type SearchParams = Promise<{ editar?: string }>;

export default async function PedidoCompraDetailPage({
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

  const pedido = await obtenerPedidoCompraPorId(id);
  if (!pedido) notFound();

  const editable = pedido.estado === "BORRADOR" || pedido.estado === "ENVIADO";

  if (editable && editar === "1") {
    const [proveedores, productos] = await Promise.all([
      listarProveedoresParaPedidoCompra(),
      listarProductosParaPedidoCompra(),
    ]);
    return (
      <PedidoCompraForm
        mode="edit"
        initialData={pedido}
        proveedores={proveedores}
        productos={productos}
      />
    );
  }

  const [proveedor, productos, comprasVinculadas] = await Promise.all([
    db.proveedor.findUnique({
      where: { id: pedido.proveedorId },
      select: { nombre: true },
    }),
    db.producto.findMany({
      where: { id: { in: pedido.items.map((it) => it.productoId) } },
      select: { id: true, codigo: true, nombre: true },
    }),
    db.compra.findMany({
      where: { pedidoCompraId: id },
      select: { id: true, numero: true, estado: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const productosMap: Record<string, { codigo: string; nombre: string }> = {};
  for (const p of productos) productosMap[p.id] = { codigo: p.codigo, nombre: p.nombre };

  return (
    <PedidoCompraDetail
      pedido={pedido}
      proveedorNombre={proveedor?.nombre ?? "—"}
      productosMap={productosMap}
      comprasVinculadas={comprasVinculadas}
    />
  );
}
