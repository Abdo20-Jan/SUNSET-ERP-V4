import "server-only";

import { db } from "@/lib/db";
import { type DespachoBorrador, type ItemContenedor, Prisma } from "@/generated/prisma/client";

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
//                          (Decisión A1: el 4.2 traba con decremento ingenuo;
//                          el 4.3 lo endurece a UPDATE single-shot con 409.)
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
  userId: number;
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

  const items = await lockYResolverItems(
    t,
    lineas.map((l) => l.itemContenedorId),
    input.embarqueId,
  );

  // Traba counters (decremento ingenuo; el single-shot atómico es 4.3).
  const countsTrabados: Record<number, number> = {};
  for (const l of lineas) {
    const it = items.get(l.itemContenedorId)!;
    if (it.cantidadDisponible < l.cantidad) {
      throw new DespachoParcialError(
        "SALDO_INSUFICIENTE",
        `ItemContenedor ${l.itemContenedorId}: disponible ${it.cantidadDisponible} < solicitado ${l.cantidad}.`,
      );
    }
  }
  for (const l of lineas) {
    await t.itemContenedor.update({
      where: { id: l.itemContenedorId },
      data: {
        cantidadDisponible: { decrement: l.cantidad },
        cantidadEnDespacho: { increment: l.cantidad },
      },
    });
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
  // Idempotente: si ya expiró, los counts ya fueron liberados.
  if (borrador.estadoActual === ESTADO_EXPIRADO) {
    return borrador;
  }

  const counts = parseCountsTrabados(borrador.countsTrabados);
  if (counts.length > 0) {
    await lockItemContenedores(
      t,
      counts.map((c) => c.itemContenedorId),
    );
  }

  // P0-4: marcar EXPIRADO *antes* de liberar, para que una retomada concurrente
  // vea el estado terminal y se rechace antes de que los counters se liberen.
  const expirado = await t.despachoBorrador.update({
    where: { id: borradorId },
    data: { estadoActual: ESTADO_EXPIRADO },
  });

  for (const c of counts) {
    await t.itemContenedor.update({
      where: { id: c.itemContenedorId },
      data: {
        cantidadEnDespacho: { decrement: c.cantidad },
        cantidadDisponible: { increment: c.cantidad },
      },
    });
  }

  return expirado;
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

  const items = await lockYResolverItems(
    t,
    lineas.map((l) => l.itemContenedorId),
    input.embarqueId,
  );

  // En el camino directo todavía no se trabó nada: validar saldo acá.
  if (input.fuente === "DIRECTO") {
    for (const l of lineas) {
      const it = items.get(l.itemContenedorId)!;
      if (it.cantidadDisponible < l.cantidad) {
        throw new DespachoParcialError(
          "SALDO_INSUFICIENTE",
          `ItemContenedor ${l.itemContenedorId}: disponible ${it.cantidadDisponible} < solicitado ${l.cantidad}.`,
        );
      }
    }
  }

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
    const data =
      input.fuente === "BORRADOR"
        ? {
            cantidadEnDespacho: { decrement: l.cantidad },
            cantidadDespachada: { increment: l.cantidad },
          }
        : {
            cantidadDisponible: { decrement: l.cantidad },
            cantidadDespachada: { increment: l.cantidad },
          };
    await t.itemContenedor.update({ where: { id: l.itemContenedorId }, data });
  }

  return { despachoId: despacho.id, codigo: despacho.codigo };
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
  return [...acc].map(([itemContenedorId, cantidad]) => ({ itemContenedorId, cantidad }));
}

/**
 * Lock pesimista (FOR UPDATE) sobre los ItemContenedor + resolución con su
 * contenedor. Valida existencia y pertenencia al embarque. Devuelve un Map
 * id→ItemContenedor.
 */
async function lockYResolverItems(
  t: TxClient,
  itemContenedorIds: readonly number[],
  embarqueId: string,
): Promise<Map<number, ItemContenedor>> {
  await lockItemContenedores(t, itemContenedorIds);

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

/** SELECT … FOR UPDATE sobre los ItemContenedor (orden estable anti-deadlock). */
async function lockItemContenedores(
  t: TxClient,
  itemContenedorIds: readonly number[],
): Promise<void> {
  if (itemContenedorIds.length === 0) return;
  const ordenados = [...new Set(itemContenedorIds)].sort((a, b) => a - b);
  await t.$queryRaw`SELECT id FROM "ItemContenedor" WHERE id IN (${Prisma.join(ordenados)}) FOR UPDATE`;
}

async function siguienteCodigoDespacho(t: TxClient, embarqueCodigo: string): Promise<string> {
  const existentes = await t.despacho.count({
    where: { codigo: { startsWith: `${embarqueCodigo}-D` } },
  });
  return `${embarqueCodigo}-D${existentes + 1}`;
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
