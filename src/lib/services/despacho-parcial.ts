import "server-only";

import Decimal from "decimal.js";

import { db } from "@/lib/db";
import {
  ContenedorEstado,
  type DespachoBorrador,
  type ItemContenedor,
  Prisma,
} from "@/generated/prisma/client";
import { toDecimal } from "@/lib/decimal";

// ============================================================
// PR 4.2 — Despacho parcial cruzado: service + contrato del borrador
// ============================================================
//
// El despacho cruzado consume `cantidad` de líneas de packing list
// (ItemContenedor) de uno o varios contenedores, generando N líneas
// `ItemDespacho` con (contenedorId, itemContenedorId) — el grano de unicidad
// cruzada del esquema #125. Un mismo itemEmbarqueId puede aparecer en varias
// líneas (una por itemContenedor de origen).
//
// Borrador server-side (DespachoBorrador): cuatro verbos.
//   - crearBorrador     → traba counters (disponible→enDespacho) y graba
//                          countsTrabados. Estado CONFIRMADO_TRABA_COUNTS.
//                          El traba es SINGLE-SHOT (PR 4.3): UPDATE condicional
//                          `WHERE cantidadDisponible >= ?` → 0 filas = oversell
//                          evitado, sin lock pesimista ni TOCTOU (≈409).
//   - retomarBorrador   → devuelve el borrador vigente; rechaza EXPIRADO (P0-4).
//   - expirarBorrador   → marca EXPIRADO *antes* de liberar counters (P0-4) y
//                          revierte countsTrabados. Idempotente.
//   - contabilizarBorrador → materializa Despacho + ItemDespacho cruzado,
//                          mueve enDespacho→despachada y consume el borrador.
//                          NO genera asiento (eso es 4.5).
//
// `materializarDespachoCruzado` es el núcleo compartido entre el borrador
// (fuente BORRADOR: enDespacho→despachada) y el camino directo de la action
// `crearDespachoContenedor` (fuente DIRECTO: disponible→despachada en un paso).

type TxClient = Prisma.TransactionClient;

const BORRADOR_TTL_MS = 24 * 60 * 60 * 1000;

const ESTADO_CONFIRMADO = "CONFIRMADO_TRABA_COUNTS";
const ESTADO_EXPIRADO = "EXPIRADO";

export type DespachoParcialErrorCode =
  | "BORRADOR_INEXISTENTE"
  | "BORRADOR_EXPIRADO"
  | "BORRADOR_ESTADO_INVALIDO"
  | "LINEAS_VACIAS"
  | "CANTIDAD_INVALIDA"
  | "ITEM_CONTENEDOR_INEXISTENTE"
  | "ITEM_CONTENEDOR_AJENO"
  | "ITEM_SIN_ITEM_EMBARQUE"
  | "SALDO_INSUFICIENTE"
  | "EMBARQUE_INEXISTENTE";

export class DespachoParcialError extends Error {
  readonly code: DespachoParcialErrorCode;

  constructor(code: DespachoParcialErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DespachoParcialError";
    this.code = code;
  }
}

export interface LineaBorrador {
  itemContenedorId: number;
  cantidad: number;
}

export interface CrearBorradorInput {
  userId: string;
  embarqueId: string;
  lineas: LineaBorrador[];
}

export interface ContabilizarBorradorInput {
  borradorId: string;
  fecha: Date;
}

export type FuenteDespachoCruzado = "BORRADOR" | "DIRECTO";

export interface MaterializarInput {
  embarqueId: string;
  fecha: Date;
  lineas: LineaBorrador[];
  /** BORRADOR: enDespacho→despachada (ya trabado). DIRECTO: disponible→despachada. */
  fuente: FuenteDespachoCruzado;
}

// ------------------------------------------------------------
// crearBorrador
// ------------------------------------------------------------

export async function crearBorrador(
  input: CrearBorradorInput,
  tx?: TxClient,
): Promise<DespachoBorrador> {
  const run = (t: TxClient) => ejecutarCrear(t, input);
  if (tx) return run(tx);
  return db.$transaction(run, { timeout: 10_000, maxWait: 5_000 });
}

