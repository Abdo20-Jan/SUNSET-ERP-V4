"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { isStockDualEnabled } from "@/lib/features";
import {
  AsientoError,
  anularAsiento,
  contabilizarAsiento,
  crearAsientoEntrega,
} from "@/lib/services/asiento-automatico";
import { aplicarEgresoSPD } from "@/lib/services/stock";
import { getStockPorDeposito } from "@/lib/services/stock-helpers";
import {
  EntregaEstado,
  MovimientoStockTipo,
  Prisma,
} from "@/generated/prisma/client";

type TxClient = Prisma.TransactionClient;

const itemEntregaInputSchema = z.object({
  itemVentaId: z.number().int().positive(),
  cantidad: z.number().int().positive(),
});

const crearEntregaSchema = z.object({
  ventaId: z.string().min(1),
  depositoId: z.string().min(1),
  fecha: z.coerce.date(),
  observacion: z.string().optional(),
  items: z.array(itemEntregaInputSchema).min(1),
});

export type CrearEntregaInput = z.input<typeof crearEntregaSchema>;

type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

async function generarNumeroEntrega(tx: TxClient): Promise<string> {
  const year = new Date().getFullYear();
  const last = await tx.entregaVenta.findFirst({
    where: { numero: { startsWith: `R-${year}-` } },
    orderBy: { numero: "desc" },
    select: { numero: true },
  });
  const nextSeq = last
    ? Number.parseInt(last.numero.slice(`R-${year}-`.length), 10) + 1
    : 1;
  return `R-${year}-${String(nextSeq).padStart(4, "0")}`;
}

/**
 * Valida que la cantidad acumulada por itemVenta entre todas las
 * entregas (BORRADOR + CONFIRMADA) no supere ItemVenta.cantidad.
 * Lanza AsientoError DOMINIO_INVALIDO si hay overcommit.
 */
async function validarTopeItemVenta(
  tx: TxClient,
  itemVentaId: number,
  cantidadNueva: number,
): Promise<void> {
  const itemVenta = await tx.itemVenta.findUnique({
    where: { id: itemVentaId },
    select: { id: true, cantidad: true, productoId: true },
  });
  if (!itemVenta) {
    throw new AsientoError(
      "DOMINIO_INVALIDO",
      `ItemVenta ${itemVentaId} no existe.`,
    );
  }
  const yaEntregado = await tx.itemEntrega.aggregate({
    where: {
      itemVentaId,
      entrega: { estado: { not: EntregaEstado.ANULADA } },
    },
    _sum: { cantidad: true },
  });
  const acumulado = (yaEntregado._sum.cantidad ?? 0) + cantidadNueva;
  if (acumulado > itemVenta.cantidad) {
    throw new AsientoError(
      "DOMINIO_INVALIDO",
      `ItemVenta ${itemVentaId}: entrega excede el total vendido (${acumulado} > ${itemVenta.cantidad}).`,
    );
  }
}

/**
 * Crea una entrega en estado BORRADOR. NO toca stock ni asiento — sólo
 * persiste la nota. La confirmación es un paso separado (ver
 * `confirmarEntregaAction`).
 *
 * Sólo disponible cuando STOCK_DUAL_ENABLED=true.
 */
export async function crearEntregaAction(
  raw: CrearEntregaInput,
): Promise<ActionResult<{ entregaId: string; numero: string }>> {
  if (!isStockDualEnabled()) {
    return {
      ok: false,
      error: "Stock dual no está habilitado (flag STOCK_DUAL_ENABLED=false).",
    };
  }
  const parse = crearEntregaSchema.safeParse(raw);
  if (!parse.success) {
    const first = parse.error.issues[0];
    return {
      ok: false,
      error: first ? `${first.path.join(".")}: ${first.message}` : "Input inválido.",
    };
  }
  const input = parse.data;
  try {
    const result = await db.$transaction(async (tx) => {
      const venta = await tx.venta.findUnique({
        where: { id: input.ventaId },
        select: { id: true, estado: true, numero: true },
      });
      if (!venta) {
        throw new AsientoError("DOMINIO_INVALIDO", "Venta no existe.");
      }
      if (venta.estado !== "EMITIDA") {
        throw new AsientoError(
          "DOMINIO_INVALIDO",
          `Venta ${venta.numero} debe estar EMITIDA para entregar (estado actual: ${venta.estado}).`,
        );
      }
      const dep = await tx.deposito.findUnique({
        where: { id: input.depositoId },
        select: { id: true, activo: true },
      });
      if (!dep || !dep.activo) {
        throw new AsientoError(
          "DOMINIO_INVALIDO",
          "Depósito de entrega no existe o está inactivo.",
        );
      }

      // Validar topes por item de venta
      for (const it of input.items) {
        await validarTopeItemVenta(tx, it.itemVentaId, it.cantidad);
      }

      const numero = await generarNumeroEntrega(tx);
      const entrega = await tx.entregaVenta.create({
        data: {
          numero,
          ventaId: input.ventaId,
          depositoId: input.depositoId,
          fecha: input.fecha,
          observacion: input.observacion,
          estado: EntregaEstado.BORRADOR,
          items: {
            create: input.items.map((it) => ({
              itemVentaId: it.itemVentaId,
              cantidad: it.cantidad,
              costoUnitario: 0, // se setea al confirmar (snapshot del costoPromedio del depósito)
            })),
          },
        },
        select: { id: true, numero: true },
      });
      return entrega;
    });
    revalidatePath(`/ventas/${input.ventaId}`);
    revalidatePath(`/ventas/${input.ventaId}/entregas`);
    return { ok: true, data: { entregaId: result.id, numero: result.numero } };
  } catch (err) {
    if (err instanceof AsientoError) return { ok: false, error: err.message };
    return { ok: false, error: "Error al crear la entrega." };
  }
}

