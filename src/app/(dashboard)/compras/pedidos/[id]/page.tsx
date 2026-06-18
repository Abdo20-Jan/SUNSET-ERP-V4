import { notFound } from "next/navigation";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  listarProductosParaPedidoCompra,
  listarProveedoresParaPedidoCompra,
  obtenerPedidoCompraPorId,
} from "@/lib/actions/pedidos-compra";
import { getCotizacionParaFecha } from "@/lib/services/cotizacion";

import type { Moneda } from "../../../reportes/_components/moneda-toggle";
import { PedidoCompraDetail } from "../_components/pedido-compra-detail";
import { PedidoCompraForm } from "../_components/pedido-compra-form";

type PageParams = Promise<{ id: string }>;
type SearchParams = Promise<{ editar?: string; moneda?: string }>;

export const dynamic = "force-dynamic";

export default async function PedidoCompraDetailPage({
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

  const [proveedor, productos, comprasVinculadas, session, cotizacion] = await Promise.all([
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
    <PedidoCompraDetail
      pedido={pedido}
      proveedorNombre={proveedor?.nombre ?? "—"}
      productosMap={productosMap}
      comprasVinculadas={comprasVinculadas}
      moneda={moneda}
      tc={tc}
      tcInfo={tcInfo}
    />
  );
}