async function ejecutarCrear(t: TxClient, input: CrearBorradorInput): Promise<DespachoBorrador> {
  const lineas = consolidarLineas(input.lineas);

  // Resuelve existencia/pertenencia (sin lock pesimista — el traba es single-shot).
  await resolverItems(
    t,
    lineas.map((l) => l.itemContenedorId),
    input.embarqueId,
  );

  // Traba counters single-shot (PR 4.3): un UPDATE condicional por línea,
  // en orden de id (anti-deadlock). El WHERE cantidadDisponible >= ? evita el
  // oversell concurrente sin TOCTOU; 0 filas → SALDO_INSUFICIENTE (≈409).
  const countsTrabados: Record<number, number> = {};
  for (const l of lineas) {
    await decrementarDisponibleSingleShot(t, l.itemContenedorId, l.cantidad, "EN_DESPACHO");
    countsTrabados[l.itemContenedorId] = l.cantidad;
  }

  return t.despachoBorrador.create({
    data: {
      userId: input.userId,
      embarqueId: input.embarqueId,
      estadoActual: ESTADO_CONFIRMADO,
      payloadDiff: { lineas } as unknown as Prisma.InputJsonValue,
      countsTrabados: countsTrabados as unknown as Prisma.InputJsonValue,
      expiresAt: new Date(Date.now() + BORRADOR_TTL_MS),
    },
  });
}

// ------------------------------------------------------------
// retomarBorrador (P0-4: rechaza EXPIRADO)
// ------------------------------------------------------------

export async function retomarBorrador(
  borradorId: string,
  tx?: TxClient,
): Promise<DespachoBorrador> {
  const t = tx ?? db;
  const borrador = await t.despachoBorrador.findUnique({ where: { id: borradorId } });
  if (!borrador) {
    throw new DespachoParcialError("BORRADOR_INEXISTENTE", `El borrador ${borradorId} no existe.`);
  }
  if (borrador.estadoActual === ESTADO_EXPIRADO) {
    throw new DespachoParcialError(
      "BORRADOR_EXPIRADO",
      `El borrador ${borradorId} expiró; creá uno nuevo.`,
    );
  }
  return borrador;
}

// ------------------------------------------------------------
// expirarBorrador (P0-4: EXPIRADO antes de liberar counters)
// ------------------------------------------------------------

export async function expirarBorrador(
  borradorId: string,
  tx?: TxClient,
): Promise<DespachoBorrador> {
  const run = (t: TxClient) => ejecutarExpirar(t, borradorId);
  if (tx) return run(tx);
  return db.$transaction(run, { timeout: 10_000, maxWait: 5_000 });
}

async function ejecutarExpirar(t: TxClient, borradorId: string): Promise<DespachoBorrador> {
  const borrador = await t.despachoBorrador.findUnique({ where: { id: borradorId } });
  if (!borrador) {
    throw new DespachoParcialError("BORRADOR_INEXISTENTE", `El borrador ${borradorId} no existe.`);
  }

  // P0-4 single-shot: la transición a EXPIRADO es un UPDATE condicional —
  // sólo una transacción la gana. Marcar EXPIRADO *antes* de liberar counters
  // hace que una retomada concurrente vea el estado terminal y se rechace.
  const { count } = await t.despachoBorrador.updateMany({
    where: { id: borradorId, estadoActual: { not: ESTADO_EXPIRADO } },
    data: { estadoActual: ESTADO_EXPIRADO },
  });
  // count === 0 → otra transacción ya expiró y liberó los counts: idempotente.
  if (count > 0) {
    for (const c of parseCountsTrabados(borrador.countsTrabados)) {
      await t.itemContenedor.update({
        where: { id: c.itemContenedorId },
        data: {
          cantidadEnDespacho: { decrement: c.cantidad },
          cantidadDisponible: { increment: c.cantidad },
        },
      });
    }
  }

  return t.despachoBorrador.findUniqueOrThrow({ where: { id: borradorId } });
}

// ------------------------------------------------------------
// contabilizarBorrador (materializa Despacho cruzado — sin asiento)
// ------------------------------------------------------------

export async function contabilizarBorrador(
  input: ContabilizarBorradorInput,
  tx?: TxClient,
): Promise<{ despachoId: string; codigo: string }> {
  const run = (t: TxClient) => ejecutarContabilizar(t, input);
  if (tx) return run(tx);
  return db.$transaction(run, { timeout: 10_000, maxWait: 5_000 });
}

async function ejecutarContabilizar(
  t: TxClient,
  input: ContabilizarBorradorInput,
): Promise<{ despachoId: string; codigo: string }> {
  const borrador = await t.despachoBorrador.findUnique({ where: { id: input.borradorId } });
  if (!borrador) {
    throw new DespachoParcialError(
      "BORRADOR_INEXISTENTE",
      `El borrador ${input.borradorId} no existe.`,
    );
  }
  if (borrador.estadoActual !== ESTADO_CONFIRMADO) {
    throw new DespachoParcialError(
      "BORRADOR_ESTADO_INVALIDO",
      `El borrador ${input.borradorId} está en ${borrador.estadoActual}: sólo se contabiliza desde ${ESTADO_CONFIRMADO}.`,
    );
  }
  if (!borrador.embarqueId) {
    throw new DespachoParcialError(
      "EMBARQUE_INEXISTENTE",
      `El borrador ${input.borradorId} no tiene embarque asociado.`,
    );
  }

  const lineas = parsePayloadLineas(borrador.payloadDiff);
  const resultado = await materializarDespachoCruzado(t, {
    embarqueId: borrador.embarqueId,
    fecha: input.fecha,
    lineas,
    fuente: "BORRADOR",
  });

  // El borrador se consume: la fuente de verdad pasa a ser el Despacho.
  await t.despachoBorrador.delete({ where: { id: input.borradorId } });

  return resultado;
}

