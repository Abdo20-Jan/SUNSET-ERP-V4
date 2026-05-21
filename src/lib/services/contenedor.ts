import "server-only";

import { type MoneyInput, precioUnitario, toDecimal } from "@/lib/decimal";
import {
  type Contenedor,
  ContenedorEstado,
  type ItemContenedor,
  Prisma,
} from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { calcularRateioZonaPrimaria } from "@/lib/services/comex";

type TxClient = Prisma.TransactionClient;

// ============================================================
// Service de contenedores (PR 2.1)
// ============================================================
//
// CRUD del packing list de un embarque + la invariante de consolidación:
// para cada producto del embarque, Σ ItemContenedor.cantidadDeclarada (en
// todos los contenedores) debe igualar ItemEmbarque.cantidad.
//
// Los counters del modelo lazy (cantidadDisponible/EnDespacho/Despachada)
// arrancan en 0 — se poblan recién en la desconsolidación (Fase 3). La
// edición del packing list se bloquea una vez que el contenedor llega a
// depósito fiscal (estado >= EN_DEPOSITO_FISCAL).

export type ContenedorErrorCode =
  | "EMBARQUE_INEXISTENTE"
  | "CONTENEDOR_INEXISTENTE"
  | "PRODUCTO_FUERA_DE_EMBARQUE"
  | "CANTIDAD_INVALIDA"
  | "PACKING_LIST_VACIO"
  | "ESTADO_NO_EDITABLE"
  | "CONCURRENCIA"
  | "ESTADO_TRANSICION_INVALIDA"
  | "DEPOSITO_REQUERIDO"
  | "COSTOS_INCOMPLETOS";

export class ContenedorError extends Error {
  readonly code: ContenedorErrorCode;

  constructor(code: ContenedorErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ContenedorError";
    this.code = code;
  }
}

// Orden del ciclo físico/aduanero. La edición del packing list sólo se
// permite mientras el contenedor no haya llegado a depósito fiscal.
export const ESTADO_RANK: Record<ContenedorEstado, number> = {
  BORRADOR: 0,
  EN_TRANSITO: 1,
  ARRIBADO_PUERTO: 2,
  EN_ZONA_PRIMARIA: 3,
  TRASLADO_DEPOSITO_FISCAL: 4,
  EN_DEPOSITO_FISCAL: 5,
  AGUARDANDO_INVESTIGACAO: 6,
  DESCONSOLIDADO: 7,
  PARCIALMENTE_DESPACHADO: 8,
  TOTALMENTE_DESPACHADO: 9,
  NACIONALIZADO_DIRECTO: 10,
  CANCELADO: 11,
};

const RANK_EDITABLE_MAX = ESTADO_RANK.TRASLADO_DEPOSITO_FISCAL;

function esEditable(estado: ContenedorEstado): boolean {
  return ESTADO_RANK[estado] <= RANK_EDITABLE_MAX;
}

export interface ItemContenedorInput {
  productoId: string;
  cantidadDeclarada: number;
  /** Si no se pasa, se resuelve por (embarque, producto). */
  itemEmbarqueId?: number;
  costoFCUnitario?: MoneyInput;
  pesoUnitarioKg?: MoneyInput;
  ncm?: string;
  paisOrigen?: string;
  loteFabricacion?: string;
  observaciones?: string;
}

export interface CrearContenedorInput {
  embarqueId: string;
  numeroContenedor: string;
  tipo?: string;
  numeroBL?: string;
  numeroHBL?: string;
  observaciones?: string;
  items?: ItemContenedorInput[];
}

export interface PackingListProductoDiff {
  productoId: string;
  /** Σ cantidadDeclarada del producto en todos los contenedores. */
  declarado: number;
  /** ItemEmbarque.cantidad esperada. */
  esperado: number;
  /** declarado - esperado (0 = cuadra). */
  diferencia: number;
}

export interface PackingListValidacion {
  ok: boolean;
  /** Todos los productos del embarque con su comparación. */
  productos: PackingListProductoDiff[];
  /** Sólo los productos que no cuadran (diferencia != 0). */
  diffs: PackingListProductoDiff[];
}

