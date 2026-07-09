import { CompraEstado, DespachoEstado, EmbarqueEstado } from "@/generated/prisma/client";
import { db } from "@/lib/db";

/*
 * Recepción derivada de la Orden de Compra (PR-029 · COMP-02 · OD-11).
 *
 * NO existe modelo `Recepcion` ni action que escriba `CompraEstado.RECIBIDA`
 * (enum sin writer). La pestaña Recepción es 100% READ-ONLY y deriva de los
 * documentos vinculados, en DOS TRILHAS SEPARADAS que nunca se suman:
 *
 *  - COMERCIAL "Facturado": Σ ItemCompra.cantidad de las Compras vinculadas
 *    (`Compra.pedidoCompraId`) en estado EMITIDA/RECIBIDA — el filtro canónico
 *    del propio código (cuentas-a-pagar.ts, bi.ts, anticipos-proveedor.ts).
 *  - FÍSICA "Ingresado a stock": (nacional) Σ MovimientoStock INGRESO con
 *    `itemCompraId` de esas compras — la anulación BORRA los movimientos
 *    (revertirIngresoCompra), así que la suma es el neto real; (comex)
 *    Σ ItemDespacho.cantidad de despachos CONTABILIZADO vía embarques
 *    vinculados (`Embarque.pedidoCompraId`), con fallback legacy: embarque
 *    cerrado monolítico (`asientoId` seteado, sin despachos) nacionalizó todo.
 *
 * Junción por `productoId` (no hay FK ítem-a-ítem pedido↔compra/embarque):
 * líneas duplicadas del mismo producto colapsan y compras/embarques sin
 * vínculo a la OC no se incluyen — disclaimers exhibidos en la pestaña.
 */

export type RecepcionCantidad = { productoId: string; cantidad: number };

export type RecepcionInsumos = {
  /** ItemPedidoCompra de la OC. */
  itemsPedido: RecepcionCantidad[];
  /** ItemCompra de compras vinculadas EMITIDA/RECIBIDA (trilha comercial). */
  facturado: RecepcionCantidad[];
  /** MovimientoStock INGRESO vía itemCompraId (trilha física nacional). */
  ingresadoNacional: RecepcionCantidad[];
  /** ItemEmbarque de embarques vinculados no-BORRADOR (informativo). */
  embarcado: RecepcionCantidad[];
  /** ItemDespacho CONTABILIZADO + fallback embarque cerrado legacy (física comex). */
  nacionalizado: RecepcionCantidad[];
};

export type RecepcionLinea = {
  productoId: string;
  /** 0 ⇒ el producto aparece en documentos vinculados pero no en la OC. */
  pedida: number;
  /** Cap por producto a `pedida` (la conversión OC→Compra no es idempotente). */
  facturada: number;
  /** Σ facturada sin cap — visible cuando excede lo pedido. */
  facturadaBruta: number;
  ingresadaStock: number;
  embarcada: number;
  nacionalizada: number;
  pendienteFacturar: number;
};

function sumarPorProducto(filas: RecepcionCantidad[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const f of filas) {
    map.set(f.productoId, (map.get(f.productoId) ?? 0) + f.cantidad);
  }
  return map;
}

function cantidadDe(map: ReadonlyMap<string, number>, productoId: string): number {
  return map.get(productoId) ?? 0;
}

// Cap por producto a lo pedido (la conversión OC→Compra no es idempotente);
// producto fuera de pedido (pedida=0) queda sin cap para no ocultar la cifra.
function capFacturada(facturadaBruta: number, pedida: number): number {
  if (pedida > 0) return Math.min(facturadaBruta, pedida);
  return facturadaBruta;
}

/** Deriva las líneas de recepción por producto (puro, testeable sin DB). */
export function derivarRecepcionPorProducto(insumos: RecepcionInsumos): RecepcionLinea[] {
  const pedidas = sumarPorProducto(insumos.itemsPedido);
  const facturadas = sumarPorProducto(insumos.facturado);
  const ingresadas = sumarPorProducto(insumos.ingresadoNacional);
  const embarcadas = sumarPorProducto(insumos.embarcado);
  const nacionalizadas = sumarPorProducto(insumos.nacionalizado);

  const productoIds = new Set<string>([
    ...pedidas.keys(),
    ...facturadas.keys(),
    ...ingresadas.keys(),
    ...embarcadas.keys(),
    ...nacionalizadas.keys(),
  ]);

  const lineas: RecepcionLinea[] = [];
  for (const productoId of productoIds) {
    const pedida = cantidadDe(pedidas, productoId);
    const facturadaBruta = cantidadDe(facturadas, productoId);
    const facturada = capFacturada(facturadaBruta, pedida);
    lineas.push({
      productoId,
      pedida,
      facturada,
      facturadaBruta,
      ingresadaStock: cantidadDe(ingresadas, productoId),
      embarcada: cantidadDe(embarcadas, productoId),
      nacionalizada: cantidadDe(nacionalizadas, productoId),
      pendienteFacturar: Math.max(0, pedida - facturada),
    });
  }
  // OC primero (pedida > 0), luego "fuera de pedido"; estable por productoId.
  lineas.sort((a, b) => Number(b.pedida > 0) - Number(a.pedida > 0));
  return lineas;
}

