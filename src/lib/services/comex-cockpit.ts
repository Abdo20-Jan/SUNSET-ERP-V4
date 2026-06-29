/**
 * Servicio de agregación READ-ONLY del Cockpit Operacional Comex (PR-022 / CX-01).
 *
 * EXTENSIÓN ADITIVA y de SÓLO LECTURA: deriva los 4 indicadores y los 6 bloques
 * de pendencias a partir de campos ARMAZENADOS (Embarque / EmbarqueCosto /
 * Contenedor) + las derivaciones PURAS existentes. NUNCA importa ni llama al
 * motor de rateio/CIF/tributos (`services/comex.ts`) — NADA se recalcula
 * (CRIT-04..09 / G-09). No escribe, no transacciona.
 *
 * Strip server-side (CRIT-10): los valores financieros (FOB/CFR, cash-out) sólo
 * se emiten cuando `verCosto` (VER_COSTO_LANDED) pasa; si falla, los campos van
 * `null` y la sección `financeiro` se OMITE del payload — el costo NUNCA viaja
 * al cliente. El `select` es estrecho: nunca trae columnas monetarias de
 * `EmbarqueCosto` (iva/iibb/otros) ni `costoTotal` (anti-leak).
 *
 * Universo de scope = embarques no CERRADO (procesos abiertos); sumas/conteos
 * son exactos sobre ese universo, las listas se recortan a BLOQUE_LIMIT filas.
 */

import "server-only";

import { db } from "@/lib/db";
import { sumMoney } from "@/lib/decimal";
import { maskField } from "@/lib/permisos-masking";
import {
  type ProveedorExteriorSaldo,
  getSaldosExteriorPorProveedor,
} from "@/lib/services/cuentas-a-pagar";
import {
  bandDiasSinActualizacion,
  type BandaActualizacion,
  clasificarSeveridad,
  diasSinActualizacion,
  proximaAccionPorEstado,
} from "@/lib/services/comex-cockpit-derivaciones";
import {
  type CostoLite,
  deriveBloqueo,
  deriveEtaTono,
  deriveStatusCosto,
  deriveStatusPago,
  type EtaTono,
  fobEnUsd,
  resolverVistaFiltro,
  type StatusCostoUi,
  type StatusPagoUi,
} from "@/lib/services/comex-worklist-derivaciones";
import {
  type ContenedorEstado,
  EmbarqueEstado,
  type Moneda,
  type Prisma,
} from "@/generated/prisma/client";

const MS_DIA = 86_400_000;
const BLOQUE_LIMIT = 8;
const PAGO_EXTERIOR_DIAS = 30;

const CONTENEDOR_TRANSITO: ReadonlySet<ContenedorEstado> = new Set<ContenedorEstado>([
  "EN_TRANSITO",
  "ARRIBADO_PUERTO",
]);

// ── Tipos del payload (cada clave top-level = sección nombrada OD-08) ────────

/** Referencia mínima de proceso para el drill-down a la ficha del embarque. */
export type CockpitProcesoRef = {
  id: string;
  codigo: string;
  proveedorNombre: string;
  estado: EmbarqueEstado;
};

export type ProcesoCriticoItem = CockpitProcesoRef & {
  motivo: string;
  proximaAccion: string;
};

export type ArriboItem = CockpitProcesoRef & {
  fechaLlegada: string;
  etaTono: EtaTono;
  /** USD; `null` cuando falta VER_COSTO_LANDED (arribos "sin valores"). */
  fobUsd: string | null;
  proximaAccion: string;
};

export type SinActualizacionItem = CockpitProcesoRef & {
  updatedAt: string;
  dias: number;
  banda: BandaActualizacion;
  proximaAccion: string;
};

export type CostoPendienteItem = CockpitProcesoRef & {
  statusCosto: StatusCostoUi;
};

export type DocumentoProxyItem = CockpitProcesoRef & {
  /** Proxy honesto: contenedores con BL ausente (no hay modelo de documentos). */
  contenedoresSinBL: number;
};

export type PagoExteriorItem = {
  embarqueId: string | null;
  embarqueCodigo: string | null;
  proveedorNombre: string;
  saldoUsd: string;
  fechaVencimiento: string;
};

