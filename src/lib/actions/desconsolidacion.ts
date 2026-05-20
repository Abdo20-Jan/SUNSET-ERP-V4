"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { isContenedorDesconsolidacionEnabled } from "@/lib/features";
import { desconsolidar, DesconsolidacionError } from "@/lib/services/desconsolidacion";

// ============================================================
// Server action de desconsolidación (PR 3.4)
// ============================================================
//
// Capa fina sobre el service de PR 3.2: gate de feature flag + auth, validación
// zod y mapeo de errores de dominio a mensajes. El lock pesimista, el gate D9 y
// la idempotencia (guard de estado) viven en el service.

export type DesconsolidacionDiffDTO = {
  itemContenedorId: number;
  productoId: string;
  cantidadDeclarada: number;
  cantidadFisica: number;
  diferencia: number;
};

export type DesconsolidacionActionResult =
  | {
      ok: true;
      contenedorId: string;
      desconsolidacionId: string;
      /** true → el contenedor pasó a AGUARDANDO_INVESTIGACAO (asiento bloqueado). */
      divergencia: boolean;
      asientoId: string | null;
      diffs: DesconsolidacionDiffDTO[];
    }
  | { ok: false; error: string };

const desconsolidarSchema = z.object({
  contenedorId: z.string().min(1),
  fecha: z.coerce.date(),
  conferencia: z
    .array(
      z.object({
        itemContenedorId: z.number().int().positive(),
        cantidadFisica: z.number().int().min(0),
      }),
    )
    .optional(),
});

export type DesconsolidarActionInput = z.input<typeof desconsolidarSchema>;

function mapDesconsolidacionError(err: DesconsolidacionError): string {
  switch (err.code) {
    case "CONTENEDOR_INEXISTENTE":
      return "El contenedor no existe.";
    case "ESTADO_INVALIDO":
      return "El contenedor no está en depósito fiscal: sólo se desconsolida desde EN_DEPOSITO_FISCAL.";
    case "YA_DESCONSOLIDADO":
      return "El contenedor ya fue desconsolidado.";
    case "FC_NO_CERRADO":
      return "Hay items sin costo FC unitario. Cerrá los costos antes de desconsolidar.";
    case "DEPOSITO_FISCAL_FALTANTE":
      return "El contenedor no tiene depósito fiscal asignado.";
    case "CONFERENCIA_INVALIDA":
      return "El conteo físico es inválido (cantidades enteras ≥ 0 para items de este contenedor).";
    case "PACKING_LIST_VACIO":
      return "El contenedor no tiene packing list.";
    case "TIPO_CAMBIO_INVALIDO":
      return "El embarque no tiene un tipo de cambio válido.";
    default:
      return "No se pudo desconsolidar el contenedor.";
  }
}

/** Guard común: flag habilitada + sesión activa. */
async function gate(): Promise<DesconsolidacionActionResult | null> {
  if (!isContenedorDesconsolidacionEnabled()) {
    return { ok: false, error: "El módulo de contenedores no está habilitado." };
  }
  const session = await auth();
  if (!session) {
    return { ok: false, error: "No autorizado." };
  }
  return null;
}

export async function desconsolidarAction(
  raw: DesconsolidarActionInput,
): Promise<DesconsolidacionActionResult> {
  const blocked = await gate();
  if (blocked) return blocked;

  const parsed = desconsolidarSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Datos inválidos." };
  }

  try {
    // usuarioId se omite: Desconsolidacion.usuarioId es Int? y User.id es uuid
    // (mismatch). Alinear el schema a String queda como follow-up.
    const result = await desconsolidar({
      contenedorId: parsed.data.contenedorId,
      conferencia: parsed.data.conferencia,
      fecha: parsed.data.fecha,
    });

    revalidatePath(`/comex/contenedores/${parsed.data.contenedorId}/desconsolidacion`);
    revalidatePath(`/comex/embarques/${result.contenedor.embarqueId}`);

    return {
      ok: true,
      contenedorId: result.contenedor.id,
      desconsolidacionId: result.desconsolidacion.id,
      divergencia: result.divergencia,
      asientoId: result.asiento?.id ?? null,
      diffs: result.diffs,
    };
  } catch (err) {
    if (err instanceof DesconsolidacionError) {
      return { ok: false, error: mapDesconsolidacionError(err) };
    }
    console.error("desconsolidarAction failed", err);
    return { ok: false, error: "Error inesperado al desconsolidar el contenedor." };
  }
}
