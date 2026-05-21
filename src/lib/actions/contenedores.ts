"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { isContenedorDesconsolidacionEnabled } from "@/lib/features";
import {
  actualizarPackingList,
  avanzarEstadoContenedor,
  ContenedorError,
  crearContenedor,
  eliminarContenedor,
} from "@/lib/services/contenedor";

// ============================================================
// Server actions del packing list de contenedores (PR 2.2)
// ============================================================
//
// Capa fina sobre el service (PR 2.1): gate de feature flag, auth, validación
// zod y mapeo de errores de dominio a mensajes. El bloqueo optimista vive en
// el service; acá sólo se transporta el token `expectedUpdatedAt`.

export type ContenedorActionResult =
  | { ok: true; contenedorId: string }
  | { ok: false; error: string };

const itemSchema = z.object({
  productoId: z.string().min(1),
  cantidadDeclarada: z.number().int().positive(),
  itemEmbarqueId: z.number().int().positive().optional(),
  costoFCUnitario: z.union([z.string(), z.number()]).optional(),
  pesoUnitarioKg: z.union([z.string(), z.number()]).optional(),
  ncm: z.string().optional(),
  paisOrigen: z.string().optional(),
  loteFabricacion: z.string().optional(),
  observaciones: z.string().optional(),
});

const crearSchema = z.object({
  embarqueId: z.string().min(1),
  numeroContenedor: z.string().min(1),
  tipo: z.string().optional(),
  numeroBL: z.string().optional(),
  numeroHBL: z.string().optional(),
  observaciones: z.string().optional(),
  items: z.array(itemSchema).optional(),
});

const actualizarSchema = z.object({
  contenedorId: z.string().min(1),
  expectedUpdatedAt: z.coerce.date(),
  items: z.array(itemSchema).min(1),
});

const avanzarEstadoSchema = z.object({
  contenedorId: z.string().min(1),
  targetEstado: z.enum([
    "EN_TRANSITO",
    "ARRIBADO_PUERTO",
    "EN_ZONA_PRIMARIA",
    "TRASLADO_DEPOSITO_FISCAL",
    "EN_DEPOSITO_FISCAL",
  ]),
  fecha: z.coerce.date().optional(),
  depositoZonaPrimariaId: z.string().optional(),
  depositoFiscalId: z.string().optional(),
});

export type CrearContenedorActionInput = z.input<typeof crearSchema>;
export type ActualizarPackingListActionInput = z.input<typeof actualizarSchema>;
export type AvanzarEstadoActionInput = z.input<typeof avanzarEstadoSchema>;

function mapContenedorError(err: ContenedorError): string {
  switch (err.code) {
    case "EMBARQUE_INEXISTENTE":
      return "El embarque indicado no existe.";
    case "CONTENEDOR_INEXISTENTE":
      return "El contenedor no existe.";
    case "PRODUCTO_FUERA_DE_EMBARQUE":
      return "Hay un producto que no pertenece al embarque.";
    case "CANTIDAD_INVALIDA":
      return "Las cantidades declaradas deben ser enteros mayores a cero.";
    case "PACKING_LIST_VACIO":
      return "El packing list no puede quedar vacío.";
    case "ESTADO_NO_EDITABLE":
      return "El contenedor ya no es editable en su estado actual.";
    case "CONCURRENCIA":
      return "El contenedor fue modificado por otro usuario. Recargá y reintentá.";
    case "ESTADO_TRANSICION_INVALIDA":
      return "No se puede retroceder ni saltar etapas: el estado sólo avanza en el ciclo.";
    case "DEPOSITO_REQUERIDO":
      return "Indicá el depósito fiscal para mover el contenedor a depósito fiscal.";
    default:
      return "No se pudo completar la operación sobre el contenedor.";
  }
}

/** Guard común: flag habilitada + sesión activa. */
async function gate(): Promise<ContenedorActionResult | null> {
  if (!isContenedorDesconsolidacionEnabled()) {
    return { ok: false, error: "El módulo de contenedores no está habilitado." };
  }
  const session = await auth();
  if (!session) {
    return { ok: false, error: "No autorizado." };
  }
  return null;
}

export async function crearContenedorAction(
  raw: CrearContenedorActionInput,
): Promise<ContenedorActionResult> {
  const blocked = await gate();
  if (blocked) return blocked;

  const parsed = crearSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Datos inválidos." };
  }

  try {
    const contenedor = await crearContenedor(parsed.data);
    revalidatePath(`/comex/embarques/${parsed.data.embarqueId}`);
    return { ok: true, contenedorId: contenedor.id };
  } catch (err) {
    if (err instanceof ContenedorError) {
      return { ok: false, error: mapContenedorError(err) };
    }
    console.error("crearContenedorAction failed", err);
    return { ok: false, error: "Error inesperado al crear el contenedor." };
  }
}

export async function actualizarPackingListAction(
  raw: ActualizarPackingListActionInput,
): Promise<ContenedorActionResult> {
  const blocked = await gate();
  if (blocked) return blocked;

  const parsed = actualizarSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Datos inválidos." };
  }

  try {
    const contenedor = await actualizarPackingList(
      parsed.data.contenedorId,
      parsed.data.items,
      parsed.data.expectedUpdatedAt,
    );
    revalidatePath(`/comex/contenedores/${contenedor.id}`);
    return { ok: true, contenedorId: contenedor.id };
  } catch (err) {
    if (err instanceof ContenedorError) {
      return { ok: false, error: mapContenedorError(err) };
    }
    console.error("actualizarPackingListAction failed", err);
    return { ok: false, error: "Error inesperado al actualizar el packing list." };
  }
}

export async function avanzarEstadoContenedorAction(
  raw: AvanzarEstadoActionInput,
): Promise<ContenedorActionResult> {
  const blocked = await gate();
  if (blocked) return blocked;

  const parsed = avanzarEstadoSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Datos inválidos." };
  }

  try {
    const contenedor = await avanzarEstadoContenedor(parsed.data);
    revalidatePath(`/comex/embarques/${contenedor.embarqueId}`);
    return { ok: true, contenedorId: contenedor.id };
  } catch (err) {
    if (err instanceof ContenedorError) {
      return { ok: false, error: mapContenedorError(err) };
    }
    console.error("avanzarEstadoContenedorAction failed", err);
    return { ok: false, error: "Error inesperado al avanzar el estado del contenedor." };
  }
}

export async function eliminarContenedorAction(
  contenedorId: string,
): Promise<ContenedorActionResult> {
  const blocked = await gate();
  if (blocked) return blocked;

  if (!contenedorId) {
    return { ok: false, error: "Datos inválidos." };
  }

  try {
    await eliminarContenedor(contenedorId);
    revalidatePath("/comex/contenedores");
    return { ok: true, contenedorId };
  } catch (err) {
    if (err instanceof ContenedorError) {
      return { ok: false, error: mapContenedorError(err) };
    }
    console.error("eliminarContenedorAction failed", err);
    return { ok: false, error: "Error inesperado al eliminar el contenedor." };
  }
}