export type CockpitIndicadores = {
  contenedoresEnTransito: number;
  /** FOB de procesos con contenedor en tránsito; `null` sin permiso. */
  contenedoresTransitoFobUsd: string | null;
  fobCfrAbiertoUsd: string | null;
  cashOut30dUsd: string | null;
  alertasCriticos: number;
};

export type CockpitOperacion = {
  procesosCriticos: ProcesoCriticoItem[];
  proximosArribos: ArriboItem[];
  sinActualizacion: SinActualizacionItem[];
};

export type CockpitFinanceiro = {
  pagosExteriores: PagoExteriorItem[];
  /** Facturas exteriores sin fecha de vencimiento (deuda FOB virtual). */
  sinFechaCount: number;
};

export type CockpitData = {
  indicadores: CockpitIndicadores;
  operacion: CockpitOperacion;
  documentos: DocumentoProxyItem[];
  custos: CostoPendienteItem[];
  /** `null` cuando falta VER_COSTO_LANDED (sección Financeiro OMITIDA). */
  financeiro: CockpitFinanceiro | null;
};

// ── Lectura batched (1 query de embarques + 1 de saldos exterior) ────────────

const EMBARQUE_COCKPIT_SELECT = {
  id: true,
  codigo: true,
  estado: true,
  moneda: true,
  tipoCambio: true,
  fobTotal: true,
  fechaLlegada: true,
  updatedAt: true,
  proveedor: { select: { nombre: true } },
  contenedores: { select: { estado: true, numeroBL: true } },
  // Narrow: SÓLO señales operativas (estado/venc). Nunca columnas monetarias
  // de EmbarqueCosto — romperían el anti-leak del gate de costo.
  costos: { select: { estado: true, fechaVencimiento: true } },
} satisfies Prisma.EmbarqueSelect;

type EmbarqueCockpitRecord = Prisma.EmbarqueGetPayload<{ select: typeof EMBARQUE_COCKPIT_SELECT }>;

/** Proyección enriquecida (una pasada de derivaciones puras por embarque). */
type Enriched = {
  ref: CockpitProcesoRef;
  fechaLlegada: Date | null;
  updatedAt: Date;
  fobUsd: string;
  etaTono: EtaTono;
  bloqueo: string | null;
  statusPago: StatusPagoUi | null;
  statusCosto: StatusCostoUi;
  contenedoresEnTransito: number;
  contenedoresSinBL: number;
};

function enrich(e: EmbarqueCockpitRecord, now: Date): Enriched {
  const costosLite: CostoLite[] = e.costos.map((c) => ({
    estado: c.estado,
    fechaVencimiento: c.fechaVencimiento,
  }));
  const activos = e.contenedores.filter((c) => c.estado !== "CANCELADO");
  return {
    ref: { id: e.id, codigo: e.codigo, proveedorNombre: e.proveedor.nombre, estado: e.estado },
    fechaLlegada: e.fechaLlegada,
    updatedAt: e.updatedAt,
    fobUsd: fobEnUsd(e.fobTotal.toString(), e.moneda as Moneda, e.tipoCambio.toString()),
    etaTono: deriveEtaTono(e.fechaLlegada, e.estado, now),
    bloqueo: deriveBloqueo(costosLite, now),
    statusPago: deriveStatusPago(costosLite, now),
    statusCosto: deriveStatusCosto(costosLite, e.estado),
    contenedoresEnTransito: activos.filter((c) => CONTENEDOR_TRANSITO.has(c.estado)).length,
    contenedoresSinBL: activos.filter((c) => c.numeroBL == null).length,
  };
}

// ── Ordenamientos ────────────────────────────────────────────────────────────

function etaSortKey(e: Enriched): number {
  return e.fechaLlegada ? e.fechaLlegada.getTime() : Number.POSITIVE_INFINITY;
}

function porEtaAsc(a: Enriched, b: Enriched): number {
  return etaSortKey(a) - etaSortKey(b);
}

// ── Mappers por bloque (1 por sección → complejidad ciclomática baja) ────────

