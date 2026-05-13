"use server";

import { EmbarqueEstado, PedidoEstado } from "@/generated/prisma/client";

import { db } from "@/lib/db";

/**
 * Devuelve la matriz de stock por (producto, depósito) para la UI de
 * inventario. Filtra productos activos. Orden estable por código.
 */
export async function listarMatrizInventario(opts?: {
  search?: string;
  take?: number;
}) {
  const search = opts?.search?.trim();
  const take = opts?.take ?? 100;

  const productos = await db.producto.findMany({
    where: {
      activo: true,
      ...(search
        ? {
            OR: [
              { codigo: { contains: search, mode: "insensitive" } },
              { nombre: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { codigo: "asc" },
    take,
    select: {
      id: true,
      codigo: true,
      nombre: true,
      stockActual: true,
      costoPromedio: true,
      stockPorDeposito: {
        select: {
          depositoId: true,
          cantidadFisica: true,
          cantidadReservada: true,
          costoPromedio: true,
        },
      },
    },
  });

  const depositos = await db.deposito.findMany({
    where: { activo: true },
    orderBy: { nombre: "asc" },
    select: { id: true, nombre: true },
  });

  return { productos, depositos };
}

/**
 * Lista productos con stock total > 0 (sumando todos los depósitos),
 * útil para el selector del form de transferencia.
 */
export async function listarProductosConStock() {
  return db.producto.findMany({
    where: { activo: true, stockActual: { gt: 0 } },
    orderBy: { codigo: "asc" },
    select: { id: true, codigo: true, nombre: true, stockActual: true },
  });
}

export type EnTransitoDetalle = {
  embarqueId: string;
  embarqueCodigo: string;
  estado: EmbarqueEstado;
  cantidad: number;
  fechaSalida: Date | null;
  fechaLlegada: Date | null;
  proveedorNombre: string;
};

export type EnTransitoFila = {
  productoId: string;
  codigo: string;
  nombre: string;
  cantidad: number;
  detalles: EnTransitoDetalle[];
};

const ESTADOS_EN_TRANSITO: EmbarqueEstado[] = [
  EmbarqueEstado.EN_TRANSITO,
  EmbarqueEstado.EN_PUERTO,
  EmbarqueEstado.EN_ZONA_PRIMARIA,
  EmbarqueEstado.EN_ADUANA,
];

/**
 * Items en embarques entre salida de origen y nacionalización — antes
 * de llegar al depósito. Stock que sí existe pero todavía no entró al
 * inventario físico (matriz por depósito).
 */
export async function listarEnTransito(opts?: {
  search?: string;
}): Promise<{ filas: EnTransitoFila[] }> {
  const search = opts?.search?.trim();

  const items = await db.itemEmbarque.findMany({
    where: {
      embarque: { estado: { in: ESTADOS_EN_TRANSITO } },
      ...(search
        ? {
            producto: {
              OR: [
                { codigo: { contains: search, mode: "insensitive" } },
                { nombre: { contains: search, mode: "insensitive" } },
              ],
            },
          }
        : {}),
    },
    select: {
      cantidad: true,
      productoId: true,
      producto: { select: { codigo: true, nombre: true } },
      embarque: {
        select: {
          id: true,
          codigo: true,
          estado: true,
          fechaSalida: true,
          fechaLlegada: true,
          proveedor: { select: { nombre: true } },
        },
      },
    },
  });

  const porProducto = new Map<string, EnTransitoFila>();
  for (const item of items) {
    const fila = porProducto.get(item.productoId) ?? {
      productoId: item.productoId,
      codigo: item.producto.codigo,
      nombre: item.producto.nombre,
      cantidad: 0,
      detalles: [],
    };
    fila.cantidad += item.cantidad;
    fila.detalles.push({
      embarqueId: item.embarque.id,
      embarqueCodigo: item.embarque.codigo,
      estado: item.embarque.estado,
      cantidad: item.cantidad,
      fechaSalida: item.embarque.fechaSalida,
      fechaLlegada: item.embarque.fechaLlegada,
      proveedorNombre: item.embarque.proveedor.nombre,
    });
    porProducto.set(item.productoId, fila);
  }

  return {
    filas: [...porProducto.values()].sort((a, b) => a.codigo.localeCompare(b.codigo)),
  };
}

export type EnProduccionDetalle = {
  pedidoId: number;
  pedidoNumero: string;
  estado: PedidoEstado;
  cantidad: number;
  fechaPrevista: Date | null;
  proveedorNombre: string;
};

export type EnProduccionFila = {
  productoId: string;
  codigo: string;
  nombre: string;
  cantidadPedida: number;
  cantidadEmbarcada: number;
  cantidadEnProduccion: number;
  detalles: EnProduccionDetalle[];
};

const ESTADOS_PEDIDO_VIVO: PedidoEstado[] = [
  PedidoEstado.ENVIADO,
  PedidoEstado.CONFIRMADO,
  PedidoEstado.PARCIAL,
];

/**
 * Items pedidos a la fábrica que aún no embarcaron. Calcula remanente
 * a partir de los items del pedido menos lo ya embarcado por embarques
 * vinculados al pedido. Pedidos sin embarques vinculados muestran la
 * cantidad pedida completa.
 */
export async function listarEnProduccion(opts?: {
  search?: string;
}): Promise<{ filas: EnProduccionFila[] }> {
  const search = opts?.search?.trim();

  const pedidos = await db.pedidoCompra.findMany({
    where: {
      estado: { in: ESTADOS_PEDIDO_VIVO },
      ...(search
        ? {
            items: {
              some: {
                producto: {
                  OR: [
                    { codigo: { contains: search, mode: "insensitive" } },
                    { nombre: { contains: search, mode: "insensitive" } },
                  ],
                },
              },
            },
          }
        : {}),
    },
    select: {
      id: true,
      numero: true,
      estado: true,
      fechaPrevista: true,
      proveedor: { select: { nombre: true } },
      items: {
        select: {
          productoId: true,
          cantidad: true,
          producto: { select: { codigo: true, nombre: true } },
        },
      },
      embarques: {
        select: {
          items: { select: { productoId: true, cantidad: true } },
        },
      },
    },
  });

  const porProducto = new Map<string, EnProduccionFila>();

  for (const pedido of pedidos) {
    const embarcadoPorProducto = new Map<string, number>();
    for (const emb of pedido.embarques) {
      for (const it of emb.items) {
        embarcadoPorProducto.set(
          it.productoId,
          (embarcadoPorProducto.get(it.productoId) ?? 0) + it.cantidad,
        );
      }
    }

    for (const item of pedido.items) {
      const pedida = item.cantidad;
      const embarcada = Math.min(embarcadoPorProducto.get(item.productoId) ?? 0, pedida);
      const enProduccion = pedida - embarcada;
      if (enProduccion <= 0) continue;

      const filtroSearch = search?.toLowerCase();
      if (
        filtroSearch &&
        !item.producto.codigo.toLowerCase().includes(filtroSearch) &&
        !item.producto.nombre.toLowerCase().includes(filtroSearch)
      ) {
        continue;
      }

      const fila = porProducto.get(item.productoId) ?? {
        productoId: item.productoId,
        codigo: item.producto.codigo,
        nombre: item.producto.nombre,
        cantidadPedida: 0,
        cantidadEmbarcada: 0,
        cantidadEnProduccion: 0,
        detalles: [],
      };
      fila.cantidadPedida += pedida;
      fila.cantidadEmbarcada += embarcada;
      fila.cantidadEnProduccion += enProduccion;
      fila.detalles.push({
        pedidoId: pedido.id,
        pedidoNumero: pedido.numero,
        estado: pedido.estado,
        cantidad: enProduccion,
        fechaPrevista: pedido.fechaPrevista,
        proveedorNombre: pedido.proveedor.nombre,
      });
      porProducto.set(item.productoId, fila);
    }
  }

  return {
    filas: [...porProducto.values()].sort((a, b) => a.codigo.localeCompare(b.codigo)),
  };
}
