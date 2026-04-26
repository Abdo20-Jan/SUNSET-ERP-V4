import { notFound } from "next/navigation";

import { db } from "@/lib/db";
import {
  listarProductosParaCompra,
  listarProveedoresParaCompra,
  obtenerCompraPorId,
} from "@/lib/actions/compras";

import { CompraForm } from "../_components/compra-form";
import { CompraDetailView } from "../_components/compra-detail-view";

type PageParams = Promise<{ id: string }>;

export default async function CompraDetailPage({
  params,
}: {
  params: PageParams;
}) {
  const { id } = await params;

  const compra = await obtenerCompraPorId(id);
  if (!compra) notFound();

  if (compra.estado === "BORRADOR") {
    const [proveedores, productos] = await Promise.all([
      listarProveedoresParaCompra(),
      listarProductosParaCompra(),
    ]);
    return (
      <CompraForm
        mode="edit"
        initialData={compra}
        proveedores={proveedores}
        productos={productos}
      />
    );
  }

  const [proveedor, productos, asiento] = await Promise.all([
    db.proveedor.findUnique({
      where: { id: compra.proveedorId },
      select: { nombre: true },
    }),
    db.producto.findMany({
      where: { id: { in: compra.items.map((it) => it.productoId) } },
      select: { id: true, codigo: true, nombre: true },
    }),
    compra.asientoId
      ? db.asiento.findUnique({
          where: { id: compra.asientoId },
          select: { numero: true },
        })
      : Promise.resolve(null),
  ]);

  const productosMap: Record<string, { codigo: string; nombre: string }> = {};
  for (const p of productos) {
    productosMap[p.id] = { codigo: p.codigo, nombre: p.nombre };
  }

  return (
    <CompraDetailView
      compra={compra}
      proveedorNombre={proveedor?.nombre ?? "—"}
      productosMap={productosMap}
      asientoNumero={asiento?.numero ?? null}
    />
  );
}