function motivoCritico(e: Enriched): string {
  const partes: string[] = [];
  if (e.bloqueo) partes.push(e.bloqueo);
  if (e.etaTono === "overdue") partes.push("ETA vencida");
  return partes.join(" · ") || "Crítico";
}

function filtrarCriticos(enriched: Enriched[]): Enriched[] {
  return enriched
    .filter((e) => clasificarSeveridad({ bloqueo: e.bloqueo, etaTono: e.etaTono }) === "critico")
    .sort(porEtaAsc);
}

function toProcesoCriticoItem(e: Enriched): ProcesoCriticoItem {
  return {
    ...e.ref,
    motivo: motivoCritico(e),
    proximaAccion: proximaAccionPorEstado(e.ref.estado),
  };
}

function mapProximosArribos(enriched: Enriched[], now: Date, verCosto: boolean): ArriboItem[] {
  const { etaHasta } = resolverVistaFiltro("proximos", now);
  const limite = etaHasta ? etaHasta.getTime() : now.getTime() + 15 * MS_DIA;
  return enriched
    .filter((e) => e.fechaLlegada != null && e.fechaLlegada.getTime() <= limite)
    .sort(porEtaAsc)
    .slice(0, BLOQUE_LIMIT)
    .map((e) => ({
      ...e.ref,
      fechaLlegada: (e.fechaLlegada as Date).toISOString(),
      etaTono: e.etaTono,
      fobUsd: maskField(verCosto, e.fobUsd),
      proximaAccion: proximaAccionPorEstado(e.ref.estado),
    }));
}

function mapSinActualizacion(enriched: Enriched[], now: Date): SinActualizacionItem[] {
  return enriched
    .filter((e) => bandDiasSinActualizacion(e.updatedAt, now) !== "fresca")
    .sort((a, b) => diasSinActualizacion(b.updatedAt, now) - diasSinActualizacion(a.updatedAt, now))
    .slice(0, BLOQUE_LIMIT)
    .map((e) => ({
      ...e.ref,
      updatedAt: e.updatedAt.toISOString(),
      dias: diasSinActualizacion(e.updatedAt, now),
      banda: bandDiasSinActualizacion(e.updatedAt, now),
      proximaAccion: proximaAccionPorEstado(e.ref.estado),
    }));
}

const COSTO_PENDIENTE_RANK: Record<string, number> = { Provisionado: 0, Estimado: 1 };

function mapCostosPendientes(enriched: Enriched[]): CostoPendienteItem[] {
  return enriched
    .filter((e) => e.statusCosto === "Estimado" || e.statusCosto === "Provisionado")
    .sort((a, b) => COSTO_PENDIENTE_RANK[a.statusCosto] - COSTO_PENDIENTE_RANK[b.statusCosto])
    .slice(0, BLOQUE_LIMIT)
    .map((e) => ({ ...e.ref, statusCosto: e.statusCosto }));
}

function mapDocumentosProxy(enriched: Enriched[]): DocumentoProxyItem[] {
  return enriched
    .filter((e) => e.contenedoresSinBL > 0)
    .sort((a, b) => b.contenedoresSinBL - a.contenedoresSinBL)
    .slice(0, BLOQUE_LIMIT)
    .map((e) => ({ ...e.ref, contenedoresSinBL: e.contenedoresSinBL }));
}

function mapIndicadores(
  enriched: Enriched[],
  cashOut30dUsd: string,
  alertasCriticos: number,
  verCosto: boolean,
): CockpitIndicadores {
  const contenedoresEnTransito = enriched.reduce((s, e) => s + e.contenedoresEnTransito, 0);
  const fobTransito = sumMoney(
    enriched.filter((e) => e.contenedoresEnTransito > 0).map((e) => e.fobUsd),
  ).toString();
  const fobAbierto = sumMoney(enriched.map((e) => e.fobUsd)).toString();
  return {
    contenedoresEnTransito,
    contenedoresTransitoFobUsd: maskField(verCosto, fobTransito),
    fobCfrAbiertoUsd: maskField(verCosto, fobAbierto),
    cashOut30dUsd: maskField(verCosto, cashOut30dUsd),
    alertasCriticos,
  };
}