/**
 * Confirma una entrega BORRADOR: snapshot de costos, MovimientoStock EGRESO,
 * decremento de cantidadFisica + cantidadReservada en SPD, y asiento contable
 * (DEBE 1.1.5.03 / HABER 1.1.5.01). Estado pasa a CONFIRMADA.
 */
export async function confirmarEntregaAction(
  entregaId: string,
): Promise<ActionResult<{ numeroAsiento: number }>> {
  if (!isStockDualEnabled()) {
    return {
      ok: false,
      error: "Stock dual no está habilitado (flag STOCK_DUAL_ENABLED=false).",
    };
  }
  try {
    const result = await db.$transaction(async (tx) => {
      const entrega = await tx.entregaVenta.findUnique({
        where: { id: entregaId },
        select: {
          id: true,
          numero: true,
          fecha: true,
          estado: true,
          asientoId: true,
          ventaId: true,
          depositoId: true,
          items: {
            select: {
              id: true,
              itemVentaId: true,
              cantidad: true,
              itemVenta: {
                select: { productoId: true, producto: { select: { codigo: true } } },
              },
            },
          },
        },
      });
      if (!entrega) {
        throw new AsientoError("DOMINIO_INVALIDO", "Entrega no existe.");
      }
      if (entrega.estado !== EntregaEstado.BORRADOR) {
        throw new AsientoError(
          "DOMINIO_INVALIDO",
          `Entrega ${entrega.numero} no está en BORRADOR (estado actual: ${entrega.estado}).`,
        );
      }
      if (entrega.asientoId) {
        throw new AsientoError(
          "DOMINIO_INVALIDO",
          `Entrega ${entrega.numero} ya tiene asiento.`,
        );
      }

      // Por cada ítem: validar disponibilidad física, capturar costoPromedio
      // del depósito como snapshot, generar MovimientoStock EGRESO, decrementar
      // SPD (físico + reservado), actualizar ItemEntrega.costoUnitario.
      for (const it of entrega.items) {
        const productoId = it.itemVenta.productoId;
        const stock = await getStockPorDeposito(
          tx,
          productoId,
          entrega.depositoId,
        );
        if (!stock || stock.cantidadFisica < it.cantidad) {
          throw new AsientoError(
            "DOMINIO_INVALIDO",
            `Stock físico insuficiente: producto ${it.itemVenta.producto.codigo} en depósito ${entrega.depositoId} tiene ${stock?.cantidadFisica ?? 0}, entrega requiere ${it.cantidad}.`,
          );
        }
        const costoUnit = stock.costoPromedio;
        await tx.itemEntrega.update({
          where: { id: it.id },
          data: { costoUnitario: costoUnit },
        });
        await tx.movimientoStock.create({
          data: {
            productoId,
            depositoId: entrega.depositoId,
            tipo: MovimientoStockTipo.EGRESO,
            cantidad: it.cantidad,
            costoUnitario: costoUnit,
            fecha: entrega.fecha,
            itemEntregaId: it.id,
          },
        });
        await aplicarEgresoSPD(tx, productoId, entrega.depositoId, it.cantidad);
      }

      const asiento = await crearAsientoEntrega(entregaId, tx);
      const cont = await contabilizarAsiento(asiento.id, tx);
      await tx.entregaVenta.update({
        where: { id: entregaId },
        data: { estado: EntregaEstado.CONFIRMADA },
      });
      return { ventaId: entrega.ventaId, numeroAsiento: cont.numero };
    });
    revalidatePath(`/ventas/${result.ventaId}`);
    revalidatePath(`/ventas/${result.ventaId}/entregas`);
    revalidatePath("/ventas");
    return { ok: true, data: { numeroAsiento: result.numeroAsiento } };
  } catch (err) {
    if (err instanceof AsientoError) return { ok: false, error: err.message };
    return { ok: false, error: "Error al confirmar la entrega." };
  }
}

