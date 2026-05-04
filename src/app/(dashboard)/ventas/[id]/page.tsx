import { notFound } from "next/navigation";

import { db } from "@/lib/db";
import {
  listarClientesParaVenta,
  listarDepositosParaVenta,
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
    const [clientes, productos, depositos] = await Promise.all([
      listarClientesParaVenta(),
      listarProductosParaVenta(),
      listarDepositosParaVenta(),
    ]);
    return (
      <VentaForm
        mode="edit"
        initialData={venta}
        clientes={clientes}
        productos={productos}
        depositos={depositos}
      />
    );
  }

  const depositoIds = venta.items.map((it) => it.depositoId).filter((d): d is string => d !== null);

  const [cliente, productos, depositos, asiento] = await Promise.all([
    db.cliente.findUnique({
      where: { id: venta.clienteId },
      select: { nombre: true },
    }),
    db.producto.findMany({
      where: { id: { in: venta.items.map((it) => it.productoId) } },
      select: { id: true, codigo: true, nombre: true },
    }),
    depositoIds.length > 0
      ? db.deposito.findMany({
          where: { id: { in: depositoIds } },
          select: { id: true, nombre: true },
        })
      : Promise.resolve([]),
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

  const depositosMap: Record<string, string> = {};
  for (const d of depositos) {
    depositosMap[d.id] = d.nombre;
  }

  return (
    <VentaDetailView
      venta={venta}
      clienteNombre={cliente?.nombre ?? "—"}
      productosMap={productosMap}
      depositosMap={depositosMap}
      asientoNumero={asiento?.numero ?? null}
    />
  );
}
