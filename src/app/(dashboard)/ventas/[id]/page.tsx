import { notFound } from "next/navigation";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isStockDualEnabled } from "@/lib/features";
import { listarProveedoresParaGasto } from "@/lib/actions/gastos";
import {
  listarClientesParaVenta,
  listarDepositosParaVenta,
  listarProductosParaVenta,
  obtenerVentaPorId,
} from "@/lib/actions/ventas";
import { getCotizacionParaFecha } from "@/lib/services/cotizacion";

import type { Moneda } from "../../reportes/_components/moneda-toggle";
import { VentaForm } from "../_components/venta-form";
import { VentaDetailView } from "../_components/venta-detail-view";

type PageParams = Promise<{ id: string }>;
type SearchParams = Promise<{ moneda?: string }>;

export const dynamic = "force-dynamic";

export default async function VentaDetailPage({
  params,
  searchParams,
}: {
  params: PageParams;
  searchParams: SearchParams;
}) {
  const { id } = await params;

  const venta = await obtenerVentaPorId(id);
  if (!venta) notFound();

  if (venta.estado === "BORRADOR") {
    const [clientes, productos, depositos, proveedores] = await Promise.all([
      listarClientesParaVenta(),
      listarProductosParaVenta(),
      listarDepositosParaVenta(),
      listarProveedoresParaGasto(),
    ]);
    return (
      <VentaForm
        mode="edit"
        initialData={venta}
        clientes={clientes}
        productos={productos}
        depositos={depositos}
        proveedores={proveedores}
      />
    );
  }

  const depositoIds = venta.items.map((it) => it.depositoId).filter((d): d is string => d !== null);
  const stockDualOn = isStockDualEnabled();

  const [cliente, productos, depositos, asiento, entregasPendientes, params2, session, cotizacion] =
    await Promise.all([
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
      stockDualOn
        ? db.entregaVenta.count({ where: { ventaId: id, estado: "BORRADOR" } })
        : Promise.resolve(0),
      searchParams,
      auth(),
      getCotizacionParaFecha(new Date()),
    ]);

  const productosMap: Record<string, { codigo: string; nombre: string }> = {};
  for (const p of productos) {
    productosMap[p.id] = { codigo: p.codigo, nombre: p.nombre };
  }

  const depositosMap: Record<string, string> = {};
  for (const d of depositos) {
    depositosMap[d.id] = d.nombre;
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
    <VentaDetailView
      venta={venta}
      clienteNombre={cliente?.nombre ?? "—"}
      productosMap={productosMap}
      depositosMap={depositosMap}
      asientoNumero={asiento?.numero ?? null}
      stockDualOn={stockDualOn}
      entregasPendientes={entregasPendientes}
      moneda={moneda}
      tc={tc}
      tcInfo={tcInfo}
    />
  );
}
