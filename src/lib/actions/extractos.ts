"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  AsientoError,
  contabilizarAsiento,
  crearAsientoMovimientoTesoreria,
} from "@/lib/services/asiento-automatico";
import {
  ImportacionExtractoStatus,
  LineaExtractoStatus,
  Moneda,
  MovimientoTesoreriaTipo,
} from "@/generated/prisma/client";

const editarLineaSchema = z.object({
  lineaId: z.string().uuid(),
  cuentaSugeridaId: z.number().int().positive().nullable(),
  proveedorSugeridoId: z.string().uuid().nullable(),
  clienteSugeridoId: z.string().uuid().nullable(),
  descripcionAsiento: z.string().trim().max(500).nullable(),
  notas: z.string().trim().max(500).nullable(),
});

export type EditarLineaInput = z.input<typeof editarLineaSchema>;

export async function editarLineaAction(
  raw: EditarLineaInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session) return { ok: false, error: "No autorizado." };

  const parsed = editarLineaSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const { lineaId, ...data } = parsed.data;

  const linea = await db.lineaExtractoSugerencia.findUnique({
    where: { id: lineaId },
    select: { status: true, importacionId: true },
  });
  if (!linea) return { ok: false, error: "Línea no encontrada." };
  if (linea.status === LineaExtractoStatus.APROBADA) {
    return { ok: false, error: "La línea ya fue aprobada — anule el movimiento para editar." };
  }

  await db.lineaExtractoSugerencia.update({
    where: { id: lineaId },
    data,
  });

  revalidatePath(`/tesoreria/extractos/${linea.importacionId}`);
  return { ok: true };
}

export async function aprobarLineaAction(
  lineaId: string,
): Promise<{ ok: true; movimientoId: string } | { ok: false; error: string }> {
  const session = await auth();
  if (!session) return { ok: false, error: "No autorizado." };

  if (!z.string().uuid().safeParse(lineaId).success) {
    return { ok: false, error: "ID inválido." };
  }

  try {
    const result = await db.$transaction(async (tx) => {
      const linea = await tx.lineaExtractoSugerencia.findUnique({
        where: { id: lineaId },
        include: {
          importacion: {
            select: {
              id: true,
              cuentaBancariaId: true,
              cuentaBancaria: { select: { moneda: true, cuentaContableId: true } },
            },
          },
          proveedor: { select: { id: true, cuentaContableId: true } },
          cliente: { select: { id: true, cuentaContableId: true } },
          cuentaSugerida: { select: { id: true } },
        },
      });

      if (!linea) throw new Error("Línea no encontrada.");
      if (linea.status !== LineaExtractoStatus.PENDIENTE) {
        throw new Error(`La línea ya está en estado ${linea.status}.`);
      }

      let contrapartidaId: number | null = null;
      if (linea.cuentaSugerida) {
        contrapartidaId = linea.cuentaSugerida.id;
      } else if (linea.proveedor?.cuentaContableId) {
        contrapartidaId = linea.proveedor.cuentaContableId;
      } else if (linea.cliente?.cuentaContableId) {
        contrapartidaId = linea.cliente.cuentaContableId;
      }

      if (!contrapartidaId) {
        throw new Error(
          "Falta contrapartida: asigná una cuenta o un proveedor/cliente con cuenta contable.",
        );
      }

      if (contrapartidaId === linea.importacion.cuentaBancaria.cuentaContableId) {
        throw new Error("La contrapartida no puede ser la cuenta contable del banco.");
      }

      const montoNum = Number(linea.monto);
      if (!Number.isFinite(montoNum) || montoNum === 0) {
        throw new Error("Línea con monto inválido o cero — usá Ignorar en vez de Aprobar.");
      }
      const montoAbsStr = Math.abs(montoNum).toFixed(2);

      const tipo = montoNum > 0
        ? MovimientoTesoreriaTipo.COBRO
        : MovimientoTesoreriaTipo.PAGO;

      const moneda = linea.importacion.cuentaBancaria.moneda;
      const tipoCambio = moneda === Moneda.ARS ? "1" : "1";
      const descripcion = (linea.descripcionAsiento ?? linea.descripcion).slice(0, 255);

      const mov = await tx.movimientoTesoreria.create({
        data: {
          tipo,
          cuentaBancariaId: linea.importacion.cuentaBancariaId,
          fecha: linea.fecha,
          monto: montoAbsStr,
          moneda,
          tipoCambio,
          cuentaContableId: contrapartidaId,
          descripcion,
          comprobante: linea.comprobante,
        },
        select: { id: true },
      });

      const asiento = await crearAsientoMovimientoTesoreria(mov.id, tx);
      await contabilizarAsiento(asiento.id, tx);

      await tx.lineaExtractoSugerencia.update({
        where: { id: lineaId },
        data: {
          status: LineaExtractoStatus.APROBADA,
          movimientoId: mov.id,
        },
      });

      const counts = await tx.lineaExtractoSugerencia.groupBy({
        by: ["status"],
        where: { importacionId: linea.importacionId },
        _count: { _all: true },
      });
      const aprobadas = counts.find((c) => c.status === LineaExtractoStatus.APROBADA)?._count._all ?? 0;
      const pendientes = counts.find((c) => c.status === LineaExtractoStatus.PENDIENTE)?._count._all ?? 0;

      await tx.importacionExtracto.update({
        where: { id: linea.importacionId },
        data: {
          lineasAprobadas: aprobadas,
          status:
            pendientes === 0
              ? ImportacionExtractoStatus.COMPLETADO
              : ImportacionExtractoStatus.PARCIAL,
        },
      });

      return { movimientoId: mov.id, importacionId: linea.importacionId };
    });

    revalidatePath(`/tesoreria/extractos/${result.importacionId}`);
    revalidatePath("/tesoreria/extractos");
    revalidatePath("/tesoreria/movimientos");

    return { ok: true, movimientoId: result.movimientoId };
  } catch (err) {
    if (err instanceof AsientoError) {
      return { ok: false, error: err.message };
    }
    const msg = err instanceof Error ? err.message : "Error desconocido";
    console.error("[extractos] aprobarLineaAction failed", err);
    return { ok: false, error: msg };
  }
}

