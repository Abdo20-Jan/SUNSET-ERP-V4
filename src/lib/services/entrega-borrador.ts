import "server-only";

import { EntregaEstado, type Prisma } from "@/generated/prisma/client";
import { getDepositoPorDefecto } from "./stock-helpers";

type TxClient = Prisma.TransactionClient;

// Genera el próximo número de remito (R-YYYY-NNNN). Compartido entre la
// creación manual (entregas.ts) y la automática (al emitir venta). Dentro de
// una misma transacción, lecturas sucesivas ven los creates previos, así que
// múltiples entregas en la misma emisión incrementan correctamente.
export async function generarNumeroEntrega(tx: TxClient): Promise<string> {
  const year = new Date().getFullYear();
  const last = await tx.entregaVenta.findFirst({
    where: { numero: { startsWith: `R-${year}-` } },
    orderBy: { numero: "desc" },
    select: { numero: true },
  });
  const nextSeq = last ? Number.parseInt(last.numero.slice(`R-${year}-`.length), 10) + 1 : 1;
  return `R-${year}-${String(nextSeq).padStart(4, "0")}`;
}

/**
 * Crea automáticamente la(s) entrega(s) BORRADOR por defecto al emitir una
 * venta (stock-dual ON): una EntregaVenta BORRADOR por depósito, con el 100%
 * de cada ItemVenta. NO mueve stock físico ni genera asiento — eso ocurre al
 * CONFIRMAR la entrega. El objetivo es hacer la entrega VISIBLE/pendiente para
 * que la cuenta-puente 1.1.7.90 "Estoque a Entregar" no acumule olvidada.
 *
 * Idempotente: si la venta ya tiene alguna entrega no-ANULADA, no crea nada y
 * devuelve []. Caso contrario devuelve los ids de las entregas creadas.
 */
export async function crearEntregaBorradorPorDefecto(
  tx: TxClient,
  ventaId: string,
  fecha: Date,
): Promise<string[]> {
  const existentes = await tx.entregaVenta.count({
    where: { ventaId, estado: { not: EntregaEstado.ANULADA } },
  });
  if (existentes > 0) return [];

  const items = await tx.itemVenta.findMany({
    where: { ventaId },
    select: { id: true, cantidad: true, depositoId: true },
  });
  if (items.length === 0) return [];

  const defaultDepId = await getDepositoPorDefecto(tx);

  // Agrupa los items por depósito (uno..N entregas: la reserva en la emisión
  // también es por depósito del item, así el egreso saldrá del mismo lugar).
  const porDeposito = new Map<string, { itemVentaId: number; cantidad: number }[]>();
  for (const it of items) {
    const depId = it.depositoId ?? defaultDepId;
    const arr = porDeposito.get(depId) ?? [];
    arr.push({ itemVentaId: it.id, cantidad: it.cantidad });
    porDeposito.set(depId, arr);
  }

  const creadas: string[] = [];
  for (const [depositoId, lineas] of porDeposito) {
    const numero = await generarNumeroEntrega(tx);
    const entrega = await tx.entregaVenta.create({
      data: {
        numero,
        ventaId,
        depositoId,
        fecha,
        estado: EntregaEstado.BORRADOR,
        items: {
          create: lineas.map((l) => ({
            itemVentaId: l.itemVentaId,
            cantidad: l.cantidad,
            costoUnitario: 0,
          })),
        },
      },
      select: { id: true },
    });
    creadas.push(entrega.id);
  }
  return creadas;
}