/**
 * Anula una entrega:
 *  - BORRADOR: borra la entrega y sus items (no había MovimientoStock).
 *  - CONFIRMADA: reverte MovimientoStock EGRESO, restaura cantidadFisica
 *    + cantidadReservada (la reserva original de la venta), anula asiento,
 *    marca ANULADA.
 */
export async function anularEntregaAction(
  entregaId: string,
): Promise<ActionResult> {
  if (!isStockDualEnabled()) {
    return {
      ok: false,
      error: "Stock dual no está habilitado (flag STOCK_DUAL_ENABLED=false).",
    };
  }
  try {
    await db.$transaction(async (tx) => {
      const entrega = await tx.entregaVenta.findUnique({
        where: { id: entregaId },
        select: {
          id: true,
          numero: true,
          ventaId: true,
          depositoId: true,
          estado: true,
          asientoId: true,
          items: {
            select: {
              id: true,
              cantidad: true,
              itemVenta: { select: { productoId: true } },
            },
          },
        },
      });
      if (!entrega) {
        throw new AsientoError("DOMINIO_INVALIDO", "Entrega no existe.");
      }
      if (entrega.estado === EntregaEstado.ANULADA) {
        return;
      }
      if (entrega.estado === EntregaEstado.BORRADOR) {
        await tx.itemEntrega.deleteMany({ where: { entregaId } });
        await tx.entregaVenta.delete({ where: { id: entregaId } });
        return;
      }

      // CONFIRMADA: revertir efecto físico/contable.
      // 1) Revertir MovimientoStock EGRESO + restaurar SPD (cantidadFisica
      //    sube, cantidadReservada también — la venta original sigue reservando).
      for (const it of entrega.items) {
        await tx.movimientoStock.deleteMany({
          where: { itemEntregaId: it.id },
        });
        await tx.stockPorDeposito.update({
          where: {
            productoId_depositoId: {
              productoId: it.itemVenta.productoId,
              depositoId: entrega.depositoId,
            },
          },
          data: {
            cantidadFisica: { increment: it.cantidad },
            cantidadReservada: { increment: it.cantidad },
            ultimoMovimiento: new Date(),
          },
        });
      }
      // 2) Anular asiento (si existe) — anularEnTx desvincula entrega.
      if (entrega.asientoId) {
        await anularAsiento(entrega.asientoId, tx);
      }
      await tx.entregaVenta.update({
        where: { id: entregaId },
        data: { estado: EntregaEstado.ANULADA },
      });
    });
    revalidatePath("/ventas");
    return { ok: true, data: undefined };
  } catch (err) {
    if (err instanceof AsientoError) return { ok: false, error: err.message };
    return { ok: false, error: "Error al anular la entrega." };
  }
}

/**
 * Lista las entregas de una venta. Útil para la UI del detalle de venta.
 */
export async function listarEntregasDeVenta(ventaId: string) {
  return db.entregaVenta.findMany({
    where: { ventaId },
    orderBy: { fecha: "asc" },
    select: {
      id: true,
      numero: true,
      fecha: true,
      estado: true,
      observacion: true,
      deposito: { select: { id: true, nombre: true } },
      items: {
        select: {
          id: true,
          cantidad: true,
          costoUnitario: true,
          itemVenta: {
            select: {
              id: true,
              cantidad: true,
              producto: { select: { codigo: true, nombre: true } },
            },
          },
        },
      },
    },
  });
}

/**
 * Devuelve el saldo pendiente de entrega por ItemVenta (cantidad vendida
 * menos lo ya entregado en entregas no anuladas). Útil para construir el
 * formulario de "nueva entrega".
 */
export async function saldoPendientePorItemVenta(ventaId: string) {
  const venta = await db.venta.findUnique({
    where: { id: ventaId },
    select: {
      items: {
        select: {
          id: true,
          cantidad: true,
          producto: { select: { codigo: true, nombre: true } },
        },
      },
    },
  });
  if (!venta) return [];
  const result = [];
  for (const it of venta.items) {
    const ya = await db.itemEntrega.aggregate({
      where: {
        itemVentaId: it.id,
        entrega: { estado: { not: EntregaEstado.ANULADA } },
      },
      _sum: { cantidad: true },
    });
    const entregado = ya._sum.cantidad ?? 0;
    const pendiente = it.cantidad - entregado;
    result.push({
      itemVentaId: it.id,
      productoCodigo: it.producto.codigo,
      productoNombre: it.producto.nombre,
      vendido: it.cantidad,
      entregado,
      pendiente,
    });
  }
  return result;
}