/** Resuelve el ItemEmbarque de un (embarque, producto) o lanza si el producto no pertenece al embarque. */
async function resolverItemEmbarque(
  tx: TxClient,
  embarqueId: string,
  productoId: string,
  itemEmbarqueId?: number,
): Promise<number> {
  if (itemEmbarqueId != null) {
    const item = await tx.itemEmbarque.findFirst({
      where: { id: itemEmbarqueId, embarqueId, productoId },
      select: { id: true },
    });
    if (!item) {
      throw new ContenedorError(
        "PRODUCTO_FUERA_DE_EMBARQUE",
        `El itemEmbarque ${itemEmbarqueId} no corresponde al producto ${productoId} del embarque ${embarqueId}.`,
      );
    }
    return item.id;
  }
  const item = await tx.itemEmbarque.findFirst({
    where: { embarqueId, productoId },
    select: { id: true },
  });
  if (!item) {
    throw new ContenedorError(
      "PRODUCTO_FUERA_DE_EMBARQUE",
      `El producto ${productoId} no pertenece al embarque ${embarqueId}.`,
    );
  }
  return item.id;
}

function validarCantidad(item: ItemContenedorInput): void {
  if (!Number.isInteger(item.cantidadDeclarada) || item.cantidadDeclarada <= 0) {
    throw new ContenedorError(
      "CANTIDAD_INVALIDA",
      `cantidadDeclarada debe ser un entero > 0 (producto ${item.productoId}).`,
    );
  }
}

async function buildItemCreateData(
  tx: TxClient,
  embarqueId: string,
  items: readonly ItemContenedorInput[],
): Promise<Prisma.ItemContenedorCreateManyContenedorInput[]> {
  const data: Prisma.ItemContenedorCreateManyContenedorInput[] = [];
  for (const item of items) {
    validarCantidad(item);
    const itemEmbarqueId = await resolverItemEmbarque(
      tx,
      embarqueId,
      item.productoId,
      item.itemEmbarqueId,
    );
    data.push({
      itemEmbarqueId,
      productoId: item.productoId,
      cantidadDeclarada: item.cantidadDeclarada,
      // counters lazy arrancan en 0 (se poblan en desconsolidación).
      cantidadDisponible: 0,
      cantidadEnDespacho: 0,
      cantidadDespachada: 0,
      costoFCUnitario:
        item.costoFCUnitario != null ? precioUnitario(item.costoFCUnitario) : undefined,
      pesoUnitarioKg:
        item.pesoUnitarioKg != null
          ? new Prisma.Decimal(toDecimal(item.pesoUnitarioKg).toFixed(3))
          : undefined,
      ncm: item.ncm,
      paisOrigen: item.paisOrigen,
      loteFabricacion: item.loteFabricacion,
      observaciones: item.observaciones,
    });
  }
  return data;
}

/** Crea un contenedor (opcionalmente con su packing list inicial). */
export async function crearContenedor(
  input: CrearContenedorInput,
  tx?: TxClient,
): Promise<Contenedor> {
  const run = async (inner: TxClient): Promise<Contenedor> => {
    const embarque = await inner.embarque.findUnique({
      where: { id: input.embarqueId },
      select: { id: true },
    });
    if (!embarque) {
      throw new ContenedorError(
        "EMBARQUE_INEXISTENTE",
        `El embarque ${input.embarqueId} no existe.`,
      );
    }

    const items = input.items ?? [];
    const itemsData = await buildItemCreateData(inner, input.embarqueId, items);

    return inner.contenedor.create({
      data: {
        embarqueId: input.embarqueId,
        numeroContenedor: input.numeroContenedor,
        tipo: input.tipo,
        numeroBL: input.numeroBL,
        numeroHBL: input.numeroHBL,
        observaciones: input.observaciones,
        items: itemsData.length > 0 ? { createMany: { data: itemsData } } : undefined,
      },
    });
  };

  if (tx) return run(tx);
  return db.$transaction(run);
}

