"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  AsientoError,
  contabilizarAsiento,
  crearAsientoManual,
  crearAsientoMovimientoTesoreria,
} from "@/lib/services/asiento-automatico";
import { getOrCreateCuenta } from "@/lib/services/cuenta-auto";
import {
  EXTRACTO_BANCARIO_CODIGOS,
  PORCENTAJE_LEY_25413_COMPUTABLE,
} from "@/lib/services/cuenta-registry";
import {
  AsientoOrigen,
  ImportacionExtractoStatus,
  LineaExtractoStatus,
  Moneda,
  MovimientoTesoreriaTipo,
} from "@/generated/prisma/client";

const CODIGO_IMPUESTO_LEY_25413 = "5.8.1.06";

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
          cuentaSugerida: { select: { id: true, codigo: true } },
        },
      });

      if (!linea) throw new Error("Línea no encontrada.");
      if (linea.status !== LineaExtractoStatus.PENDIENTE) {
        throw new Error(`La línea ya está en estado ${linea.status}.`);
      }

      let contrapartidaId: number | null = null;
      let contrapartidaCodigo: string | null = null;
      if (linea.cuentaSugerida) {
        contrapartidaId = linea.cuentaSugerida.id;
        contrapartidaCodigo = linea.cuentaSugerida.codigo;
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

      // Caso especial — Impuesto Ley 25413 (Imp. al cheque): 33% va como
      // crédito fiscal pago a cuenta de Ganancias (1.1.4.12), 67% como
      // gasto (5.8.1.06). Reemplaza el asiento auto de 2 lineas por uno
      // de 3 lineas con la división.
      const esImpuestoLey25413 =
        contrapartidaCodigo === CODIGO_IMPUESTO_LEY_25413;

      if (esImpuestoLey25413 && tipo === MovimientoTesoreriaTipo.PAGO) {
        const creditoCuentaId = await getOrCreateCuenta(
          tx,
          EXTRACTO_BANCARIO_CODIGOS.CREDITO_LEY_25413_GANANCIAS,
        );

        // Round 33% to 2 decimals; resto va al gasto para evitar drift de centavos
        const creditoMonto = Math.round(montoAbs * PORCENTAJE_LEY_25413_COMPUTABLE * 100) / 100;
        const gastoMonto = Math.round((montoAbs - creditoMonto) * 100) / 100;

        const asiento = await crearAsientoManual(
          {
            fecha: linea.fecha,
            descripcion,
            origen: AsientoOrigen.TESORERIA,
            moneda,
            tipoCambio,
            lineas: [
              { cuentaId: contrapartidaId, debe: gastoMonto.toFixed(2), haber: "0", descripcion: "Gasto no computable (67%)" },
              { cuentaId: creditoCuentaId, debe: creditoMonto.toFixed(2), haber: "0", descripcion: "Pago a cuenta Ganancias (33%)" },
              { cuentaId: bancoCuentaId, debe: "0", haber: montoAbsStr },
            ],
          },
          tx,
        );

        await tx.movimientoTesoreria.update({
          where: { id: mov.id },
          data: { asientoId: asiento.id },
        });
        await contabilizarAsiento(asiento.id, tx);
      } else {
        const asiento = await crearAsientoMovimientoTesoreria(mov.id, tx);
        await contabilizarAsiento(asiento.id, tx);
      }

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

export async function revertirLineaAction(lineaId: string) {
  // Solo permitido para IGNORADA / RECHAZADA — APROBADA tiene movimiento
  // y debe anularse desde Tesorería.
  return cambiarEstadoLinea(lineaId, LineaExtractoStatus.PENDIENTE);
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
