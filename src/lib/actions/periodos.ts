"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import {
  AsientoError,
  crearAsientoDestinoResultado,
  ejecutarCierreEjercicio,
} from "@/lib/services/asiento-automatico";
import { AsientoEstado, PeriodoEstado } from "@/generated/prisma/client";

export type PeriodoActionResult =
  | { ok: true; codigo: string; estado: PeriodoEstado }
  | { ok: false; error: string };

export type CrearPeriodoResult =
  | { ok: true; id: number; codigo: string }
  | { ok: false; error: string };

/**
 * Crea un período contable (operación administrativa). Valida código/nombre no
 * vacíos, fechaInicio ≤ fechaFin, código único y NO solapamiento con otros
 * períodos — `resolverPeriodo` (motor de asientos) hace findFirst por
 * contención de fecha, así que rangos superpuestos volverían ambiguo a qué
 * período va un asiento. Nace ABIERTO.
 */
export async function crearPeriodo(input: {
  codigo: string;
  nombre: string;
  fechaInicio: string;
  fechaFin: string;
}): Promise<CrearPeriodoResult> {
  const guard = await requireAdmin();
  if (!guard.ok) {
    return { ok: false, error: guard.error };
  }

  const codigo = input.codigo.trim();
  const nombre = input.nombre.trim();
  if (!codigo) return { ok: false, error: "El código es obligatorio." };
  if (!nombre) return { ok: false, error: "El nombre es obligatorio." };

  const fechaInicio = new Date(input.fechaInicio);
  const fechaFin = new Date(input.fechaFin);
  if (Number.isNaN(fechaInicio.getTime()) || Number.isNaN(fechaFin.getTime())) {
    return { ok: false, error: "Fechas inválidas." };
  }
  if (fechaInicio > fechaFin) {
    return { ok: false, error: "La fecha de inicio debe ser ≤ la de fin." };
  }

  const duplicado = await db.periodoContable.findUnique({
    where: { codigo },
    select: { id: true },
  });
  if (duplicado) {
    return { ok: false, error: `Ya existe un período con código ${codigo}.` };
  }

  // Solapamiento: dos intervalos [a,b] y [c,d] se superponen si a ≤ d && c ≤ b.
  const solapado = await db.periodoContable.findFirst({
    where: { fechaInicio: { lte: fechaFin }, fechaFin: { gte: fechaInicio } },
    select: { codigo: true },
  });
  if (solapado) {
    return {
      ok: false,
      error: `El rango se superpone con el período ${solapado.codigo}.`,
    };
  }

  const periodo = await db.periodoContable.create({
    data: { codigo, nombre, fechaInicio, fechaFin, estado: PeriodoEstado.ABIERTO },
    select: { id: true, codigo: true },
  });

  revalidatePath("/contabilidad/periodos");

  return { ok: true, id: periodo.id, codigo: periodo.codigo };
}

export async function cerrarPeriodo(periodoId: number): Promise<PeriodoActionResult> {
  // Cerrar/reabrir un período contable es una operación administrativa: exige
  // ADMIN (no sólo sesión). requireAdmin revalida el rol contra la DB.
  const guard = await requireAdmin();
  if (!guard.ok) {
    return { ok: false, error: guard.error };
  }

  const periodo = await db.periodoContable.findUnique({
    where: { id: periodoId },
    select: { id: true, codigo: true, estado: true },
  });
  if (!periodo) {
    return { ok: false, error: "Período inexistente." };
  }
  if (periodo.estado !== PeriodoEstado.ABIERTO) {
    return {
      ok: false,
      error: `El período ${periodo.codigo} ya está ${periodo.estado}.`,
    };
  }

  const borradores = await db.asiento.count({
    where: { periodoId, estado: AsientoEstado.BORRADOR },
  });
  if (borradores > 0) {
    return {
      ok: false,
      error: `No se puede cerrar: hay ${borradores} asiento(s) en BORRADOR.`,
    };
  }

  await db.periodoContable.update({
    where: { id: periodoId },
    data: { estado: PeriodoEstado.CERRADO },
  });

  revalidatePath("/contabilidad/periodos");

  return {
    ok: true,
    codigo: periodo.codigo,
    estado: PeriodoEstado.CERRADO,
  };
}

