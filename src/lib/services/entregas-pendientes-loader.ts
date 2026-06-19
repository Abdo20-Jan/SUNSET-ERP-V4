import { EntregaEstado, type PrismaClient, VentaEstado } from "@/generated/prisma/client";
import { resumenPendienteVenta } from "./entregas-pendientes";

// Carga las ventas EMITIDA cuyo despacho físico (remito CONFIRMADA) aún no
// cubre todo lo vendido — la lista del hub de entregas. Recibe el client por
// parámetro (la action usa @/lib/db; los tests usan el del contenedor).
//
// Importante: el "entregado" cuenta SOLO remitos CONFIRMADA. Un BORRADOR no
// reduce el pendiente (la cuenta-puente 1.1.7.90 sigue abierta hasta
// confirmar), pero se reporta en `nBorrador` para señalar que sólo falta
// confirmarlo.

export type VentaConPendiente = {
  ventaId: string;
  numero: string;
  fecha: Date;
  clienteNombre: string;
  unidadesVendidas: number;
  unidadesPendientes: number;
  nBorrador: number;
  nConfirmadas: number;
};

export async function cargarVentasConEntregaPendiente(
  client: PrismaClient,
): Promise<VentaConPendiente[]> {
  const ventas = await client.venta.findMany({
    where: { estado: VentaEstado.EMITIDA },
    orderBy: { fecha: "asc" },
    select: {
      id: true,
      numero: true,
      fecha: true,
      cliente: { select: { nombre: true } },
      items: { select: { id: true, cantidad: true } },
      entregas: { select: { estado: true } },
    },
  });

  const itemIds = ventas.flatMap((v) => v.items.map((it) => it.id));
  const agregados = itemIds.length
    ? await client.itemEntrega.groupBy({
        by: ["itemVentaId"],
        where: {
          itemVentaId: { in: itemIds },
          entrega: { estado: EntregaEstado.CONFIRMADA },
        },
        _sum: { cantidad: true },
      })
    : [];
  const confirmadoPorItem = new Map(agregados.map((a) => [a.itemVentaId, a._sum.cantidad ?? 0]));

  const result: VentaConPendiente[] = [];
  for (const v of ventas) {
    const resumen = resumenPendienteVenta(
      v.items.map((it) => ({ vendido: it.cantidad, entregado: confirmadoPorItem.get(it.id) ?? 0 })),
    );
    if (!resumen.tienePendiente) continue;
    result.push({
      ventaId: v.id,
      numero: v.numero,
      fecha: v.fecha,
      clienteNombre: v.cliente.nombre,
      unidadesVendidas: resumen.unidadesVendidas,
      unidadesPendientes: resumen.unidadesPendientes,
      nBorrador: v.entregas.filter((e) => e.estado === EntregaEstado.BORRADOR).length,
      nConfirmadas: v.entregas.filter((e) => e.estado === EntregaEstado.CONFIRMADA).length,
    });
  }
  return result;
}
