"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  anularAsiento,
  AsientoError,
  contabilizarAsiento,
  crearAsientoMovimientoTesoreria,
} from "@/lib/services/asiento-automatico";
import { getCotizacionParaFecha } from "@/lib/services/cotizacion";
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

const aprobarOptsSchema = z.object({
  // TC manual al aprobar una línea de cuenta en moneda extranjera.
  // Si no viene, se usa la cotización vigente a la fecha de la línea.
  tipoCambio: z.number().finite().positive("El tipo de cambio debe ser mayor a 0.").optional(),
});

export type AprobarLineaOpts = z.input<typeof aprobarOptsSchema>;

export async function aprobarLineaAction(
  lineaId: string,
  opts?: AprobarLineaOpts,
): Promise<{ ok: true; movimientoId: string } | { ok: false; error: string }> {
  const session = await auth();
  if (!session) return { ok: false, error: "No autorizado." };

  if (!z.string().uuid().safeParse(lineaId).success) {
    return { ok: false, error: "ID inválido." };
  }
  const parsedOpts = aprobarOptsSchema.safeParse(opts ?? {});
  if (!parsedOpts.success) {
    return { ok: false, error: parsedOpts.error.issues[0]?.message ?? "Datos inválidos." };
  }
  const tcManual = parsedOpts.data.tipoCambio;

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
          cuentaSugerida: { select: { id: true, codigo: true } },
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

      const bancoCuentaId = linea.importacion.cuentaBancaria.cuentaContableId;
      if (contrapartidaId === bancoCuentaId) {
        throw new Error("La contrapartida no puede ser la cuenta contable del banco.");
      }

      const montoNum = Number(linea.monto);
      if (!Number.isFinite(montoNum) || montoNum === 0) {
        throw new Error("Línea con monto inválido o cero — usá Ignorar en vez de Aprobar.");
      }
      const montoAbs = Math.abs(montoNum);
      const montoAbsStr = montoAbs.toFixed(2);

      const tipo = montoNum > 0 ? MovimientoTesoreriaTipo.COBRO : MovimientoTesoreriaTipo.PAGO;

      const moneda = linea.importacion.cuentaBancaria.moneda;

      // Regla canónica: una cuenta en moneda extranjera nunca registra TC=1.
      // Prioridad: TC manual del aprobador → cotización vigente a la fecha
      // de la línea → error (la línea queda PENDIENTE).
      let tipoCambio = "1";
      if (moneda !== Moneda.ARS) {
        if (tcManual !== undefined) {
          tipoCambio = tcManual.toFixed(6);
        } else {
          const cotizacion = await getCotizacionParaFecha(linea.fecha, tx);
          if (!cotizacion) {
            throw new Error(
              `La cuenta es en ${moneda} y no hay cotización cargada para el ${linea.fecha.toISOString().slice(0, 10)}. Ingresá el tipo de cambio al aprobar o cargá la cotización del día.`,
            );
          }
          tipoCambio = cotizacion.valor.toFixed(6);
        }
      }

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
          referenciaBanco: linea.referenciaBanco,
        },
        select: { id: true },
      });

      // El motor resuelve el asiento (incluido el caso especial Ley 25413 —
      // split 33/67 cuando la contrapartida es 5.8.1.06 — y la conversión a
      // ARS cuando la cuenta es en moneda extranjera).
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
      const aprobadas =
        counts.find((c) => c.status === LineaExtractoStatus.APROBADA)?._count._all ?? 0;
      const pendientes =
        counts.find((c) => c.status === LineaExtractoStatus.PENDIENTE)?._count._all ?? 0;

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
    const pendientes =
      counts.find((c) => c.status === LineaExtractoStatus.PENDIENTE)?._count._all ?? 0;
    const aprobadas =
      counts.find((c) => c.status === LineaExtractoStatus.APROBADA)?._count._all ?? 0;

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

export async function revertirLineaAction(lineaId: string) {
  // Solo permitido para IGNORADA / RECHAZADA — APROBADA tiene movimiento
  // y debe anularse desde Tesorería o vía desaprobarLineaAction.
  return cambiarEstadoLinea(lineaId, LineaExtractoStatus.PENDIENTE);
}

/**
 * Anula el asiento y movimiento generados por una línea aprobada y
 * la deja PENDIENTE para re-aprobar (con cuenta corregida, etc).
 * Falla si el período ya cerró o si el asiento ya fue anulado por otra vía.
 */
export async function desaprobarLineaAction(
  lineaId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session) return { ok: false, error: "No autorizado." };
  if (!z.string().uuid().safeParse(lineaId).success) {
    return { ok: false, error: "ID inválido." };
  }

  try {
    await db.$transaction(async (tx) => {
      const linea = await tx.lineaExtractoSugerencia.findUnique({
        where: { id: lineaId },
        select: {
          status: true,
          importacionId: true,
          movimientoId: true,
          movimiento: { select: { id: true, asientoId: true } },
        },
      });

      if (!linea) throw new Error("Línea no encontrada.");
      if (linea.status !== LineaExtractoStatus.APROBADA) {
        throw new Error(
          `La línea está en estado ${linea.status}. Solo APROBADA se puede desaprobar.`,
        );
      }

      // Anular asiento si todavía está contabilizado.
      const asientoId = linea.movimiento?.asientoId;
      if (asientoId) {
        await anularAsiento(asientoId, tx);
        // anularAsiento ya detachea movimiento.asientoId
      }

      // Eliminar movimiento huérfano (sin asientoId)
      if (linea.movimientoId) {
        await tx.movimientoTesoreria.delete({
          where: { id: linea.movimientoId },
        });
      }

      await tx.lineaExtractoSugerencia.update({
        where: { id: lineaId },
        data: {
          status: LineaExtractoStatus.PENDIENTE,
          movimientoId: null,
        },
      });

      // Recalcular contadores
      const counts = await tx.lineaExtractoSugerencia.groupBy({
        by: ["status"],
        where: { importacionId: linea.importacionId },
        _count: { _all: true },
      });
      const aprobadas =
        counts.find((c) => c.status === LineaExtractoStatus.APROBADA)?._count._all ?? 0;
      const pendientes =
        counts.find((c) => c.status === LineaExtractoStatus.PENDIENTE)?._count._all ?? 0;

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

    revalidatePath("/tesoreria/extractos");
    revalidatePath("/tesoreria/movimientos");

    return { ok: true };
  } catch (err) {
    if (err instanceof AsientoError) {
      return { ok: false, error: err.message };
    }
    const msg = err instanceof Error ? err.message : "Error desconocido";
    console.error("[extractos] desaprobarLineaAction failed", err);
    return { ok: false, error: msg };
  }
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
