import "server-only";

import { money } from "@/lib/decimal";
import { db } from "@/lib/db";
import { crearAsientoTransferenciaSubcuenta } from "@/lib/services/asiento-automatico";
import { aplicarIngresoSPD } from "@/lib/services/stock";
import {
  type Asiento,
  type Contenedor,
  ContenedorEstado,
  type Desconsolidacion,
  type ItemContenedor,
  MovimientoStockTipo,
  Prisma,
} from "@/generated/prisma/client";

// ============================================================
// PR 3.2 — Desconsolidación atómica (D4) + gate divergencia (D9)
// ============================================================
//
// Abre un contenedor en depósito fiscal: graba el físico conferido, detecta
// divergencia y —si no la hay— mueve el stock al DF y genera el asiento
// principal de transferencia de subcuenta (TRASLADO ZPA→DF, DEBE 1.1.5.05 /
// HABER 1.1.5.04). Si hay divergencia (físico ≠ declarado en algún SKU),
// BLOQUEA el asiento/stock, crea el header de Desconsolidacion (para que la
// investigación de PR 3.3 se enganche) y deja el contenedor en
// AGUARDANDO_INVESTIGACAO.
//
// Lock pesimista (FOR UPDATE) sobre el contenedor; transacción corta
// (timeout 10s, maxWait 5s). Idempotencia vía IdempotencyKey + guard de
// estado. Los side-effects (PDF, notificación) van FUERA de esta transacción.
//
// Diferido (decisión Onda 2): el asiento de Responsabilidad Sustituta
// (Deposito.esDeTerceros, cuentas de orden 9.x) — requiere la categoría
// ORDEN en el schema y el helper crearAsientoRespSustituta, que viven en un
// PR dedicado de Fase 3.

type TxClient = Prisma.TransactionClient;

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export type DesconsolidacionErrorCode =
  | "CONTENEDOR_INEXISTENTE"
  | "ESTADO_INVALIDO"
  | "YA_DESCONSOLIDADO"
  | "FC_NO_CERRADO"
  | "DEPOSITO_FISCAL_FALTANTE"
  | "CONFERENCIA_INVALIDA"
  | "PACKING_LIST_VACIO"
  | "TIPO_CAMBIO_INVALIDO"
  | "ARRIBO_PENDIENTE";

export class DesconsolidacionError extends Error {
  readonly code: DesconsolidacionErrorCode;

  constructor(code: DesconsolidacionErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DesconsolidacionError";
    this.code = code;
  }
}

export interface ConferenciaItem {
  itemContenedorId: number;
  cantidadFisica: number;
}

export interface DesconsolidarInput {
  contenedorId: string;
  /** Conteo físico por ItemContenedor. Los items omitidos asumen físico == declarado. */
  conferencia?: ConferenciaItem[];
  fecha: Date;
  usuarioId?: number;
  /** Llave de idempotencia para reentrada (P1-6). */
  idempotencyKey?: string;
}

export interface DesconsolidacionDiff {
  itemContenedorId: number;
  productoId: string;
  cantidadDeclarada: number;
  cantidadFisica: number;
  /** físico − declarado (negativo = falta; positivo = sobra). */
  diferencia: number;
}

export interface DesconsolidacionResult {
  desconsolidacion: Desconsolidacion;
  contenedor: Contenedor;
  /** true si algún SKU presenta físico ≠ declarado (gate D9). */
  divergencia: boolean;
  /** Asiento principal de traslado; null cuando hay divergencia (bloqueado). */
  asiento: Asiento | null;
  diffs: DesconsolidacionDiff[];
}

/**
 * Desconsolida un contenedor en depósito fiscal. Ver cabecera del módulo.
 */
export async function desconsolidar(
  input: DesconsolidarInput,
  tx?: TxClient,
): Promise<DesconsolidacionResult> {
  const run = (t: TxClient) => ejecutar(t, input);
  if (tx) return run(tx);
  return db.$transaction(run, { timeout: 10_000, maxWait: 5_000 });
}

