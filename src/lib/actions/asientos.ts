"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  AsientoError,
  anularAsiento,
  contabilizarAsiento,
  crearAsientoManual,
} from "@/lib/services/asiento-automatico";
import { AsientoOrigen, Moneda } from "@/generated/prisma/client";

const inputSchema = z.object({
  fecha: z.coerce.date(),
  descripcion: z.string().min(1),
  moneda: z.nativeEnum(Moneda),
  tipoCambio: z.string().min(1),
  lineas: z
    .array(
      z.object({
        cuentaId: z.number().int().positive(),
        debe: z.string(),
        haber: z.string(),
        referencia: z.string().optional(),
      }),
    )
    .min(2),
});

export type CrearAsientoManualInput = z.input<typeof inputSchema>;

export type CrearAsientoActionResult =
  | { ok: true; asientoId: string; numero: number }
  | { ok: false; error: string };

export type AsientoStateActionResult =
  | { ok: true; numero: number }
  | { ok: false; error: string };

export async function crearAsientoManualAction(
  raw: CrearAsientoManualInput,
): Promise<CrearAsientoActionResult> {
  const session = await auth();
  if (!session) {
    return { ok: false, error: "No autorizado." };
  }

  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Datos inválidos." };
  }

  try {
    const asiento = await crearAsientoManual({
      fecha: parsed.data.fecha,
      descripcion: parsed.data.descripcion,
      origen: AsientoOrigen.MANUAL,
      moneda: parsed.data.moneda,
      tipoCambio: parsed.data.tipoCambio,
      lineas: parsed.data.lineas.map((l) => ({
        cuentaId: l.cuentaId,
        debe: l.debe,
        haber: l.haber,
        descripcion: l.referencia,
      })),
    });

    revalidatePath("/contabilidad/asientos");

    return {
      ok: true,
      asientoId: asiento.id,
      numero: asiento.numero,
    };
  } catch (err) {
    if (err instanceof AsientoError) {
      return { ok: false, error: mapAsientoErrorMessage(err) };
    }
    console.error("crearAsientoManualAction failed", err);
    return { ok: false, error: "Error inesperado al crear el asiento." };
  }
}

export async function contabilizarAsientoAction(
  asientoId: string,
): Promise<AsientoStateActionResult> {
  const session = await auth();
  if (!session) {
    return { ok: false, error: "No autorizado." };
  }

  try {
    const asiento = await contabilizarAsiento(asientoId);
    revalidatePath("/contabilidad/asientos");
    revalidatePath("/tesoreria/movimientos");
    return { ok: true, numero: asiento.numero };
  } catch (err) {
    if (err instanceof AsientoError) {
      return { ok: false, error: mapAsientoErrorMessage(err) };
    }
    console.error("contabilizarAsientoAction failed", err);
    return { ok: false, error: "Error inesperado al contabilizar el asiento." };
  }
}

export async function anularAsientoAction(
  asientoId: string,
): Promise<AsientoStateActionResult> {
  const session = await auth();
  if (!session) {
    return { ok: false, error: "No autorizado." };
  }

  try {
    const asiento = await anularAsiento(asientoId);
    revalidatePath("/contabilidad/asientos");
    revalidatePath("/tesoreria/movimientos");
    return { ok: true, numero: asiento.numero };
  } catch (err) {
    if (err instanceof AsientoError) {
      return { ok: false, error: mapAsientoErrorMessage(err) };
    }
    console.error("anularAsientoAction failed", err);
    return { ok: false, error: "Error inesperado al anular el asiento." };
  }
}

export type AsientoLineaDetalle = {
  id: number;
  cuentaCodigo: string;
  cuentaNombre: string;
  debe: string;
  haber: string;
  descripcion: string | null;
};

export type AsientoDetalle = {
  id: string;
  numero: number;
  fecha: Date;
  descripcion: string;
  estado: "BORRADOR" | "CONTABILIZADO" | "ANULADO";
  origen: "MANUAL" | "TESORERIA" | "COMEX" | "AJUSTE";
  moneda: "ARS" | "USD";
  tipoCambio: string;
  totalDebe: string;
  totalHaber: string;
  periodoCodigo: string;
  lineas: AsientoLineaDetalle[];
};

export type GetAsientoDetalleResult =
  | { ok: true; detalle: AsientoDetalle }
  | { ok: false; error: string };

export async function getAsientoDetalle(
  asientoId: string,
): Promise<GetAsientoDetalleResult> {
  const session = await auth();
  if (!session) {
    return { ok: false, error: "No autorizado." };
  }

  const asiento = await db.asiento.findUnique({
    where: { id: asientoId },
    select: {
      id: true,
      numero: true,
      fecha: true,
      descripcion: true,
      estado: true,
      origen: true,
      moneda: true,
      tipoCambio: true,
      totalDebe: true,
      totalHaber: true,
      periodo: { select: { codigo: true } },
      lineas: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          debe: true,
          haber: true,
          descripcion: true,
          cuenta: { select: { codigo: true, nombre: true } },
        },
      },
    },
  });

  if (!asiento) {
    return { ok: false, error: "Asiento inexistente." };
  }

  return {
    ok: true,
    detalle: {
      id: asiento.id,
      numero: asiento.numero,
      fecha: asiento.fecha,
      descripcion: asiento.descripcion,
      estado: asiento.estado,
      origen: asiento.origen,
      moneda: asiento.moneda,
      tipoCambio: asiento.tipoCambio.toString(),
      totalDebe: asiento.totalDebe.toFixed(2),
      totalHaber: asiento.totalHaber.toFixed(2),
      periodoCodigo: asiento.periodo.codigo,
      lineas: asiento.lineas.map((l) => ({
        id: l.id,
        cuentaCodigo: l.cuenta.codigo,
        cuentaNombre: l.cuenta.nombre,
        debe: l.debe.toFixed(2),
        haber: l.haber.toFixed(2),
        descripcion: l.descripcion,
      })),
    },
  };
}

function mapAsientoErrorMessage(err: AsientoError): string {
  switch (err.code) {
    case "DESBALANCEADO":
      return "El asiento está desbalanceado: la suma del Debe no coincide con el Haber.";
    case "LINEA_INVALIDA":
      return err.message;
    case "CUENTA_INVALIDA":
      return "Una de las cuentas seleccionadas no existe.";
    case "CUENTA_INACTIVA":
      return "Una de las cuentas seleccionadas está inactiva.";
    case "CUENTA_SINTETICA":
      return "No se pueden usar cuentas sintéticas. Seleccione una cuenta analítica.";
    case "PERIODO_INEXISTENTE":
      return "No hay período contable que contenga esa fecha.";
    case "PERIODO_CERRADO":
      return "El período contable está cerrado.";
    case "ASIENTO_INEXISTENTE":
      return "El asiento no existe.";
    case "ESTADO_INVALIDO":
      return err.message;
    case "NUMERACION_FALHOU":
      return "No se pudo asignar número secuencial. Reintente.";
    default:
      return err.message;
  }
}