async function cambiarEstadoLinea(
  lineaId: string,
  nuevoEstado: LineaExtractoStatus,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session) return { ok: false, error: "No autorizado." };
  if (!z.string().uuid().safeParse(lineaId).success) {
    return { ok: false, error: "ID inválido." };
  }

  const linea = await db.lineaExtractoSugerencia.findUnique({
    where: { id: lineaId },
    select: { status: true, importacionId: true },
  });
  if (!linea) return { ok: false, error: "Línea no encontrada." };
  if (linea.status === LineaExtractoStatus.APROBADA) {
    return { ok: false, error: "La línea ya generó un movimiento — anulalo desde Tesorería." };
  }

  await db.$transaction(async (tx) => {
    await tx.lineaExtractoSugerencia.update({
      where: { id: lineaId },
      data: { status: nuevoEstado },
    });

    const counts = await tx.lineaExtractoSugerencia.groupBy({
      by: ["status"],
      where: { importacionId: linea.importacionId },
      _count: { _all: true },
    });
    const pendientes = counts.find((c) => c.status === LineaExtractoStatus.PENDIENTE)?._count._all ?? 0;
    const aprobadas = counts.find((c) => c.status === LineaExtractoStatus.APROBADA)?._count._all ?? 0;

    await tx.importacionExtracto.update({
      where: { id: linea.importacionId },
      data: {
        lineasAprobadas: aprobadas,
        status:
          pendientes === 0
            ? ImportacionExtractoStatus.COMPLETADO
            : aprobadas > 0
              ? ImportacionExtractoStatus.PARCIAL
              : ImportacionExtractoStatus.PENDIENTE,
      },
    });
  });

  revalidatePath(`/tesoreria/extractos/${linea.importacionId}`);
  return { ok: true };
}

export async function rechazarLineaAction(lineaId: string) {
  return cambiarEstadoLinea(lineaId, LineaExtractoStatus.RECHAZADA);
}

export async function ignorarLineaAction(lineaId: string) {
  return cambiarEstadoLinea(lineaId, LineaExtractoStatus.IGNORADA);
}

export async function eliminarImportacionAction(
  importacionId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session) return { ok: false, error: "No autorizado." };
  if (!z.string().uuid().safeParse(importacionId).success) {
    return { ok: false, error: "ID inválido." };
  }

  const aprobadas = await db.lineaExtractoSugerencia.count({
    where: { importacionId, status: LineaExtractoStatus.APROBADA },
  });
  if (aprobadas > 0) {
    return {
      ok: false,
      error: `No se puede eliminar: hay ${aprobadas} líneas aprobadas con movimientos. Anulá los asientos primero.`,
    };
  }

  await db.importacionExtracto.delete({ where: { id: importacionId } });
  revalidatePath("/tesoreria/extractos");
  return { ok: true };
}