async function ejecutar(t: TxClient, input: DesconsolidarInput): Promise<DesconsolidacionResult> {
  // 1. Lock pesimista sobre el contenedor.
  await t.$queryRaw`SELECT id FROM "Contenedor" WHERE id = ${input.contenedorId} FOR UPDATE`;

  const contenedor = await t.contenedor.findUnique({
    where: { id: input.contenedorId },
    include: {
      items: true,
      embarque: { select: { tipoCambio: true, asientoZonaPrimariaId: true } },
    },
  });
  if (!contenedor) {
    throw new DesconsolidacionError(
      "CONTENEDOR_INEXISTENTE",
      `El contenedor ${input.contenedorId} no existe.`,
    );
  }

  // 2. Idempotencia: si la key ya corrió, devolver el resultado previo.
  if (input.idempotencyKey) {
    const previo = await t.idempotencyKey.findUnique({ where: { key: input.idempotencyKey } });
    if (previo) {
      return recargarResultado(t, input.contenedorId, previo.response);
    }
  }

  // 3. Guards de estado.
  if (contenedor.estado === ContenedorEstado.DESCONSOLIDADO) {
    throw new DesconsolidacionError(
      "YA_DESCONSOLIDADO",
      `El contenedor ${input.contenedorId} ya fue desconsolidado.`,
    );
  }
  if (contenedor.estado !== ContenedorEstado.EN_DEPOSITO_FISCAL) {
    throw new DesconsolidacionError(
      "ESTADO_INVALIDO",
      `El contenedor ${input.contenedorId} está en ${contenedor.estado}: sólo se desconsolida desde EN_DEPOSITO_FISCAL.`,
    );
  }
  if (contenedor.items.length === 0) {
    throw new DesconsolidacionError(
      "PACKING_LIST_VACIO",
      `El contenedor ${input.contenedorId} no tiene packing list.`,
    );
  }
  if (!contenedor.depositoFiscalId) {
    throw new DesconsolidacionError(
      "DEPOSITO_FISCAL_FALTANTE",
      `El contenedor ${input.contenedorId} no tiene depósito fiscal asignado.`,
    );
  }
  // 4. FC cerrado (gate D3) en todos los items.
  if (contenedor.items.some((it) => it.costoFCUnitario == null)) {
    throw new DesconsolidacionError(
      "FC_NO_CERRADO",
      `El contenedor ${input.contenedorId} tiene items sin costo FC unitario (cerrá costos antes de desconsolidar).`,
    );
  }

  const tipoCambio = contenedor.embarque.tipoCambio;
  if (tipoCambio.lessThanOrEqualTo(0)) {
    throw new DesconsolidacionError(
      "TIPO_CAMBIO_INVALIDO",
      "El embarque no tiene un tipo de cambio válido.",
    );
  }

  // 5. Resolver físico por item (conferencia o, en su defecto, declarado).
  const fisicaPorItem = resolverFisica(contenedor.items, input.conferencia);

  // Graba cantidadFisica en TODOS los items (lo necesita la investigación D9).
  for (const it of contenedor.items) {
    await t.itemContenedor.update({
      where: { id: it.id },
      data: { cantidadFisica: fisicaPorItem.get(it.id)! },
    });
  }

  const diffs: DesconsolidacionDiff[] = contenedor.items.map((it) => {
    const fisica = fisicaPorItem.get(it.id)!;
    return {
      itemContenedorId: it.id,
      productoId: it.productoId,
      cantidadDeclarada: it.cantidadDeclarada,
      cantidadFisica: fisica,
      diferencia: fisica - it.cantidadDeclarada,
    };
  });
  const hayDivergencia = diffs.some((d) => d.diferencia !== 0);

  const declaradoTotal = diffs.reduce((acc, d) => acc + d.cantidadDeclarada, 0);
  const fisicaTotal = diffs.reduce((acc, d) => acc + d.cantidadFisica, 0);

  // 6. Header de la desconsolidación (se crea en ambos caminos).
  const desconsolidacion = await t.desconsolidacion.create({
    data: {
      contenedorId: input.contenedorId,
      depositoFiscalId: contenedor.depositoFiscalId,
      fecha: input.fecha,
      usuarioId: input.usuarioId,
      cantidadDeclaradaTotal: declaradoTotal,
      cantidadFisicaTotal: fisicaTotal,
    },
  });

  // 7. Gate D9: con divergencia se bloquea el asiento/stock.
  if (hayDivergencia) {
    const actualizado = await t.contenedor.update({
      where: { id: input.contenedorId },
      data: { estado: ContenedorEstado.AGUARDANDO_INVESTIGACAO },
    });
    await registrarIdempotencia(t, input.idempotencyKey, {
      desconsolidacionId: desconsolidacion.id,
      divergencia: true,
      asientoId: null,
    });
    return { desconsolidacion, contenedor: actualizado, divergencia: true, asiento: null, diffs };
  }

  // Guard de coherencia de camino (Onda A #3): el traslado 1.1.5.04 → 1.1.5.05
  // sólo es válido si el arribo a zona primaria YA debitó 1.1.5.04
  // (embarque.asientoZonaPrimariaId). Sin arribo, acreditar 1.1.5.04 la dejaría
  // con saldo acreedor y 1.1.5.05 inflada — raíz de la anomalía de 1.1.5.05.
  if (!contenedor.embarque.asientoZonaPrimariaId) {
    throw new DesconsolidacionError(
      "ARRIBO_PENDIENTE",
      `El contenedor ${input.contenedorId}: el embarque no confirmó zona primaria (arribo) — corré el arribo antes de desconsolidar.`,
    );
  }

  // 8. Sin divergencia: counters, stock consolidado por SKU y asiento principal.
  for (const it of contenedor.items) {
    const fisica = fisicaPorItem.get(it.id)!;
    await t.itemContenedor.update({
      where: { id: it.id },
      data: { cantidadDisponible: fisica, cantidadEnDespacho: 0, cantidadDespachada: 0 },
    });
  }

  let montoTotalARS = new Prisma.Decimal(0);
  const grupos = agruparPorProducto(contenedor.items, fisicaPorItem);
  for (const grupo of grupos) {
    const arsUnitario = grupo.fcPromedio.times(tipoCambio);
    montoTotalARS = montoTotalARS.plus(arsUnitario.times(grupo.cantidad));

    await t.movimientoStock.create({
      data: {
        productoId: grupo.productoId,
        depositoId: contenedor.depositoFiscalId,
        tipo: MovimientoStockTipo.INGRESO,
        cantidad: grupo.cantidad,
        costoUnitario: money(arsUnitario),
        fecha: input.fecha,
        contenedorId: input.contenedorId,
        itemContenedorId: grupo.itemContenedorId,
        desconsolidacionId: desconsolidacion.id,
      },
    });
    await aplicarIngresoSPD(
      t,
      grupo.productoId,
      contenedor.depositoFiscalId,
      grupo.cantidad,
      arsUnitario,
    );
  }

  let asiento: Asiento | null = null;
  if (montoTotalARS.greaterThan(0)) {
    asiento = await crearAsientoTransferenciaSubcuenta(
      {
        flujo: "TRASLADO_DEPOSITO_FISCAL",
        monto: montoTotalARS.toFixed(2),
        fecha: input.fecha,
        descripcion: `Desconsolidación contenedor ${contenedor.numeroContenedor}`,
      },
      t,
    );
  }

  const actualizado = await t.contenedor.update({
    where: { id: input.contenedorId },
    data: { estado: ContenedorEstado.DESCONSOLIDADO, fechaDesconsolidacion: input.fecha },
  });

  await registrarIdempotencia(t, input.idempotencyKey, {
    desconsolidacionId: desconsolidacion.id,
    divergencia: false,
    asientoId: asiento?.id ?? null,
  });

  return { desconsolidacion, contenedor: actualizado, divergencia: false, asiento, diffs };
}