type EmbarqueParaRecepcion = {
  estado: EmbarqueEstado;
  asientoId: string | null;
  items: Array<{ id: number; productoId: string; cantidad: number }>;
  despachos: Array<{
    estado: DespachoEstado;
    items: Array<{ itemEmbarqueId: number; cantidad: number }>;
  }>;
};

/** Cantidades embarcadas (informativo): embarques ya despachados al exterior. */
export function derivarEmbarcado(embarques: EmbarqueParaRecepcion[]): RecepcionCantidad[] {
  const filas: RecepcionCantidad[] = [];
  for (const e of embarques) {
    if (e.estado === EmbarqueEstado.BORRADOR) continue;
    for (const it of e.items) {
      filas.push({ productoId: it.productoId, cantidad: it.cantidad });
    }
  }
  return filas;
}

/**
 * Cantidades nacionalizadas vía Comex: sólo Despacho CONTABILIZADO prueba la
 * nacionalización. Fallback legacy anti-doble-conteo: embarque cerrado
 * monolítico (asiento de cierre seteado) SIN despachos nacionalizó todo.
 */
export function derivarNacionalizado(embarques: EmbarqueParaRecepcion[]): RecepcionCantidad[] {
  const filas: RecepcionCantidad[] = [];
  for (const e of embarques) {
    const productoPorItemEmbarque = new Map(e.items.map((it) => [it.id, it.productoId]));
    const contabilizados = e.despachos.filter((d) => d.estado === DespachoEstado.CONTABILIZADO);
    if (contabilizados.length === 0 && e.asientoId !== null) {
      for (const it of e.items) {
        filas.push({ productoId: it.productoId, cantidad: it.cantidad });
      }
      continue;
    }
    for (const d of contabilizados) {
      for (const it of d.items) {
        const productoId = productoPorItemEmbarque.get(it.itemEmbarqueId);
        if (productoId) filas.push({ productoId, cantidad: it.cantidad });
      }
    }
  }
  return filas;
}

const ESTADOS_FACTURADO: CompraEstado[] = [CompraEstado.EMITIDA, CompraEstado.RECIBIDA];

/**
 * Lee los documentos vinculados a la OC y deriva la recepción (READ-ONLY).
 * No consulta ni modifica ningún motor; sólo agrega documentos existentes.
 */
export async function obtenerRecepcionPedidoCompra(pedidoId: number): Promise<RecepcionLinea[]> {
  const [itemsPedido, compras, embarques] = await Promise.all([
    db.itemPedidoCompra.findMany({
      where: { pedidoCompraId: pedidoId },
      select: { productoId: true, cantidad: true },
    }),
    db.compra.findMany({
      where: { pedidoCompraId: pedidoId },
      select: {
        estado: true,
        items: { select: { id: true, productoId: true, cantidad: true } },
      },
    }),
    db.embarque.findMany({
      where: { pedidoCompraId: pedidoId },
      select: {
        estado: true,
        asientoId: true,
        items: { select: { id: true, productoId: true, cantidad: true } },
        despachos: {
          select: {
            estado: true,
            items: { select: { itemEmbarqueId: true, cantidad: true } },
          },
        },
      },
    }),
  ]);

  const facturado: RecepcionCantidad[] = [];
  const itemCompraIds: number[] = [];
  const productoPorItemCompra = new Map<number, string>();
  for (const c of compras) {
    for (const it of c.items) {
      itemCompraIds.push(it.id);
      productoPorItemCompra.set(it.id, it.productoId);
      if (ESTADOS_FACTURADO.includes(c.estado)) {
        facturado.push({ productoId: it.productoId, cantidad: it.cantidad });
      }
    }
  }

  const ingresos =
    itemCompraIds.length > 0
      ? await db.movimientoStock.findMany({
          where: { tipo: "INGRESO", itemCompraId: { in: itemCompraIds } },
          select: { itemCompraId: true, cantidad: true },
        })
      : [];
  const ingresadoNacional: RecepcionCantidad[] = [];
  for (const m of ingresos) {
    const productoId = m.itemCompraId ? productoPorItemCompra.get(m.itemCompraId) : undefined;
    if (productoId) ingresadoNacional.push({ productoId, cantidad: m.cantidad });
  }

  return derivarRecepcionPorProducto({
    itemsPedido,
    facturado,
    ingresadoNacional,
    embarcado: derivarEmbarcado(embarques),
    nacionalizado: derivarNacionalizado(embarques),
  });
}
