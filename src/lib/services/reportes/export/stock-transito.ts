import "server-only";

import { EmbarqueEstado } from "@/generated/prisma/client";
import { db } from "@/lib/db";

import type { EmbarqueStockInput } from "./balance-bp-detalle";

// "En viaje" = mercadería aún no nacionalizada (≈ cuenta 1.1.7.05
// IMPORTACIONES EMBARCADAS / EN TRÁNSITO). Mesma definición que el bucket
// `enTransito` del overview de Comex (comex-overview.ts), validado por el dono.
const EN_VIAJE: readonly EmbarqueEstado[] = [EmbarqueEstado.EN_TRANSITO, EmbarqueEstado.EN_PUERTO];

/**
 * Embarques en viaje con su valor FOB (moneda nativa) para detallar STOCK >
 * EM TRÂNSITO en el export del Balanço. Subledger informativo — el subtotal
 * contable del bloque STOCK sigue saliendo del razón.
 */
export async function getStockEnTransitoPorEmbarque(): Promise<EmbarqueStockInput[]> {
  const embarques = await db.embarque.findMany({
    where: { estado: { in: [...EN_VIAJE] } },
    select: {
      codigo: true,
      moneda: true,
      fobTotal: true,
      proveedor: { select: { nombre: true } },
    },
    orderBy: { codigo: "desc" },
  });

  return embarques.map((e) => ({
    embarqueCodigo: e.codigo,
    proveedorNombre: e.proveedor.nombre,
    moneda: e.moneda, // enum Moneda = "ARS" | "USD"
    fob: e.fobTotal.toFixed(2),
  }));
}
