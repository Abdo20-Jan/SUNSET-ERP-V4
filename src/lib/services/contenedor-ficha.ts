import "server-only";

import { type ContenedorEstado, type DespachoEstado, Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { isContenedorDesconsolidacionEnabled } from "@/lib/features";

/**
 * Proyección de SÓLO LECTURA de la FICHA de un contenedor (PR-024b / CX-04).
 *
 * DISPLAY de campos EXISTENTES + relaciones (packing list por SKU, despachos que
 * consumieron el contenedor, docs de la desconsolidación). NO llama ni recalcula
 * el motor (desconsolidación/counters/lock/rateio): los counters se LEEN. El costo
 * (`costoFCUnitario`) se consulta en una query SEPARADA y SÓLO con `verCosto`
 * (gate `VER_COSTO_LANDED`) — sin permiso NO se selecciona server-side y viaja
 * como `null` (anti-leak, spec §9-estrutural 8). Con la flag apagada devuelve null.
 */

type DbClient = Prisma.TransactionClient;

export type ContenedorFichaItem = {
  id: number;
  productoCodigo: string;
  productoNombre: string;
  cantidadDeclarada: number;
  cantidadFisica: number | null;
  cantidadDisponible: number;
  cantidadEnDespacho: number;
  cantidadDespachada: number;
  /** física − declarada (null si aún no hay conferencia física). */
  divergencia: number | null;
  /** Costo FC unitario (USD). `null` sin `VER_COSTO_LANDED`. */
  costoFCUnitario: string | null;
};

export type ContenedorFichaDespacho = {
  despachoId: string;
  embarqueId: string;
  numeroOM: string | null;
  estado: DespachoEstado;
  /** Σ cantidad consumida de ESTE contenedor por ese despacho. */
  cantidad: number;
};

export type ContenedorFicha = {
  id: string;
  numeroContenedor: string;
  tipo: string | null;
  numeroBL: string | null;
  numeroHBL: string | null;
  estado: ContenedorEstado;
  embarqueId: string;
  embarqueCodigo: string;
  proveedorNombre: string;
  depositoZonaPrimaria: string | null;
  depositoFiscal: string | null;
  depositoDestino: string | null;
  fechaSalidaOrigen: string | null;
  fechaLlegadaPuerto: string | null;
  fechaIngresoZpa: string | null;
  fechaTrasladoDF: string | null;
  fechaDesconsolidacion: string | null;
  pesoBrutoKg: string | null;
  pesoNetoKg: string | null;
  volumenM3: string | null;
  observaciones: string | null;
  updatedAt: string;
  items: ContenedorFichaItem[];
  despachos: ContenedorFichaDespacho[];
  /** Docs/fotos cargados por la desconsolidación (display de URLs existentes). */
  documentos: { documentosUrls: string[]; fotosUrls: string[] } | null;
  /** Σ costoFCUnitario × cantidadDeclarada (USD). `null` sin `VER_COSTO_LANDED`. */
  costoFCTotal: string | null;
};

// Narrow select: SIN `costoFCUnitario` (se consulta aparte y sólo con permiso).
const fichaSelect = {
  id: true,
  numeroContenedor: true,
  tipo: true,
  numeroBL: true,
  numeroHBL: true,
  estado: true,
  fechaSalidaOrigen: true,
  fechaLlegadaPuerto: true,
  fechaIngresoZpa: true,
  fechaTrasladoDF: true,
  fechaDesconsolidacion: true,
  pesoBrutoKg: true,
  pesoNetoKg: true,
  volumenM3: true,
  observaciones: true,
  updatedAt: true,
  embarqueId: true,
  embarque: { select: { codigo: true, proveedor: { select: { nombre: true } } } },
  depositoZonaPrimaria: { select: { nombre: true } },
  depositoFiscal: { select: { nombre: true } },
  depositoDestino: { select: { nombre: true } },
  desconsolidacion: { select: { documentosUrls: true, fotosUrls: true } },
  items: {
    orderBy: { id: "asc" },
    select: {
      id: true,
      cantidadDeclarada: true,
      cantidadFisica: true,
      cantidadDisponible: true,
      cantidadEnDespacho: true,
      cantidadDespachada: true,
      producto: { select: { codigo: true, nombre: true } },
    },
  },
  itemsDespacho: {
    select: {
      cantidad: true,
      despacho: { select: { id: true, embarqueId: true, numeroOM: true, estado: true } },
    },
  },
} satisfies Prisma.ContenedorSelect;

type FichaRecord = Prisma.ContenedorGetPayload<{ select: typeof fichaSelect }>;

function fechaIso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

function decStr(d: Prisma.Decimal | null): string | null {
  return d == null ? null : d.toString();
}

/** Agrupa `itemsDespacho` por despacho (Σ cantidad) → filas de la aba Despachos. */
function agruparDespachos(itemsDespacho: FichaRecord["itemsDespacho"]): ContenedorFichaDespacho[] {
  const porDespacho = new Map<string, ContenedorFichaDespacho>();
  for (const it of itemsDespacho) {
    const d = it.despacho;
    const prev = porDespacho.get(d.id);
    if (prev) {
      prev.cantidad += it.cantidad;
      continue;
    }
    porDespacho.set(d.id, {
      despachoId: d.id,
      embarqueId: d.embarqueId,
      numeroOM: d.numeroOM,
      estado: d.estado,
      cantidad: it.cantidad,
    });
  }
  return Array.from(porDespacho.values());
}

/** Costo FC por ítem (USD) — SÓLO con permiso. Query separada anti-leak. */
async function costoFCPorItem(
  client: DbClient,
  contenedorId: string,
): Promise<Map<number, string>> {
  const items = await client.itemContenedor.findMany({
    where: { contenedorId },
    select: { id: true, costoFCUnitario: true },
  });
  const out = new Map<number, string>();
  for (const it of items) {
    if (it.costoFCUnitario != null) out.set(it.id, it.costoFCUnitario.toString());
  }
  return out;
}

function mapItem(
  it: FichaRecord["items"][number],
  costoFCUnitario: string | null,
): ContenedorFichaItem {
  return {
    id: it.id,
    productoCodigo: it.producto.codigo,
    productoNombre: it.producto.nombre,
    cantidadDeclarada: it.cantidadDeclarada,
    cantidadFisica: it.cantidadFisica,
    cantidadDisponible: it.cantidadDisponible,
    cantidadEnDespacho: it.cantidadEnDespacho,
    cantidadDespachada: it.cantidadDespachada,
    divergencia: it.cantidadFisica == null ? null : it.cantidadFisica - it.cantidadDeclarada,
    costoFCUnitario,
  };
}

/** Σ costoFCUnitario × cantidadDeclarada (USD) a partir de valores almacenados. */
function totalFC(items: ContenedorFichaItem[], costoById: Map<number, string>): string | null {
  if (costoById.size === 0) return null;
  let acc = new Prisma.Decimal(0);
  for (const it of items) {
    const costo = costoById.get(it.id);
    if (costo == null) continue;
    acc = acc.add(new Prisma.Decimal(costo).mul(it.cantidadDeclarada));
  }
  return acc.toFixed(2);
}

export async function obtenerContenedorFicha(
  id: string,
  verCosto: boolean,
  tx?: DbClient,
): Promise<ContenedorFicha | null> {
  // Inercia total con la flag apagada (defensa en profundidad + gate de la page).
  if (!isContenedorDesconsolidacionEnabled()) return null;

  const client: DbClient = tx ?? db;
  const c = await client.contenedor.findUnique({ where: { id }, select: fichaSelect });
  if (!c) return null;

  const costoById = verCosto ? await costoFCPorItem(client, id) : new Map<number, string>();
  const items = c.items.map((it) => mapItem(it, verCosto ? (costoById.get(it.id) ?? null) : null));

  return {
    id: c.id,
    numeroContenedor: c.numeroContenedor,
    tipo: c.tipo,
    numeroBL: c.numeroBL,
    numeroHBL: c.numeroHBL,
    estado: c.estado,
    embarqueId: c.embarqueId,
    embarqueCodigo: c.embarque.codigo,
    proveedorNombre: c.embarque.proveedor.nombre,
    depositoZonaPrimaria: c.depositoZonaPrimaria?.nombre ?? null,
    depositoFiscal: c.depositoFiscal?.nombre ?? null,
    depositoDestino: c.depositoDestino?.nombre ?? null,
    fechaSalidaOrigen: fechaIso(c.fechaSalidaOrigen),
    fechaLlegadaPuerto: fechaIso(c.fechaLlegadaPuerto),
    fechaIngresoZpa: fechaIso(c.fechaIngresoZpa),
    fechaTrasladoDF: fechaIso(c.fechaTrasladoDF),
    fechaDesconsolidacion: fechaIso(c.fechaDesconsolidacion),
    pesoBrutoKg: decStr(c.pesoBrutoKg),
    pesoNetoKg: decStr(c.pesoNetoKg),
    volumenM3: decStr(c.volumenM3),
    observaciones: c.observaciones,
    updatedAt: c.updatedAt.toISOString(),
    items,
    despachos: agruparDespachos(c.itemsDespacho),
    documentos: c.desconsolidacion
      ? {
          documentosUrls: c.desconsolidacion.documentosUrls,
          fotosUrls: c.desconsolidacion.fotosUrls,
        }
      : null,
    costoFCTotal: verCosto ? totalFC(items, costoById) : null,
  };
}