// ------------------------------------------------------------
// materializarDespachoCruzado — núcleo compartido borrador/directo
// ------------------------------------------------------------

export async function materializarDespachoCruzado(
  t: TxClient,
  input: MaterializarInput,
): Promise<{ despachoId: string; codigo: string }> {
  const lineas = consolidarLineas(input.lineas);

  const embarque = await t.embarque.findUnique({
    where: { id: input.embarqueId },
    select: { id: true, codigo: true, tipoCambio: true },
  });
  if (!embarque) {
    throw new DespachoParcialError(
      "EMBARQUE_INEXISTENTE",
      `El embarque ${input.embarqueId} no existe.`,
    );
  }

  const items = await resolverItems(
    t,
    lineas.map((l) => l.itemContenedorId),
    input.embarqueId,
  );

  const codigo = await siguienteCodigoDespacho(t, embarque.codigo);
  const despacho = await t.despacho.create({
    data: {
      codigo,
      embarqueId: embarque.id,
      fecha: input.fecha,
      tipoCambio: embarque.tipoCambio,
      // Estado BORRADOR: el asiento + paso a CONTABILIZADO es del PR 4.5.
      items: {
        create: lineas.map((l) => {
          const it = items.get(l.itemContenedorId)!;
          if (it.itemEmbarqueId == null) {
            throw new DespachoParcialError(
              "ITEM_SIN_ITEM_EMBARQUE",
              `ItemContenedor ${l.itemContenedorId} no está vinculado a un itemEmbarque.`,
            );
          }
          return {
            itemEmbarqueId: it.itemEmbarqueId,
            contenedorId: it.contenedorId,
            itemContenedorId: it.id,
            cantidad: l.cantidad,
          };
        }),
      },
    },
  });

  for (const l of lineas) {
    if (input.fuente === "BORRADOR") {
      // Ya trabado: mueve enDespacho→despachada (guard enDespacho >= ?).
      await moverEnDespachoADespachadaSingleShot(t, l.itemContenedorId, l.cantidad);
    } else {
      // Camino directo: traba+despacha en un solo UPDATE condicional.
      await decrementarDisponibleSingleShot(t, l.itemContenedorId, l.cantidad, "DESPACHADA");
    }
  }

  // A0 (PR 4.4): transiciona el estado de cada contenedor tocado según sus
  // counters (PARCIALMENTE/TOTALMENTE_DESPACHADO).
  const contenedoresTocados = new Set(
    lineas.map((l) => items.get(l.itemContenedorId)!.contenedorId),
  );
  for (const contenedorId of contenedoresTocados) {
    await recomputarEstadoContenedor(t, contenedorId);
  }

  return { despachoId: despacho.id, codigo: despacho.codigo };
}

// Estados del ciclo de despacho del Contenedor: sólo entre estos transiciona
// `recomputarEstadoContenedor`, para no pisar AGUARDANDO_INVESTIGACAO,
// EN_DEPOSITO_FISCAL, CANCELADO, etc.
const ESTADOS_CICLO_DESPACHO: ReadonlySet<ContenedorEstado> = new Set([
  ContenedorEstado.DESCONSOLIDADO,
  ContenedorEstado.PARCIALMENTE_DESPACHADO,
  ContenedorEstado.TOTALMENTE_DESPACHADO,
]);

/**
 * Recalcula el estado de despacho de un contenedor a partir de los counters de
 * sus ItemContenedor: sin despachar → DESCONSOLIDADO; algo despachado con saldo
 * → PARCIALMENTE_DESPACHADO; todo despachado (disponible+enDespacho = 0) →
 * TOTALMENTE_DESPACHADO. Idempotente; sólo escribe si el estado cambia y sólo
 * desde estados del ciclo de despacho (A0, PR 4.4).
 */
