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
import { EntregaEstado, MovimientoStockTipo, type Prisma } from "@/generated/prisma/client";

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

type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

const FLAG_OFF_ERROR = {
  ok: false as const,
  error: "Stock dual no está habilitado (flag STOCK_DUAL_ENABLED=false).",
};

// ---------------------------------------------------------------
// Helpers compartidos
// ---------------------------------------------------------------

async function generarNumeroEntrega(tx: TxClient): Promise<string> {
  const year = new Date().getFullYear();
  const last = await tx.entregaVenta.findFirst({
    where: { numero: { startsWith: `R-${year}-` } },
    orderBy: { numero: "desc" },
    select: { numero: true },
  });
  const nextSeq = last ? Number.parseInt(last.numero.slice(`R-${year}-`.length), 10) + 1 : 1;
  return `R-${year}-${String(nextSeq).padStart(4, "0")}`;
}

async function validarTopeItemVenta(
  tx: TxClient,
  itemVentaId: number,
  cantidadNueva: number,
): Promise<void> {
  const itemVenta = await tx.itemVenta.findUnique({
    where: { id: itemVentaId },
    select: { id: true, cantidad: true },
  });
  if (!itemVenta) {
    throw new AsientoError("DOMINIO_INVALIDO", `ItemVenta ${itemVentaId} no existe.`);
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

function parseEntregaInput(raw: CrearEntregaInput): z.infer<typeof crearEntregaSchema> {
  const parse = crearEntregaSchema.safeParse(raw);
  if (!parse.success) {
    const first = parse.error.issues[0];
    throw new AsientoError(
      "DOMINIO_INVALIDO",
      first ? `${first.path.join(".")}: ${first.message}` : "Input inválido.",
    );
  }
  return parse.data;
}

async function ensureVentaEmitida(tx: TxClient, ventaId: string): Promise<void> {
  const venta = await tx.venta.findUnique({
    where: { id: ventaId },
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
}

async function ensureDepositoActivo(tx: TxClient, depositoId: string): Promise<void> {
  const dep = await tx.deposito.findUnique({
    where: { id: depositoId },
    select: { id: true, activo: true },
  });
  if (!dep || !dep.activo) {
    throw new AsientoError("DOMINIO_INVALIDO", "Depósito de entrega no existe o está inactivo.");
  }
}

// ---------------------------------------------------------------
// Crear entrega (BORRADOR)
// ---------------------------------------------------------------

export async function crearEntregaAction(
  raw: CrearEntregaInput,
): Promise<ActionResult<{ entregaId: string; numero: string }>> {
  if (!isStockDualEnabled()) return FLAG_OFF_ERROR;
  try {
    const input = parseEntregaInput(raw);
    const result = await db.$transaction(async (tx) => {
      await ensureVentaEmitida(tx, input.ventaId);
      await ensureDepositoActivo(tx, input.depositoId);
      for (const it of input.items) {
        await validarTopeItemVenta(tx, it.itemVentaId, it.cantidad);
      }
      const numero = await generarNumeroEntrega(tx);
      return tx.entregaVenta.create({
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
              costoUnitario: 0,
            })),
          },
        },
        select: { id: true, numero: true },
      });
    });
    revalidatePath(`/ventas/${input.ventaId}`);
    revalidatePath(`/ventas/${input.ventaId}/entregas`);
    return { ok: true, data: { entregaId: result.id, numero: result.numero } };
  } catch (err) {
    if (err instanceof AsientoError) return { ok: false, error: err.message };
    return { ok: false, error: "Error al crear la entrega." };
  }
}

// ---------------------------------------------------------------
// Confirmar entrega (BORRADOR → CONFIRMADA)
// ---------------------------------------------------------------

type EntregaEnConfirmacion = NonNullable<Awaited<ReturnType<typeof loadEntregaForConfirm>>>;

async function loadEntregaForConfirm(tx: TxClient, entregaId: string) {
  return tx.entregaVenta.findUnique({
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
            select: {
              productoId: true,
              depositoId: true,
              producto: { select: { codigo: true } },
            },
          },
        },
      },
    },
  });
}

function ensureEntregaConfirmable(entrega: EntregaEnConfirmacion): void {
  if (entrega.estado !== EntregaEstado.BORRADOR) {
    throw new AsientoError(
      "DOMINIO_INVALIDO",
      `Entrega ${entrega.numero} no está en BORRADOR (estado actual: ${entrega.estado}).`,
    );
  }
  if (entrega.asientoId) {
    throw new AsientoError("DOMINIO_INVALIDO", `Entrega ${entrega.numero} ya tiene asiento.`);
  }
}