/**
 * Reemplaza el packing list de un contenedor con bloqueo optimista.
 *
 * El token de concurrencia es `Contenedor.updatedAt` (el modelo no tiene
 * columna `version` — esa vive en ItemContenedor, para los counters de
 * Fase 4). Prisma mapea DateTime a `timestamp(3)`, así que el `Date`
 * redondea a milisegundos y compara exacto.
 *
 * Falla con CONCURRENCIA si `expectedUpdatedAt` no coincide con el valor
 * actual, y con ESTADO_NO_EDITABLE si el contenedor ya pasó a depósito
 * fiscal o más allá.
 */
export async function actualizarPackingList(
  contenedorId: string,
  items: readonly ItemContenedorInput[],
  expectedUpdatedAt: Date,
  tx?: TxClient,
): Promise<Contenedor> {
  const run = async (inner: TxClient): Promise<Contenedor> => {
    if (items.length === 0) {
      throw new ContenedorError(
        "PACKING_LIST_VACIO",
        "El packing list no puede quedar vacío (usá eliminarContenedor).",
      );
    }

    const contenedor = await inner.contenedor.findUnique({
      where: { id: contenedorId },
      select: { id: true, estado: true, embarqueId: true },
    });
    if (!contenedor) {
      throw new ContenedorError(
        "CONTENEDOR_INEXISTENTE",
        `El contenedor ${contenedorId} no existe.`,
      );
    }
    if (!esEditable(contenedor.estado)) {
      throw new ContenedorError(
        "ESTADO_NO_EDITABLE",
        `El contenedor ${contenedorId} está en ${contenedor.estado}: el packing list ya no es editable.`,
      );
    }

    const itemsData = await buildItemCreateData(inner, contenedor.embarqueId, items);

    // Bloqueo optimista: sólo avanza si el updatedAt coincide. Bumpeamos
    // updatedAt explícitamente para invalidar a lectores con token viejo.
    const locked = await inner.contenedor.updateMany({
      where: { id: contenedorId, updatedAt: expectedUpdatedAt },
      data: { updatedAt: new Date() },
    });
    if (locked.count !== 1) {
      throw new ContenedorError(
        "CONCURRENCIA",
        `El contenedor ${contenedorId} fue modificado por otro proceso (token de concurrencia desactualizado).`,
      );
    }

    await inner.itemContenedor.deleteMany({ where: { contenedorId } });
    await inner.itemContenedor.createMany({
      data: itemsData.map((d) => ({ ...d, contenedorId })),
    });

    return inner.contenedor.findUniqueOrThrow({ where: { id: contenedorId } });
  };

  if (tx) return run(tx);
  return db.$transaction(run);
}

/** Elimina un contenedor (sólo en estados editables). */
export async function eliminarContenedor(contenedorId: string, tx?: TxClient): Promise<void> {
  const run = async (inner: TxClient): Promise<void> => {
    const contenedor = await inner.contenedor.findUnique({
      where: { id: contenedorId },
      select: { id: true, estado: true },
    });
    if (!contenedor) {
      throw new ContenedorError(
        "CONTENEDOR_INEXISTENTE",
        `El contenedor ${contenedorId} no existe.`,
      );
    }
    if (!esEditable(contenedor.estado)) {
      throw new ContenedorError(
        "ESTADO_NO_EDITABLE",
        `El contenedor ${contenedorId} está en ${contenedor.estado}: no se puede eliminar.`,
      );
    }
    await inner.contenedor.delete({ where: { id: contenedorId } });
  };

  if (tx) return run(tx);
  return db.$transaction(run);
}

// Estados del ciclo físico/aduanero que se pueden alcanzar avanzando
// manualmente (las fases de despacho las maneja recomputarEstadoContenedor).
export type EstadoFisicoTarget =
  | "EN_TRANSITO"
  | "ARRIBADO_PUERTO"
  | "EN_ZONA_PRIMARIA"
  | "TRASLADO_DEPOSITO_FISCAL"
  | "EN_DEPOSITO_FISCAL";

export interface AvanzarEstadoInput {
  contenedorId: string;
  targetEstado: EstadoFisicoTarget;
  fecha?: Date;
  /** Requerido (recomendado) al entrar a EN_ZONA_PRIMARIA. */
  depositoZonaPrimariaId?: string;
  /** Obligatorio al entrar a EN_DEPOSITO_FISCAL. */
  depositoFiscalId?: string;
}