export async function recomputarEstadoContenedor(t: TxClient, contenedorId: string): Promise<void> {
  const contenedor = await t.contenedor.findUnique({
    where: { id: contenedorId },
    select: {
      estado: true,
      items: {
        select: {
          cantidadDisponible: true,
          cantidadEnDespacho: true,
          cantidadDespachada: true,
        },
      },
    },
  });
  if (!contenedor || !ESTADOS_CICLO_DESPACHO.has(contenedor.estado)) return;

  let despachada = 0;
  let restante = 0;
  for (const ic of contenedor.items) {
    despachada += ic.cantidadDespachada;
    restante += ic.cantidadDisponible + ic.cantidadEnDespacho;
  }

  const nuevo: ContenedorEstado =
    despachada === 0
      ? ContenedorEstado.DESCONSOLIDADO
      : restante === 0
        ? ContenedorEstado.TOTALMENTE_DESPACHADO
        : ContenedorEstado.PARCIALMENTE_DESPACHADO;

  if (nuevo !== contenedor.estado) {
    await t.contenedor.update({ where: { id: contenedorId }, data: { estado: nuevo } });
  }
}

// ------------------------------------------------------------
// helpers
// ------------------------------------------------------------

/** Suma cantidades de líneas con el mismo itemContenedorId y valida cada una. */
function consolidarLineas(lineas: readonly LineaBorrador[]): LineaBorrador[] {
  if (lineas.length === 0) {
    throw new DespachoParcialError("LINEAS_VACIAS", "El despacho cruzado no tiene líneas.");
  }
  const acc = new Map<number, number>();
  for (const l of lineas) {
    if (!Number.isInteger(l.cantidad) || l.cantidad <= 0) {
      throw new DespachoParcialError(
        "CANTIDAD_INVALIDA",
        `Cantidad inválida para el ItemContenedor ${l.itemContenedorId} (debe ser entero > 0).`,
      );
    }
    acc.set(l.itemContenedorId, (acc.get(l.itemContenedorId) ?? 0) + l.cantidad);
  }
  // Orden estable por id: los UPDATE single-shot se aplican en este orden para
  // evitar deadlocks entre transacciones que tocan las mismas líneas.
  return [...acc]
    .map(([itemContenedorId, cantidad]) => ({ itemContenedorId, cantidad }))
    .sort((a, b) => a.itemContenedorId - b.itemContenedorId);
}

/**
 * Resuelve los ItemContenedor (sin lock pesimista — la defensa de saldo es el
 * UPDATE condicional single-shot). Valida existencia y pertenencia al embarque.
 * Devuelve un Map id→ItemContenedor.
 */
async function resolverItems(
  t: TxClient,
  itemContenedorIds: readonly number[],
  embarqueId: string,
): Promise<Map<number, ItemContenedor>> {
  const items = await t.itemContenedor.findMany({
    where: { id: { in: [...itemContenedorIds] } },
    include: { contenedor: { select: { embarqueId: true } } },
  });
  const byId = new Map(items.map((it) => [it.id, it]));

  for (const id of itemContenedorIds) {
    const it = byId.get(id);
    if (!it) {
      throw new DespachoParcialError(
        "ITEM_CONTENEDOR_INEXISTENTE",
        `El ItemContenedor ${id} no existe.`,
      );
    }
    if (it.contenedor.embarqueId !== embarqueId) {
      throw new DespachoParcialError(
        "ITEM_CONTENEDOR_AJENO",
        `El ItemContenedor ${id} no pertenece al embarque ${embarqueId}.`,
      );
    }
  }
  return byId;
}

/**
 * Decremento single-shot de cantidadDisponible (PR 4.3): un único UPDATE
 * condicional `WHERE cantidadDisponible >= ?`. 0 filas afectadas → oversell
 * evitado → SALDO_INSUFICIENTE (≈409). `destino` es el counter que recibe la
 * cantidad: EN_DESPACHO (traba del borrador) o DESPACHADA (camino directo).
 */
async function decrementarDisponibleSingleShot(
  t: TxClient,
  itemContenedorId: number,
  cantidad: number,
  destino: "EN_DESPACHO" | "DESPACHADA",
): Promise<void> {
  const data =
    destino === "EN_DESPACHO"
      ? {
          cantidadDisponible: { decrement: cantidad },
          cantidadEnDespacho: { increment: cantidad },
        }
      : {
          cantidadDisponible: { decrement: cantidad },
          cantidadDespachada: { increment: cantidad },
        };
  const { count } = await t.itemContenedor.updateMany({
    where: { id: itemContenedorId, cantidadDisponible: { gte: cantidad } },
    data,
  });
  if (count === 0) {
    throw new DespachoParcialError(
      "SALDO_INSUFICIENTE",
      `ItemContenedor ${itemContenedorId}: disponible insuficiente para ${cantidad}.`,
    );
  }
}

/**
 * Movimiento single-shot enDespacho→despachada al contabilizar (counter ya
 * trabado en el borrador). Guard `cantidadEnDespacho >= ?` por consistencia.
 */
