import { notFound } from "next/navigation";

import { db } from "@/lib/db";
import {
  listarClientesParaVenta,
  listarProductosParaVenta,
  obtenerVentaPorId,
} from "@/lib/actions/ventas";

import { VentaForm } from "../_components/venta-form";
import { VentaDetailView } from "../_components/venta-detail-view";

type PageParams = Promise<{ id: string }>;

export default async function VentaDetailPage({
  params,
}: {
  params: PageParams;
}) {
  const { id } = await params;

  const venta = await obtenerVentaPorId(id);
  if (!venta) notFound();

  if (venta.estado === "BORRADOR") {
    const [clientes, productos] = await Promise.all([
      listarClientesParaVenta(),
      listarProductosParaVenta(),
    ]);
    return (
      <VentaForm
        mode="edit"
        initialData={venta}
        clientes={clientes}
        productos={productos}
      />
    );
  }

  const [cliente, productos, asiento] = await Promise.all([
    db.cliente.findUnique({
      where: { id: venta.clienteId },
      select: { nombre: true },
    }),
    db.producto.findMany({
      where: { id: { in: venta.items.map((it) => it.productoId) } },
      select: { id: true, codigo: true, nombre: true },
    }),
    venta.asientoId
      ? db.asiento.findUnique({
          where: { id: venta.asientoId },
          select: { numero: true },
        })
      : Promise.resolve(null),
  ]);

  const productosMap: Record<string, { codigo: string; nombre: string }> = {};
  for (const p of productos) {
    productosMap[p.id] = { codigo: p.codigo, nombre: p.nombre };
  }

  return (
    <VentaDetailView
      venta={venta}
      clienteNombre={cliente?.nombre ?? "—"}
      productosMap={productosMap}
      asientoNumero={asiento?.numero ?? null}
    />
  );
}