// Mapea cada estado-target a la columna de fecha que documenta la fase.
const FECHA_POR_ESTADO: Record<EstadoFisicoTarget, keyof Prisma.ContenedorUpdateInput | null> = {
  EN_TRANSITO: "fechaSalidaOrigen",
  ARRIBADO_PUERTO: "fechaLlegadaPuerto",
  EN_ZONA_PRIMARIA: "fechaIngresoZpa",
  TRASLADO_DEPOSITO_FISCAL: "fechaTrasladoDF",
  EN_DEPOSITO_FISCAL: null,
};

/**
 * Avanza el estado físico/aduanero del contenedor a lo largo del ciclo
 * (BORRADOR → EN_TRANSITO → ARRIBADO_PUERTO → EN_ZONA_PRIMARIA →
 * TRASLADO_DEPOSITO_FISCAL → EN_DEPOSITO_FISCAL). Sólo avanza (rank estricto);
 * setea la fecha de la fase y el depósito cuando corresponde. Transición
 * puramente mecánica — el asiento de arribo (1.1.5.04) vive a nivel embarque
 * (ver confirmarZonaPrimariaAction, Modelo Y) y el de traslado lo genera la
 * desconsolidación. EN_DEPOSITO_FISCAL exige depositoFiscalId.
 */
export async function avanzarEstadoContenedor(
  input: AvanzarEstadoInput,
  tx?: TxClient,
): Promise<Contenedor> {
  const run = async (inner: TxClient): Promise<Contenedor> => {
    const contenedor = await inner.contenedor.findUnique({
      where: { id: input.contenedorId },
      select: { id: true, estado: true },
    });
    if (!contenedor) {
      throw new ContenedorError(
        "CONTENEDOR_INEXISTENTE",
        `El contenedor ${input.contenedorId} no existe.`,
      );
    }

    if (ESTADO_RANK[input.targetEstado] <= ESTADO_RANK[contenedor.estado]) {
      throw new ContenedorError(
        "ESTADO_TRANSICION_INVALIDA",
        `No se puede pasar de ${contenedor.estado} a ${input.targetEstado} (sólo se avanza en el ciclo).`,
      );
    }

    if (input.targetEstado === ContenedorEstado.EN_DEPOSITO_FISCAL && !input.depositoFiscalId) {
      throw new ContenedorError(
        "DEPOSITO_REQUERIDO",
        "El depósito fiscal es obligatorio para pasar a EN_DEPOSITO_FISCAL.",
      );
    }

    const data: Prisma.ContenedorUpdateInput = { estado: input.targetEstado };
    const fechaKey = FECHA_POR_ESTADO[input.targetEstado];
    if (fechaKey && input.fecha) {
      (data as Record<string, unknown>)[fechaKey] = input.fecha;
    }
    if (input.depositoZonaPrimariaId) {
      data.depositoZonaPrimaria = { connect: { id: input.depositoZonaPrimariaId } };
    }
    if (input.depositoFiscalId) {
      data.depositoFiscal = { connect: { id: input.depositoFiscalId } };
    }

    return inner.contenedor.update({ where: { id: input.contenedorId }, data });
  };

  if (tx) return run(tx);
  return db.$transaction(run);
}

export interface CerrarCostosOverride {
  productoId: string;
  /** Costo FC unitario (USD) que pisa el valor derivado del rateio. */
  costoFCUnitario: MoneyInput;
}

export interface CerrarCostosInput {
  contenedorId: string;
  /** Token de bloqueo optimista (Contenedor.updatedAt). */
  expectedUpdatedAt: Date;
  /** Overrides manuales por producto; pisan el valor derivado del rateio. */
  overrides?: CerrarCostosOverride[];
}