// ---- helpers ----------------------------------------------------------

/** Físico por item: usa la conferencia y valida; los omitidos = declarado. */
function resolverFisica(
  items: readonly ItemContenedor[],
  conferencia: readonly ConferenciaItem[] | undefined,
): Map<number, number> {
  const idsValidos = new Set(items.map((it) => it.id));
  const conferido = new Map<number, number>();
  for (const c of conferencia ?? []) {
    if (!idsValidos.has(c.itemContenedorId)) {
      throw new DesconsolidacionError(
        "CONFERENCIA_INVALIDA",
        `El ItemContenedor ${c.itemContenedorId} no pertenece a este contenedor.`,
      );
    }
    if (!Number.isInteger(c.cantidadFisica) || c.cantidadFisica < 0) {
      throw new DesconsolidacionError(
        "CONFERENCIA_INVALIDA",
        `cantidadFisica inválida para el item ${c.itemContenedorId} (debe ser entero >= 0).`,
      );
    }
    conferido.set(c.itemContenedorId, c.cantidadFisica);
  }
  const fisica = new Map<number, number>();
  for (const it of items) {
    fisica.set(it.id, conferido.get(it.id) ?? it.cantidadDeclarada);
  }
  return fisica;
}

interface GrupoSku {
  productoId: string;
  cantidad: number;
  /** FC unitario promedio ponderado (USD). */
  fcPromedio: Prisma.Decimal;
  /** id del ItemContenedor cuando el SKU vive en una sola línea; null si en varias. */
  itemContenedorId: number | null;
}