async function moverEnDespachoADespachadaSingleShot(
  t: TxClient,
  itemContenedorId: number,
  cantidad: number,
): Promise<void> {
  const { count } = await t.itemContenedor.updateMany({
    where: { id: itemContenedorId, cantidadEnDespacho: { gte: cantidad } },
    data: {
      cantidadEnDespacho: { decrement: cantidad },
      cantidadDespachada: { increment: cantidad },
    },
  });
  if (count === 0) {
    throw new DespachoParcialError(
      "SALDO_INSUFICIENTE",
      `ItemContenedor ${itemContenedorId}: en despacho insuficiente para ${cantidad}.`,
    );
  }
}

/**
 * Revierte los counters de un despacho cruzado: por cada línea con
 * itemContenedorId, mueve `cantidadDespachada → cantidadDisponible` con un
 * UPDATE condicional (guard `cantidadDespachada >= ?`). Usado al anular
 * (PR 4.6) un despacho cruzado (BORRADOR o CONTABILIZADO) y al eliminar un
 * borrador cruzado, para no dejar `cantidadDespachada` inflada. Líneas con el
 * mismo itemContenedorId se consolidan; el orden por id evita deadlocks.
 */
export async function revertirCountersDespacho(t: TxClient, despachoId: string): Promise<void> {
  const items = await t.itemDespacho.findMany({
    where: { despachoId, itemContenedorId: { not: null } },
    select: { itemContenedorId: true, contenedorId: true, cantidad: true },
  });
  const acc = new Map<number, number>();
  const contenedoresTocados = new Set<string>();
  for (const i of items) {
    if (i.itemContenedorId == null) continue;
    acc.set(i.itemContenedorId, (acc.get(i.itemContenedorId) ?? 0) + i.cantidad);
    if (i.contenedorId) contenedoresTocados.add(i.contenedorId);
  }
  const ordered = [...acc].sort((a, b) => a[0] - b[0]);
  for (const [itemContenedorId, cantidad] of ordered) {
    const { count } = await t.itemContenedor.updateMany({
      where: { id: itemContenedorId, cantidadDespachada: { gte: cantidad } },
      data: {
        cantidadDespachada: { decrement: cantidad },
        cantidadDisponible: { increment: cantidad },
      },
    });
    if (count === 0) {
      throw new DespachoParcialError(
        "SALDO_INSUFICIENTE",
        `ItemContenedor ${itemContenedorId}: despachada insuficiente para revertir ${cantidad}.`,
      );
    }
  }
  // A0 (PR 4.4): al revertir, el contenedor puede volver de
  // TOTALMENTE/PARCIALMENTE_DESPACHADO a un estado con saldo.
  for (const contenedorId of contenedoresTocados) {
    await recomputarEstadoContenedor(t, contenedorId);
  }
}

/**
 * Expira en lote los borradores vencidos (estado CONFIRMADO_TRABA_COUNTS,
 * expiresAt < now). Cada uno se expira en su propia transacción vía
 * `expirarBorrador` (single-shot, idempotente, libera counters): un fallo
 * aislado no impide limpiar el resto. Lo invoca el cron de cleanup (PR 4.6).
 */
export async function expirarBorradoresVencidos(
  now: Date = new Date(),
): Promise<{ cleaned: number; fallidos: string[] }> {
  const vencidos = await db.despachoBorrador.findMany({
    where: { estadoActual: ESTADO_CONFIRMADO, expiresAt: { lt: now } },
    select: { id: true },
  });
  let cleaned = 0;
  const fallidos: string[] = [];
  for (const b of vencidos) {
    try {
      await expirarBorrador(b.id);
      cleaned += 1;
    } catch (err) {
      fallidos.push(b.id);
      console.error("expirarBorradoresVencidos: fallo al expirar", b.id, err);
    }
  }
  return { cleaned, fallidos };
}

async function siguienteCodigoDespacho(t: TxClient, embarqueCodigo: string): Promise<string> {
  const existentes = await t.despacho.count({
    where: { codigo: { startsWith: `${embarqueCodigo}-D` } },
  });
  return `${embarqueCodigo}-D${existentes + 1}`;
}

// ------------------------------------------------------------
// READ — matriz de despacho cruzado (consumida por la UI, PR 4.4)
// ------------------------------------------------------------

/** Una celda SKU × contenedor: saldo disponible para despachar de esa línea. */
export interface MatrizCeldaDTO {
  itemContenedorId: number;
  contenedorId: string;
  numeroContenedor: string;
  cantidadDisponible: number;
  costoFCUnitario: string | null;
}

/** Una fila de la matriz, agrupada por itemEmbarque (SKU del embarque). */
export interface MatrizSkuDTO {
  itemEmbarqueId: number;
  productoId: string;
  productoLabel: string;
  celdas: MatrizCeldaDTO[];
}

export interface MatrizContenedorDTO {
  id: string;
  numeroContenedor: string;
  estado: ContenedorEstado;
}

export interface BorradorVigenteDTO {
  id: string;
  expiresAt: string;
  lineas: LineaBorrador[];
}