/**
 * Cierra los costos del contenedor poblando `ItemContenedor.costoFCUnitario`
 * (USD, 4 decimales) — el gate D3 que habilita la desconsolidación.
 *
 * Deriva el costo por SKU reusando `calcularRateioZonaPrimaria` (la misma base
 * que `confirmarZonaPrimariaAction`: FOB + flete/seguro origen + facturas ZP,
 * en ARS) y lo convierte a FC dividiéndolo por el `tipoCambio` del embarque.
 * El rateio se mapea ItemEmbarque→ItemContenedor por `productoId`. Un override
 * manual pisa el valor derivado de ese producto.
 *
 * Corre sólo mientras el contenedor sea editable (rank < EN_DEPOSITO_FISCAL),
 * con bloqueo optimista por `updatedAt`. Si algún item queda sin costo
 * derivable ni override, falla con COSTOS_INCOMPLETOS (no se debe llegar a la
 * desconsolidación con un costoFCUnitario nulo).
 */
export async function cerrarCostosContenedor(
  input: CerrarCostosInput,
  tx?: TxClient,
): Promise<Contenedor> {
  const run = async (inner: TxClient): Promise<Contenedor> => {
    const contenedor = await inner.contenedor.findUnique({
      where: { id: input.contenedorId },
      select: { id: true, estado: true, embarqueId: true },
    });
    if (!contenedor) {
      throw new ContenedorError(
        "CONTENEDOR_INEXISTENTE",
        `El contenedor ${input.contenedorId} no existe.`,
      );
    }
    if (!esEditable(contenedor.estado)) {
      throw new ContenedorError(
        "ESTADO_NO_EDITABLE",
        `El contenedor ${input.contenedorId} está en ${contenedor.estado}: los costos ya no son editables.`,
      );
    }

    const embarque = await inner.embarque.findUnique({
      where: { id: contenedor.embarqueId },
      include: {
        items: { orderBy: { id: "asc" } },
        costos: { orderBy: { id: "asc" }, include: { lineas: { orderBy: { id: "asc" } } } },
      },
    });
    if (!embarque) {
      throw new ContenedorError(
        "EMBARQUE_INEXISTENTE",
        `El embarque ${contenedor.embarqueId} no existe.`,
      );
    }

    // Base de costo idéntica a confirmarZonaPrimariaAction: sólo FOB +
    // flete/seguro origen + facturas con momento=ZONA_PRIMARIA (sin tributos).
    const facturasZpActivas = embarque.costos.filter(
      (f) => f.momento === "ZONA_PRIMARIA" && f.estado !== "ANULADA",
    );
    const rateio = calcularRateioZonaPrimaria(
      {
        fobTotal: embarque.fobTotal,
        embarqueTipoCambio: embarque.tipoCambio,
        costosZp: facturasZpActivas.flatMap((f) =>
          f.lineas.map((l) => ({ subtotal: l.subtotal, tipoCambio: f.tipoCambio })),
        ),
        valorFleteOrigen: embarque.valorFleteOrigen,
        valorSeguroOrigen: embarque.valorSeguroOrigen,
      },
      embarque.items.map((it) => ({
        productoId: it.productoId,
        cantidad: it.cantidad,
        precioUnitarioFob: it.precioUnitarioFob,
      })),
    );

    // costoUnitario está en ARS; el FC unitario (USD) = costoUnitario ÷ TC.
    const tc = toDecimal(embarque.tipoCambio);
    const fcPorProducto = new Map<string, Prisma.Decimal>();
    if (tc.gt(0)) {
      for (const r of rateio) {
        fcPorProducto.set(r.productoId, precioUnitario(toDecimal(r.costoUnitario).dividedBy(tc)));
      }
    }
    const overridePorProducto = new Map<string, Prisma.Decimal>();
    for (const o of input.overrides ?? []) {
      overridePorProducto.set(o.productoId, precioUnitario(o.costoFCUnitario));
    }

    // Bloqueo optimista (mismo patrón que actualizarPackingList).
    const locked = await inner.contenedor.updateMany({
      where: { id: input.contenedorId, updatedAt: input.expectedUpdatedAt },
      data: { updatedAt: new Date() },
    });
    if (locked.count !== 1) {
      throw new ContenedorError(
        "CONCURRENCIA",
        `El contenedor ${input.contenedorId} fue modificado por otro proceso (token de concurrencia desactualizado).`,
      );
    }

    const items = await inner.itemContenedor.findMany({
      where: { contenedorId: input.contenedorId },
      select: { id: true, productoId: true },
    });
    for (const it of items) {
      const fc = overridePorProducto.get(it.productoId) ?? fcPorProducto.get(it.productoId);
      if (fc == null) {
        throw new ContenedorError(
          "COSTOS_INCOMPLETOS",
          `No se pudo derivar costoFCUnitario para el producto ${it.productoId} (no figura en el embarque y no hay override manual).`,
        );
      }
      await inner.itemContenedor.update({ where: { id: it.id }, data: { costoFCUnitario: fc } });
    }

    return inner.contenedor.findUniqueOrThrow({ where: { id: input.contenedorId } });
  };

  if (tx) return run(tx);
  return db.$transaction(run);
}