/** Agrupa el packing list por producto (1 movimiento de stock por SKU). */
function agruparPorProducto(
  items: readonly ItemContenedor[],
  fisicaPorItem: Map<number, number>,
): GrupoSku[] {
  const acc = new Map<string, { cantidad: number; valorUSD: Prisma.Decimal; itemIds: number[] }>();
  for (const it of items) {
    const fisica = fisicaPorItem.get(it.id)!;
    const fc = it.costoFCUnitario as Prisma.Decimal;
    const prev = acc.get(it.productoId) ?? {
      cantidad: 0,
      valorUSD: new Prisma.Decimal(0),
      itemIds: [],
    };
    prev.cantidad += fisica;
    prev.valorUSD = prev.valorUSD.plus(fc.times(fisica));
    prev.itemIds.push(it.id);
    acc.set(it.productoId, prev);
  }
  const grupos: GrupoSku[] = [];
  for (const [productoId, g] of acc) {
    const fcPromedio = g.cantidad > 0 ? g.valorUSD.dividedBy(g.cantidad) : new Prisma.Decimal(0);
    grupos.push({
      productoId,
      cantidad: g.cantidad,
      fcPromedio,
      itemContenedorId: g.itemIds.length === 1 ? g.itemIds[0]! : null,
    });
  }
  return grupos;
}

interface RespuestaIdempotente {
  desconsolidacionId: string;
  divergencia: boolean;
  asientoId: string | null;
}

async function registrarIdempotencia(
  t: TxClient,
  key: string | undefined,
  response: RespuestaIdempotente,
): Promise<void> {
  if (!key) return;
  await t.idempotencyKey.create({
    data: {
      key,
      response: response as unknown as Prisma.InputJsonValue,
      expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
    },
  });
}

/** Reconstruye el resultado en un replay idempotente desde el registro previo. */
async function recargarResultado(
  t: TxClient,
  contenedorId: string,
  response: Prisma.JsonValue,
): Promise<DesconsolidacionResult> {
  const data = response as unknown as RespuestaIdempotente;
  const desconsolidacion = await t.desconsolidacion.findUniqueOrThrow({
    where: { id: data.desconsolidacionId },
  });
  const contenedor = await t.contenedor.findUniqueOrThrow({ where: { id: contenedorId } });
  const items = await t.itemContenedor.findMany({ where: { contenedorId } });
  const diffs: DesconsolidacionDiff[] = items.map((it) => ({
    itemContenedorId: it.id,
    productoId: it.productoId,
    cantidadDeclarada: it.cantidadDeclarada,
    cantidadFisica: it.cantidadFisica ?? it.cantidadDeclarada,
    diferencia: (it.cantidadFisica ?? it.cantidadDeclarada) - it.cantidadDeclarada,
  }));
  const asiento = data.asientoId
    ? await t.asiento.findUnique({ where: { id: data.asientoId } })
    : null;
  return { desconsolidacion, contenedor, divergencia: data.divergencia, asiento, diffs };
}