export interface MatrizDespachoCruzadoDTO {
  embarqueId: string;
  embarqueCodigo: string;
  tipoCambio: string;
  contenedores: MatrizContenedorDTO[];
  skus: MatrizSkuDTO[];
  /** Borrador CONFIRMADO no vencido del usuario para este embarque (P0-4). */
  borradorVigente: BorradorVigenteDTO | null;
}

/**
 * READ serializable (Decimal→string) para la matriz de despacho cruzado:
 * contenedores con saldo disponible del embarque, líneas agrupadas por SKU
 * (itemEmbarque) y el borrador vigente del usuario si existe. Sólo considera
 * contenedores en el ciclo de despacho con saldo (`cantidadDisponible > 0`).
 */
export async function obtenerMatrizDespachoCruzado(
  embarqueId: string,
  userId: string,
  tx?: TxClient,
): Promise<MatrizDespachoCruzadoDTO | null> {
  const t = tx ?? db;
  const embarque = await t.embarque.findUnique({
    where: { id: embarqueId },
    select: { id: true, codigo: true, tipoCambio: true },
  });
  if (!embarque) return null;

  const contenedores = await t.contenedor.findMany({
    where: {
      embarqueId,
      estado: {
        in: [ContenedorEstado.DESCONSOLIDADO, ContenedorEstado.PARCIALMENTE_DESPACHADO],
      },
    },
    select: {
      id: true,
      numeroContenedor: true,
      estado: true,
      items: {
        where: { cantidadDisponible: { gt: 0 }, itemEmbarqueId: { not: null } },
        select: {
          id: true,
          itemEmbarqueId: true,
          productoId: true,
          cantidadDisponible: true,
          costoFCUnitario: true,
        },
        orderBy: { id: "asc" },
      },
    },
    orderBy: { numeroContenedor: "asc" },
  });

  const productoIds = [...new Set(contenedores.flatMap((c) => c.items.map((i) => i.productoId)))];
  const productos = await t.producto.findMany({
    where: { id: { in: productoIds } },
    select: { id: true, codigo: true, nombre: true },
  });
  const prodLabel = new Map(productos.map((p) => [p.id, `${p.codigo} — ${p.nombre}`]));

  const skuMap = new Map<number, MatrizSkuDTO>();
  const contenedorDTOs: MatrizContenedorDTO[] = [];
  for (const c of contenedores) {
    contenedorDTOs.push({ id: c.id, numeroContenedor: c.numeroContenedor, estado: c.estado });
    for (const it of c.items) {
      if (it.itemEmbarqueId == null) continue;
      let sku = skuMap.get(it.itemEmbarqueId);
      if (!sku) {
        sku = {
          itemEmbarqueId: it.itemEmbarqueId,
          productoId: it.productoId,
          productoLabel: prodLabel.get(it.productoId) ?? it.productoId,
          celdas: [],
        };
        skuMap.set(it.itemEmbarqueId, sku);
      }
      sku.celdas.push({
        itemContenedorId: it.id,
        contenedorId: c.id,
        numeroContenedor: c.numeroContenedor,
        cantidadDisponible: it.cantidadDisponible,
        costoFCUnitario: it.costoFCUnitario?.toString() ?? null,
      });
    }
  }

  const borrador = await t.despachoBorrador.findFirst({
    where: {
      embarqueId,
      userId,
      estadoActual: ESTADO_CONFIRMADO,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });

  return {
    embarqueId: embarque.id,
    embarqueCodigo: embarque.codigo,
    tipoCambio: embarque.tipoCambio.toString(),
    contenedores: contenedorDTOs,
    skus: [...skuMap.values()],
    borradorVigente: borrador
      ? {
          id: borrador.id,
          expiresAt: borrador.expiresAt.toISOString(),
          lineas: parsePayloadLineas(borrador.payloadDiff),
        }
      : null,
  };
}

interface CountTrabado {
  itemContenedorId: number;
  cantidad: number;
}

function parseCountsTrabados(value: Prisma.JsonValue | null): CountTrabado[] {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return [];
  const out: CountTrabado[] = [];
  for (const [k, v] of Object.entries(value)) {
    const itemContenedorId = Number(k);
    const cantidad = typeof v === "number" ? v : Number(v);
    if (Number.isInteger(itemContenedorId) && Number.isFinite(cantidad) && cantidad > 0) {
      out.push({ itemContenedorId, cantidad });
    }
  }
  return out;
}

function parsePayloadLineas(value: Prisma.JsonValue | null): LineaBorrador[] {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new DespachoParcialError(
      "BORRADOR_ESTADO_INVALIDO",
      "El borrador no tiene payload válido.",
    );
  }
  const lineas = (value as { lineas?: unknown }).lineas;
  if (!Array.isArray(lineas)) {
    throw new DespachoParcialError(
      "BORRADOR_ESTADO_INVALIDO",
      "El borrador no tiene líneas en el payload.",
    );
  }
  return lineas.map((l) => {
    const rec = l as { itemContenedorId?: unknown; cantidad?: unknown };
    return { itemContenedorId: Number(rec.itemContenedorId), cantidad: Number(rec.cantidad) };
  });
}