/**
 * Invariante de consolidación: por cada producto del embarque compara la
 * suma de cantidadDeclarada (en todos los contenedores) contra
 * ItemEmbarque.cantidad. `ok` es true cuando todos los productos cuadran.
 */
export async function validarInvariantePackingList(
  embarqueId: string,
  tx?: TxClient,
): Promise<PackingListValidacion> {
  const run = async (inner: TxClient): Promise<PackingListValidacion> => {
    const itemsEmbarque = await inner.itemEmbarque.findMany({
      where: { embarqueId },
      select: { productoId: true, cantidad: true },
    });
    if (itemsEmbarque.length === 0) {
      throw new ContenedorError(
        "EMBARQUE_INEXISTENTE",
        `El embarque ${embarqueId} no tiene items (¿existe?).`,
      );
    }

    const declaradoPorProducto = await inner.itemContenedor.groupBy({
      by: ["productoId"],
      where: { contenedor: { embarqueId } },
      _sum: { cantidadDeclarada: true },
    });
    const declaradoMap = new Map<string, number>();
    for (const row of declaradoPorProducto) {
      declaradoMap.set(row.productoId, row._sum.cantidadDeclarada ?? 0);
    }

    const productos: PackingListProductoDiff[] = itemsEmbarque.map((ie) => {
      const declarado = declaradoMap.get(ie.productoId) ?? 0;
      return {
        productoId: ie.productoId,
        declarado,
        esperado: ie.cantidad,
        diferencia: declarado - ie.cantidad,
      };
    });
    const diffs = productos.filter((p) => p.diferencia !== 0);

    return { ok: diffs.length === 0, productos, diffs };
  };

  if (tx) return run(tx);
  return run(db);
}

// ----- Lectura para la UI (PR 2.3) ---------------------------------------

/** Línea del packing list serializable (Decimals → string, fechas → ISO). */
export interface PackingItemDTO {
  id: number;
  productoId: string;
  cantidadDeclarada: number;
  costoFCUnitario: string | null;
  pesoUnitarioKg: string | null;
  ncm: string | null;
  paisOrigen: string | null;
  loteFabricacion: string | null;
  observaciones: string | null;
}

/** Contenedor + su packing list, listo para cruzar el boundary server→client. */
export interface ContenedorPackingDTO {
  id: string;
  numeroContenedor: string;
  tipo: string | null;
  numeroBL: string | null;
  numeroHBL: string | null;
  estado: ContenedorEstado;
  /** Editable mientras no haya llegado a depósito fiscal (mismo gate que el service). */
  editable: boolean;
  /** Token de bloqueo optimista (Contenedor.updatedAt en ISO). */
  updatedAt: string;
  items: PackingItemDTO[];
}

/**
 * Lista los contenedores de un embarque con su packing list, en una forma
 * serializable para Server Components / Client Components (la UI de PR 2.3).
 */
