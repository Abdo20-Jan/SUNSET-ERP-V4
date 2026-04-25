"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { AsientoEstado, PeriodoEstado } from "@/generated/prisma/client";

export type PeriodoActionResult =
  | { ok: true; codigo: string; estado: PeriodoEstado }
  | { ok: false; error: string };

export async function cerrarPeriodo(
  periodoId: number,
): Promise<PeriodoActionResult> {
  const session = await auth();
  if (!session) {
    return { ok: false, error: "No autorizado." };
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

export async function reabrirPeriodo(
  periodoId: number,
): Promise<PeriodoActionResult> {
  const session = await auth();
  if (!session) {
    return { ok: false, error: "No autorizado." };
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
