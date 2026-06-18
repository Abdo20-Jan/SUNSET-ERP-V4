import { notFound } from "next/navigation";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  listarCategoriasCompra,
  listarDepositosNacionales,
  listarProductosParaCompra,
  listarProveedoresParaCompra,
  obtenerCompraPorId,
} from "@/lib/actions/compras";
import { getCotizacionParaFecha } from "@/lib/services/cotizacion";

import type { Moneda } from "../../reportes/_components/moneda-toggle";
import { CompraForm } from "../_components/compra-form";
import { CompraDetailView } from "../_components/compra-detail-view";

type PageParams = Promise<{ id: string }>;
type SearchParams = Promise<{ moneda?: string }>;

export const dynamic = "force-dynamic";

export default async function CompraDetailPage({
  params,
  searchParams,
}: {
  params: PageParams;
  searchParams: SearchParams;
}) {
  const { id } = await params;

  const compra = await obtenerCompraPorId(id);
  if (!compra) notFound();

  if (compra.estado === "BORRADOR") {
    const [proveedores, productos, categorias, depositos] = await Promise.all([
      listarProveedoresParaCompra(),
      listarProductosParaCompra(),
      listarCategoriasCompra(),
      listarDepositosNacionales(),
    ]);
    return (
      <CompraForm
        mode="edit"
        initialData={compra}
        proveedores={proveedores}
        productos={productos}
        categorias={categorias}
        depositos={depositos}
      />
    );
  }

  const [proveedor, productos, asiento, params2, session, cotizacion] = await Promise.all([
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
    searchParams,
    auth(),
    getCotizacionParaFecha(new Date()),
  ]);

  const productosMap: Record<string, { codigo: string; nombre: string }> = {};
  for (const p of productos) {
    productosMap[p.id] = { codigo: p.codigo, nombre: p.nombre };
  }

  const monedaPreferida: Moneda = session?.user.monedaPreferida === "ARS" ? "ARS" : "USD";
  const moneda: Moneda =
    params2.moneda === "ARS" ? "ARS" : params2.moneda === "USD" ? "USD" : monedaPreferida;
  const tc = cotizacion ? cotizacion.valor.toString() : null;
  const tcInfo = cotizacion
    ? {
        valor: cotizacion.valor.toString(),
        fecha: cotizacion.fecha.toISOString().slice(0, 10),
        fuente: cotizacion.fuente,
      }
    : null;

  return (
    <CompraDetailView
      compra={compra}
      proveedorNombre={proveedor?.nombre ?? "—"}
      productosMap={productosMap}
      asientoNumero={asiento?.numero ?? null}
      moneda={moneda}
      tc={tc}
      tcInfo={tcInfo}
    />
  );
}