export async function reabrirPeriodo(periodoId: number): Promise<PeriodoActionResult> {
  // Cerrar/reabrir un período contable es una operación administrativa: exige
  // ADMIN (no sólo sesión). requireAdmin revalida el rol contra la DB.
  const guard = await requireAdmin();
  if (!guard.ok) {
    return { ok: false, error: guard.error };
  }

  const periodo = await db.periodoContable.findUnique({
    where: { id: periodoId },
    select: { id: true, codigo: true, estado: true },
  });
  if (!periodo) {
    return { ok: false, error: "Período inexistente." };
  }
  if (periodo.estado !== PeriodoEstado.CERRADO) {
    return {
      ok: false,
      error: `El período ${periodo.codigo} ya está ${periodo.estado}.`,
    };
  }

  await db.periodoContable.update({
    where: { id: periodoId },
    data: { estado: PeriodoEstado.ABIERTO },
  });

  revalidatePath("/contabilidad/periodos");

  return {
    ok: true,
    codigo: periodo.codigo,
    estado: PeriodoEstado.ABIERTO,
  };
}

// ============================================================
// Cierre del ejercicio (FLUJOS CONTABLES: cierre de resultados + destino)
// ============================================================

export type CerrarEjercicioResult =
  | {
      ok: true;
      asientoCierreId: string;
      numeroCierre: number;
      asientoDestinoId: string | null;
      numeroDestino: number | null;
    }
  | { ok: false; error: string };

/**
 * Cierra el ejercicio en el rango [fechaDesde, fechaHasta]: genera el asiento
 * de cierre de resultados (clases 4-9 → 3.4.01) y, si `conDestino`, transfiere
 * el resultado a 3.3.01. Operación administrativa (requireAdmin). Cierre y
 * destino corren en UNA sola transacción serializada por un advisory lock del
 * rango (ver `ejecutarCierreEjercicio`): así dos llamadas concurrentes del mismo
 * rango no duplican asientos (TOCTOU) y el destino no queda sin cierre.
 * Idempotente por rango: un segundo cierre del mismo rango falla.
 */
export async function cerrarEjercicio(input: {
  fechaDesde: string;
  fechaHasta: string;
  conDestino?: boolean;
}): Promise<CerrarEjercicioResult> {
  const guard = await requireAdmin();
  if (!guard.ok) {
    return { ok: false, error: guard.error };
  }

  const fechaDesde = new Date(input.fechaDesde);
  const fechaHasta = new Date(input.fechaHasta);
  if (
    Number.isNaN(fechaDesde.getTime()) ||
    Number.isNaN(fechaHasta.getTime()) ||
    fechaDesde > fechaHasta
  ) {
    return { ok: false, error: "Rango de fechas inválido." };
  }

  try {
    // Cierre + destino atómicos y serializados por advisory lock del rango.
    const { cierre, destino } = await ejecutarCierreEjercicio({
      fechaDesde,
      fechaHasta,
      conDestino: input.conDestino,
    });
    // Efectos colaterales FUERA de la transacción (ya commiteada).
    revalidatePath("/contabilidad");
    revalidatePath("/reportes");
    return {
      ok: true,
      asientoCierreId: cierre.id,
      numeroCierre: cierre.numero,
      asientoDestinoId: destino?.id ?? null,
      numeroDestino: destino?.numero ?? null,
    };
  } catch (e) {
    if (e instanceof AsientoError) {
      return { ok: false, error: e.message };
    }
    throw e;
  }
}

export type DestinarResultadoResult =
  | { ok: true; asientoId: string; numero: number }
  | { ok: false; error: string };

/**
 * Destina (aprueba) el resultado del ejercicio por separado: transfiere el
 * saldo de 3.4.01 → 3.3.01 a la fecha dada. Camino de recuperación cuando el
 * cierre ya se contabilizó pero el destino quedó pendiente (o se aprueba luego
 * de la asamblea). Idempotente: si 3.4.01 está en cero, falla.
 */
export async function destinarResultado(input: {
  fecha: string;
}): Promise<DestinarResultadoResult> {
  const guard = await requireAdmin();
  if (!guard.ok) {
    return { ok: false, error: guard.error };
  }

  const fecha = new Date(input.fecha);
  if (Number.isNaN(fecha.getTime())) {
    return { ok: false, error: "Fecha inválida." };
  }

  try {
    const destino = await crearAsientoDestinoResultado({ fecha });
    revalidatePath("/contabilidad");
    revalidatePath("/reportes");
    return { ok: true, asientoId: destino.id, numero: destino.numero };
  } catch (e) {
    if (e instanceof AsientoError) {
      return { ok: false, error: e.message };
    }
    throw e;
  }
}
