import "server-only";

// Gate de margen baja (PR-014 / COM-05). Precondición de SÓLO-LECTURA para la
// emisión de una venta: si APPROVALS_ENABLED está ON y el margen neto cae bajo el
// piso, exige una `Solicitud` APROBADA del tipo de faixa (o uno más severo) ANTES
// de emitir. NO recalcula con criterio propio (espelha `venta-form` vía el módulo
// puro de faixas), NO muta nada, NO toca el motor PR-012 (sólo lee `Solicitud`).
//
// INERTE: con la flag off retorna {ok:true} en la 1ª línea, sin tocar la DB →
// cero cambio de comportamiento. Se invoca al TOPE de `emitirVentaAction`, ANTES
// de la transacción del efecto (asiento/stock byte-idéntico en el camino permitido).

import { EstadoSolicitud, type TipoAprobacion } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { isApprovalsEnabled } from "@/lib/features";

import {
  calcularMargenNetoVenta,
  type FaixaMargen,
  resolverFaixaMargen,
  sumarCostoItems,
  tiposMargenAlMenos,
} from "./margen-aprobacion-faixas";

/** Clave polimórfica de la `Solicitud` para una venta (debe coincidir con la UI). */
export const TABLA_VENTA = "Venta" as const;

const MSG_PENDIENTE =
  "Margen bajo el piso: solicitá autorización de margen y esperá la aprobación antes de emitir.";

type VentaParaMargen = {
  subtotal: string;
  flete: string;
  percepcionIIBB: string;
  items: { cantidad: number; costoPromedio: string }[];
};

/** Carga los campos almacenados necesarios para reconstruir el margen (read-only). */
async function cargarVentaParaMargen(ventaId: string): Promise<VentaParaMargen | null> {
  const v = await db.venta.findUnique({
    where: { id: ventaId },
    select: {
      subtotal: true,
      flete: true,
      percepcionIIBB: true,
      items: {
        select: { cantidad: true, producto: { select: { costoPromedio: true } } },
      },
    },
  });
  if (!v) return null;
  return {
    subtotal: v.subtotal.toString(),
    flete: v.flete.toString(),
    percepcionIIBB: v.percepcionIIBB.toString(),
    items: v.items.map((it) => ({
      cantidad: it.cantidad,
      costoPromedio: it.producto.costoPromedio.toString(),
    })),
  };
}

/** ¿Existe una `Solicitud` APROBADA de alguno de los tipos que satisfacen el requerimiento? */
async function existeAprobacionMargen(ventaId: string, tipos: TipoAprobacion[]): Promise<boolean> {
  const aprobada = await db.solicitud.findFirst({
    where: {
      tabla: TABLA_VENTA,
      registroId: ventaId,
      tipo: { in: tipos },
      estado: EstadoSolicitud.APROBADA,
    },
    select: { id: true },
  });
  return aprobada !== null;
}

/**
 * Faixa de aprobación de una venta (read-only), o null si está sobre el piso o no
 * existe. NO gateada por la flag (la usa la UI del BORRADOR, ya gateada aparte) ni
 * muta nada. Espelha el margen del `venta-form` vía el módulo puro.
 */
export async function resolverFaixaMargenVenta(ventaId: string): Promise<FaixaMargen | null> {
  const venta = await cargarVentaParaMargen(ventaId);
  if (!venta) return null;
  const margenNetoPct = calcularMargenNetoVenta({
    subtotal: venta.subtotal,
    costoTotal: sumarCostoItems(venta.items),
    flete: venta.flete,
    percepcionIIBB: venta.percepcionIIBB,
  });
  return resolverFaixaMargen(margenNetoPct);
}

/**
 * Precondición de emisión: bloquea si la venta tiene margen bajo el piso y no hay
 * una autorización APROBADA. INERTE con la flag off. NO aplica ningún efecto.
 */
export async function verificarAprobacionMargenVenta(
  ventaId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isApprovalsEnabled()) return { ok: true };

  const faixa = await resolverFaixaMargenVenta(ventaId);
  if (!faixa) return { ok: true }; // sobre el piso (o venta inexistente) → sin aprobación.

  const aprobada = await existeAprobacionMargen(ventaId, tiposMargenAlMenos(faixa.tipo));
  return aprobada ? { ok: true } : { ok: false, error: MSG_PENDIENTE };
}