// ============================================================
// Costo landed del despacho cruzado (fuente única)
// ============================================================
//
// Decisión (Modelo Y / despacho parcial cruzado): los tributos aduaneros
// CAPITALIZABLES (DIE + Tasa Estadística + Arancel SIM) y el subtotal de
// las facturas DESPACHO linkadas integran el COSTO de la mercadería
// nacionalizada (DEBE 1.1.5.01), no un egreso 5.7.1.x. IVA / IVA adicional
// / IIBB / Ganancias siguen como crédito fiscal (NO capitalizan).
//
// `calcularCostoLandedDespacho` es la FUENTE ÚNICA de costo: la usa tanto
// `crearAsientoDespachoCruzado` (para el DEBE 1.1.5.01) como el flujo de
// stock (costo del ingreso al depósito NACIONAL al nacionalizar). Replica
// el patrón de rateio de `calcularRateioZonaPrimaria`: prorratea los
// capitalizables proporcional a la base de costo FOB de cada ítem
// (cantidad × costoFCUnitario) y deja el residuo al último ítem para
// reconciliar al centavo con el asiento.

const round2 = (value: Decimal): Decimal => value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const round4 = (value: Decimal): Decimal => value.toDecimalPlaces(4, Decimal.ROUND_HALF_UP);

export interface ItemLandedInput {
  /** ItemDespacho.id — clave del resultado. */
  itemDespachoId: number;
  productoId: string;
  cantidad: number;
  /** Snapshot FC unitario del ItemContenedor (en moneda del embarque). */
  costoFCUnitario: Decimal.Value;
}

export interface FacturaDespachoLandedInput {
  /** Subtotal capitalizable de la factura (Σ líneas, en moneda de la factura). */
  subtotal: Decimal.Value;
  /** TC de la factura para convertir el subtotal a ARS. */
  tipoCambio: Decimal.Value;
}

export interface CostoLandedInput {
  /** TC del embarque — convierte el costo FC a ARS. */
  tipoCambioEmbarque: Decimal.Value;
  /** TC del despacho — convierte los tributos aduaneros a ARS. */
  tipoCambioDespacho: Decimal.Value;
  /** Tributos capitalizables (en moneda del embarque/despacho). */
  die: Decimal.Value;
  tasaEstadistica: Decimal.Value;
  arancelSim: Decimal.Value;
  /** Facturas DESPACHO linkadas (subtotales capitalizables). */
  facturasDespacho: readonly FacturaDespachoLandedInput[];
  items: readonly ItemLandedInput[];
}

export interface ItemLandedResult {
  itemDespachoId: number;
  productoId: string;
  cantidad: number;
  /** Costo FC unitario × TC embarque, ARS (sin capitalizables), 2dp. */
  costoFcUnitarioArs: Decimal;
  /** Capitalizables prorrateados a este ítem, ARS, 2dp. */
  capitalizablesItemArs: Decimal;
  /** Costo total landed del ítem (FC + capitalizables), ARS, 2dp. */
  costoTotalArs: Decimal;
  /** Costo landed UNITARIO (costoTotalArs / cantidad), ARS, 4dp. */
  costoUnitarioLandedArs: Decimal;
}

export interface CostoLandedResult {
  /** Σ (costoFC × cantidad × TCembarque) — sale del DF (HABER 1.1.5.05). */
  nacionalizadoArs: Decimal;
  /** Tributos capitalizables en ARS (DIE + Tasa + Arancel) × TCdespacho. */
  tributosCapitalizablesArs: Decimal;
  /** Σ subtotales de facturas DESPACHO en ARS. */
  facturasCapitalizablesArs: Decimal;
  /** Total capitalizable ARS = tributos + facturas. */
  capitalizablesArs: Decimal;
  /** DEBE 1.1.5.01 = nacionalizadoArs + capitalizablesArs. */
  costoTotalArs: Decimal;
  /** Resultado por ItemDespacho. */
  porItem: ItemLandedResult[];
  /** Acceso O(1) por itemDespachoId al costo unitario landed (4dp). */
  costoUnitarioLandedPorItem: Map<number, Decimal>;
}