export async function listarPackingListDeEmbarque(
  embarqueId: string,
  tx?: TxClient,
): Promise<ContenedorPackingDTO[]> {
  const run = async (inner: TxClient): Promise<ContenedorPackingDTO[]> => {
    const contenedores = await inner.contenedor.findMany({
      where: { embarqueId },
      orderBy: { createdAt: "asc" },
      include: { items: { orderBy: { id: "asc" } } },
    });
    return contenedores.map((c) => ({
      id: c.id,
      numeroContenedor: c.numeroContenedor,
      tipo: c.tipo,
      numeroBL: c.numeroBL,
      numeroHBL: c.numeroHBL,
      estado: c.estado,
      editable: esEditable(c.estado),
      updatedAt: c.updatedAt.toISOString(),
      items: c.items.map((it) => ({
        id: it.id,
        productoId: it.productoId,
        cantidadDeclarada: it.cantidadDeclarada,
        costoFCUnitario: it.costoFCUnitario?.toString() ?? null,
        pesoUnitarioKg: it.pesoUnitarioKg?.toString() ?? null,
        ncm: it.ncm,
        paisOrigen: it.paisOrigen,
        loteFabricacion: it.loteFabricacion,
        observaciones: it.observaciones,
      })),
    }));
  };

  if (tx) return run(tx);
  return run(db);
}

// ----- Lectura para la desconsolidación (PR 3.4) -------------------------

/** Línea del packing list lista para la UI de conferencia física. */
export interface ItemDesconsolidacionDTO {
  /** itemContenedorId — la clave de la conferencia. */
  id: number;
  productoId: string;
  /** "código — nombre" resuelto en el server. */
  productoLabel: string;
  cantidadDeclarada: number;
  costoFCUnitario: string | null;
}

/** Contenedor + sus gates de desconsolidación, serializable server→client. */
export interface ContenedorDesconsolidacionDTO {
  id: string;
  numeroContenedor: string;
  embarqueId: string;
  embarqueCodigo: string;
  estado: ContenedorEstado;
  /** Sólo se desconsolida desde EN_DEPOSITO_FISCAL. */
  puedeDesconsolidar: boolean;
  /** Todos los items tienen costoFCUnitario != null (gate D3). */
  fcCerrado: boolean;
  depositoFiscalAsignado: boolean;
  tipoCambioValido: boolean;
  items: ItemDesconsolidacionDTO[];
}

/**
 * Carga un contenedor con los datos y gates que la página de desconsolidación
 * (PR 3.4) necesita. Devuelve `null` si no existe. Centraliza la
 * serialización (Decimal→string) y el cálculo de los gates espejados en la UI;
 * el service `desconsolidar` revalida igual estos invariantes.
 */
export async function obtenerContenedorParaDesconsolidacion(
  contenedorId: string,
  tx?: TxClient,
): Promise<ContenedorDesconsolidacionDTO | null> {
  const run = async (inner: TxClient): Promise<ContenedorDesconsolidacionDTO | null> => {
    const contenedor = await inner.contenedor.findUnique({
      where: { id: contenedorId },
      include: {
        items: { orderBy: { id: "asc" } },
        embarque: { select: { codigo: true, tipoCambio: true } },
      },
    });
    if (!contenedor) return null;

    const productoIds = Array.from(new Set(contenedor.items.map((it) => it.productoId)));
    const productos = await inner.producto.findMany({
      where: { id: { in: productoIds } },
      select: { id: true, codigo: true, nombre: true },
    });
    const labelMap = new Map(productos.map((p) => [p.id, `${p.codigo} — ${p.nombre}`]));

    return {
      id: contenedor.id,
      numeroContenedor: contenedor.numeroContenedor,
      embarqueId: contenedor.embarqueId,
      embarqueCodigo: contenedor.embarque.codigo,
      estado: contenedor.estado,
      puedeDesconsolidar: contenedor.estado === ContenedorEstado.EN_DEPOSITO_FISCAL,
      fcCerrado:
        contenedor.items.length > 0 && contenedor.items.every((it) => it.costoFCUnitario != null),
      depositoFiscalAsignado: contenedor.depositoFiscalId != null,
      tipoCambioValido: contenedor.embarque.tipoCambio.greaterThan(0),
      items: contenedor.items.map((it) => ({
        id: it.id,
        productoId: it.productoId,
        productoLabel: labelMap.get(it.productoId) ?? it.productoId,
        cantidadDeclarada: it.cantidadDeclarada,
        costoFCUnitario: it.costoFCUnitario?.toString() ?? null,
      })),
    };
  };

  if (tx) return run(tx);
  return run(db);
}

// Re-export para callers que necesiten el tipo del item persistido.
export type { ItemContenedor };