// ── Pagos exteriores (deriva de getSaldosExteriorPorProveedor; sin recompute) ─

type FacturaConContexto = {
  saldoUsd: string;
  fechaVencimiento: string | null;
  embarqueId: string | null;
  embarqueCodigo: string | null;
  proveedorNombre: string;
};

function aplanarFacturasExterior(saldos: ProveedorExteriorSaldo[]): FacturaConContexto[] {
  const out: FacturaConContexto[] = [];
  for (const p of saldos) {
    for (const emb of p.embarques) {
      for (const f of emb.facturas) {
        out.push({
          saldoUsd: f.saldoUsd,
          fechaVencimiento: f.fechaVencimiento,
          embarqueId: emb.embarqueId,
          embarqueCodigo: emb.embarqueCodigo,
          proveedorNombre: p.proveedorNombre,
        });
      }
    }
    for (const f of p.facturasSueltas) {
      out.push({
        saldoUsd: f.saldoUsd,
        fechaVencimiento: f.fechaVencimiento,
        embarqueId: null,
        embarqueCodigo: null,
        proveedorNombre: p.proveedorNombre,
      });
    }
  }
  return out;
}

function vencHasta(iso: string, hastaMs: number): boolean {
  const t = new Date(iso).getTime();
  return !Number.isNaN(t) && t <= hastaMs;
}

function mapPagosExteriores(
  saldos: ProveedorExteriorSaldo[],
  now: Date,
): { items: PagoExteriorItem[]; cashOut30dUsd: string; sinFechaCount: number } {
  const hastaMs = now.getTime() + PAGO_EXTERIOR_DIAS * MS_DIA;
  const planas = aplanarFacturasExterior(saldos);
  const sinFechaCount = planas.filter((x) => x.fechaVencimiento == null).length;
  const items = planas
    .filter((x) => x.fechaVencimiento != null && vencHasta(x.fechaVencimiento, hastaMs))
    .map((x) => ({
      embarqueId: x.embarqueId,
      embarqueCodigo: x.embarqueCodigo,
      proveedorNombre: x.proveedorNombre,
      saldoUsd: x.saldoUsd,
      fechaVencimiento: x.fechaVencimiento as string,
    }))
    .sort((a, b) => a.fechaVencimiento.localeCompare(b.fechaVencimiento));
  const cashOut30dUsd = sumMoney(items.map((i) => i.saldoUsd)).toString();
  return { items: items.slice(0, BLOQUE_LIMIT), cashOut30dUsd, sinFechaCount };
}

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * Agrega el cockpit completo (4 indicadores + 6 bloques) en sólo dos round-trips
 * (embarques abiertos + saldos exterior), todo derivado en memoria. `now`
 * inyectado por el caller (page). `verCosto` resuelto por el caller con
 * `hasPermission(VER_COSTO_LANDED)`: gobierna el strip de TODO valor financiero.
 */
export async function getCockpitData(opts: { now: Date; verCosto: boolean }): Promise<CockpitData> {
  const { now, verCosto } = opts;
  const [embarques, saldos] = await Promise.all([
    db.embarque.findMany({
      where: { estado: { not: EmbarqueEstado.CERRADO } },
      orderBy: { fechaLlegada: "asc" },
      select: EMBARQUE_COCKPIT_SELECT,
    }),
    getSaldosExteriorPorProveedor(),
  ]);

  const enriched = embarques.map((e) => enrich(e, now));
  const criticos = filtrarCriticos(enriched);
  const { items: pagosExteriores, cashOut30dUsd, sinFechaCount } = mapPagosExteriores(saldos, now);

  return {
    indicadores: mapIndicadores(enriched, cashOut30dUsd, criticos.length, verCosto),
    operacion: {
      procesosCriticos: criticos.slice(0, BLOQUE_LIMIT).map(toProcesoCriticoItem),
      proximosArribos: mapProximosArribos(enriched, now, verCosto),
      sinActualizacion: mapSinActualizacion(enriched, now),
    },
    documentos: mapDocumentosProxy(enriched),
    custos: mapCostosPendientes(enriched),
    financeiro: verCosto ? { pagosExteriores, sinFechaCount } : null,
  };
}