/**
 * Calcula el costo landed (en ARS) de un despacho cruzado, prorrateando los
 * capitalizables (DIE + Tasa + Arancel + facturas DESPACHO) entre los ítems
 * proporcional a su base FOB (cantidad × costoFCUnitario × TCembarque).
 *
 * Fallback: si la base FOB total es 0 (muestras), prorratea por cantidad.
 * El último ítem absorbe el residuo para que Σ porItem.costoTotalArs sea
 * exactamente costoTotalArs (reconciliación al centavo con el asiento).
 */
export function calcularCostoLandedDespacho(input: CostoLandedInput): CostoLandedResult {
  const tcEmb = toDecimal(input.tipoCambioEmbarque);
  const tcDsp = toDecimal(input.tipoCambioDespacho);

  // Base FOB por ítem en ARS (cantidad × costoFC × TCembarque) y nacionalizado.
  let nacionalizadoArs = new Decimal(0);
  const baseFobArs: Decimal[] = [];
  const costoFcUnitarioArs: Decimal[] = [];
  for (const item of input.items) {
    const fcUnitArs = round2(toDecimal(item.costoFCUnitario).times(tcEmb));
    const fcTotalArs = round2(fcUnitArs.times(item.cantidad));
    costoFcUnitarioArs.push(fcUnitArs);
    baseFobArs.push(fcTotalArs);
    nacionalizadoArs = nacionalizadoArs.plus(fcTotalArs);
  }

  // Importante: arredondar cada tributo separadamente em ARS antes de somar,
  // espelhando exatamente o critério do asiento (`crearAsientoDespachoCruzado`),
  // que credita 2.1.5.01/02/03 com `toDecimal(x).times(tcDsp).toDecimalPlaces(2)`
  // por tributo. Se aqui somássemos USD e arredondássemos uma vez só, com TCdsp
  // decimal (ex.: 1399.5) os meios centavos (half-up) divergiriam e o asiento
  // ficaria 0,01 fora de balanço (DEBE 1.1.5.01 vs. suma HABERs aduana).
  const dieArs = round2(toDecimal(input.die).times(tcDsp));
  const teArs = round2(toDecimal(input.tasaEstadistica).times(tcDsp));
  const arancelSimArs = round2(toDecimal(input.arancelSim).times(tcDsp));
  const tributosCapitalizablesArs = dieArs.plus(teArs).plus(arancelSimArs);
  const facturasCapitalizablesArs = input.facturasDespacho.reduce(
    (acc, f) => acc.plus(round2(toDecimal(f.subtotal).times(toDecimal(f.tipoCambio)))),
    new Decimal(0),
  );
  const capitalizablesArs = round2(tributosCapitalizablesArs.plus(facturasCapitalizablesArs));
  const costoTotalArs = round2(nacionalizadoArs.plus(capitalizablesArs));

  const baseFobTotal = baseFobArs.reduce((acc, b) => acc.plus(b), new Decimal(0));
  const cantidadTotal = input.items.reduce((acc, it) => acc + it.cantidad, 0);
  const usarRateioPorCantidad = !baseFobTotal.gt(0);
  const lastIdx = input.items.length - 1;
  let acumulado = new Decimal(0);

  const porItem: ItemLandedResult[] = input.items.map((item, idx) => {
    let capitalizablesItemArs: Decimal;
    if (idx === lastIdx) {
      capitalizablesItemArs = round2(capitalizablesArs.minus(acumulado));
    } else {
      const proporcion = usarRateioPorCantidad
        ? cantidadTotal > 0
          ? new Decimal(item.cantidad).dividedBy(cantidadTotal)
          : new Decimal(0)
        : baseFobArs[idx].dividedBy(baseFobTotal);
      capitalizablesItemArs = round2(capitalizablesArs.times(proporcion));
      acumulado = acumulado.plus(capitalizablesItemArs);
    }

    const costoTotalItemArs = round2(baseFobArs[idx].plus(capitalizablesItemArs));
    const costoUnitarioLandedArs =
      item.cantidad > 0 ? round4(costoTotalItemArs.dividedBy(item.cantidad)) : new Decimal(0);

    return {
      itemDespachoId: item.itemDespachoId,
      productoId: item.productoId,
      cantidad: item.cantidad,
      costoFcUnitarioArs: costoFcUnitarioArs[idx],
      capitalizablesItemArs,
      costoTotalArs: costoTotalItemArs,
      costoUnitarioLandedArs,
    };
  });

  const costoUnitarioLandedPorItem = new Map<number, Decimal>();
  for (const r of porItem) {
    costoUnitarioLandedPorItem.set(r.itemDespachoId, r.costoUnitarioLandedArs);
  }

  return {
    nacionalizadoArs: round2(nacionalizadoArs),
    tributosCapitalizablesArs,
    facturasCapitalizablesArs: round2(facturasCapitalizablesArs),
    capitalizablesArs,
    costoTotalArs,
    porItem,
    costoUnitarioLandedPorItem,
  };
}