async function aplicarEgresoFisicoItem(
  tx: TxClient,
  entrega: EntregaEnConfirmacion,
  it: EntregaEnConfirmacion["items"][number],
): Promise<void> {
  const productoId = it.itemVenta.productoId;
  // S3.1: cuando el ItemVenta tiene depósito explícito, la entrega debe
  // hacerse desde ese mismo depósito — caso contrario, la reserva quedó
  // en un depósito y el egreso saldría de otro, dejando los stocks
  // desincronizados.
  const itemDepId = it.itemVenta.depositoId;
  if (itemDepId && itemDepId !== entrega.depositoId) {
    throw new AsientoError(
      "DOMINIO_INVALIDO",
      `Item ${it.itemVenta.producto.codigo}: la venta lo reservó en otro depósito (${itemDepId}); cree una entrega separada desde ese depósito.`,
    );
  }
  const stock = await getStockPorDeposito(tx, productoId, entrega.depositoId);
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

export async function confirmarEntregaAction(
  entregaId: string,
): Promise<ActionResult<{ numeroAsiento: number }>> {
  if (!isStockDualEnabled()) return FLAG_OFF_ERROR;
  try {
    const result = await db.$transaction(async (tx) => {
      const entrega = await loadEntregaForConfirm(tx, entregaId);
      if (!entrega) {
        throw new AsientoError("DOMINIO_INVALIDO", "Entrega no existe.");
      }
      ensureEntregaConfirmable(entrega);
      for (const it of entrega.items) {
        await aplicarEgresoFisicoItem(tx, entrega, it);
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

// ---------------------------------------------------------------
// Anular entrega
// ---------------------------------------------------------------

type EntregaEnAnulacion = NonNullable<Awaited<ReturnType<typeof loadEntregaForAnular>>>;

async function loadEntregaForAnular(tx: TxClient, entregaId: string) {
  return tx.entregaVenta.findUnique({
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
}

async function restaurarSPDPorItemAnulacion(
  tx: TxClient,
  depositoId: string,
  it: EntregaEnAnulacion["items"][number],
): Promise<void> {
  await tx.movimientoStock.deleteMany({
    where: { itemEntregaId: it.id },
  });
  await tx.stockPorDeposito.update({
    where: {
      productoId_depositoId: {
        productoId: it.itemVenta.productoId,
        depositoId,
      },
    },
    data: {
      cantidadFisica: { increment: it.cantidad },
      cantidadReservada: { increment: it.cantidad },
      ultimoMovimiento: new Date(),
    },
  });
}

async function revertirEntregaConfirmada(tx: TxClient, entrega: EntregaEnAnulacion): Promise<void> {
  for (const it of entrega.items) {
    await restaurarSPDPorItemAnulacion(tx, entrega.depositoId, it);
  }
  if (entrega.asientoId) {
    await anularAsiento(entrega.asientoId, tx);
  }
  await tx.entregaVenta.update({
    where: { id: entrega.id },
    data: { estado: EntregaEstado.ANULADA },
  });
}

export async function anularEntregaAction(entregaId: string): Promise<ActionResult> {
  if (!isStockDualEnabled()) return FLAG_OFF_ERROR;
  try {
    await db.$transaction(async (tx) => {
      const entrega = await loadEntregaForAnular(tx, entregaId);
      if (!entrega) {
        throw new AsientoError("DOMINIO_INVALIDO", "Entrega no existe.");
      }
      if (entrega.estado === EntregaEstado.ANULADA) return;
      if (entrega.estado === EntregaEstado.BORRADOR) {
        await tx.itemEntrega.deleteMany({ where: { entregaId } });
        await tx.entregaVenta.delete({ where: { id: entregaId } });
        return;
      }
      await revertirEntregaConfirmada(tx, entrega);
    });
    revalidatePath("/ventas");
    return { ok: true, data: undefined };
  } catch (err) {
    if (err instanceof AsientoError) return { ok: false, error: err.message };
    return { ok: false, error: "Error al anular la entrega." };
  }
}

// ---------------------------------------------------------------
// Queries de lectura
// ---------------------------------------------------------------

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
  const itemIds = venta.items.map((it) => it.id);
  const aggregados = await db.itemEntrega.groupBy({
    by: ["itemVentaId"],
    where: {
      itemVentaId: { in: itemIds },
      entrega: { estado: { not: EntregaEstado.ANULADA } },
    },
    _sum: { cantidad: true },
  });
  const entregadoPorItem = new Map(aggregados.map((a) => [a.itemVentaId, a._sum.cantidad ?? 0]));
  return venta.items.map((it) => {
    const entregado = entregadoPorItem.get(it.id) ?? 0;
    return {
      itemVentaId: it.id,
      productoCodigo: it.producto.codigo,
      productoNombre: it.producto.nombre,
      vendido: it.cantidad,
      entregado,
      pendiente: it.cantidad - entregado,
    };
  });
}
