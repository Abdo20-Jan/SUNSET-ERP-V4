/**
 * Calendario operacional semanal del Cockpit Comex (PR-022c / CX-01 §9-estrutural 5).
 *
 * Helpers PUROS (sin I/O, sin `server-only`): los importa el read server-side
 * (`comex-cockpit.ts`) y son unit-testables con fixtures planas. Reciben `now`
 * INYECTADO (nunca `Date.now()` interno) → deterministas y sin mismatch de
 * hidratación. El bucketing de día es en **UTC** (igual que `fmtDate`).
 *
 * ⚠️ READ-ONLY puro: los eventos derivan SÓLO de campos de fecha ARMAZENADOS
 * (Embarque / Contenedor / EmbarqueCosto / Despacho). NADA se computa, el motor
 * de rateio/costo (`services/comex.ts`) NUNCA se llama (CRIT-04..09 / G-09). El
 * payload del evento NO lleva ningún valor monetario (id/código/proveedor/tipo/
 * fecha/tab) — el calendario es date/event-based y no expone costo/margen.
 *
 * Tipos OMITIDOS (no falseados): «retirada» (sin campo en el schema) y
 * `Contenedor.fechaSalidaOrigen`/`fechaLlegadaPuerto` (duplicarían embarcado/
 * arribo de nivel Embarque) y `EmbarqueCosto.fechaFactura` (el evento de pago es
 * el vencimiento, no la factura).
 */

const MS_DIA = 86_400_000;
const MS_SEMANA = 7 * MS_DIA;

/** Mínimo de semanas visibles (§9: "4 semanas visíveis"). */
const SEMANAS_VISIBLES = 4;
/** Tope de semanas hacia atrás desde la semana actual (acota el grid). */
const SEMANAS_ATRAS_MAX = 8;
/** Tope total de semanas renderizadas (resto → `fueraDeVentana`, footnote honesto). */
const SEMANAS_TOTAL_MAX = 26;

export type CalendarioEventoTipo =
  | "empaque"
  | "embarcado"
  | "transbordo"
  | "arribo"
  | "ingreso-zpa"
  | "traslado-df"
  | "desconsolidacion"
  | "nacionalizacion"
  | "despacho"
  | "pago-exterior";

/** Aba del record (CX-03) a la que apunta el drill-down del evento. */
export type CalendarioEventoTab = "operacion" | "aduana" | "finanzas";

/**
 * Forma estructural de entrada (desacoplada de Prisma → testable con fixtures).
 * El payload ancho de `EMBARQUE_COCKPIT_SELECT` (sólo campos de fecha + escalares
 * no-monetarios) lo satisface estructuralmente.
 */
export type ProcesoCalendarioFuente = {
  id: string;
  codigo: string;
  proveedor: { nombre: string };
  fechaEmpaque: Date | null;
  fechaSalida: Date | null;
  fechaTransbordo: Date | null;
  fechaLlegada: Date | null;
  fechaZonaPrimaria: Date | null;
  fechaCierre: Date | null;
  contenedores: { fechaTrasladoDF: Date | null; fechaDesconsolidacion: Date | null }[];
  costos: { fechaVencimiento: Date | null }[];
  despachos: { fecha: Date | null }[];
};

/** Evento serializable enviado al cliente — SIN ningún valor monetario. */
export type CalendarioEvento = {
  embarqueId: string;
  codigo: string;
  proveedorNombre: string;
  tipo: CalendarioEventoTipo;
  /** ISO completo (UTC) del evento — para orden y tooltip. */
  fechaISO: string;
  tab: CalendarioEventoTab;
};

export type DiaCalendario = {
  /** Clave de día UTC `yyyy-mm-dd`. */
  diaISO: string;
  /** Día del mes (1-31) para el header de la celda. */
  dia: number;
  /** `true` si la celda cae en `now` (UTC). */
  esHoy: boolean;
  eventos: CalendarioEvento[];
};

export type SemanaCalendario = {
  /** `diaISO` del lunes de la semana. */
  inicioISO: string;
  /** 7 celdas, lunes→domingo. */
  dias: DiaCalendario[];
};

export type CalendarioData = {
  semanas: SemanaCalendario[];
  totalEventos: number;
  /** Eventos fuera de la ventana renderizada (footnote honesto, no se ocultan en silencio). */
  fueraDeVentana: number;
};

// ── Utilidades de fecha (todo en UTC para casar con `fmtDate`) ────────────────

function diaISOdeUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fechaDeDiaISO(diaISO: string): Date {
  return new Date(`${diaISO}T00:00:00.000Z`);
}

function addDiasUTC(d: Date, n: number): Date {
  return new Date(d.getTime() + n * MS_DIA);
}

/** Lunes (UTC, medianoche) de la semana que contiene `d`. */
function lunesUTC(d: Date): Date {
  const base = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const desdeLunes = (base.getUTCDay() + 6) % 7; // 0=lunes … 6=domingo
  return addDiasUTC(base, -desdeLunes);
}

// ── Tagging: 1 evento por campo de fecha ARMAZENADO no nulo ───────────────────

/** Mapeo de las fechas a nivel Embarque → tipo + aba destino. */
const EVENTOS_EMBARQUE: {
  get: (p: ProcesoCalendarioFuente) => Date | null;
  tipo: CalendarioEventoTipo;
  tab: CalendarioEventoTab;
}[] = [
  { get: (p) => p.fechaEmpaque, tipo: "empaque", tab: "operacion" },
  { get: (p) => p.fechaSalida, tipo: "embarcado", tab: "operacion" },
  { get: (p) => p.fechaTransbordo, tipo: "transbordo", tab: "operacion" },
  { get: (p) => p.fechaLlegada, tipo: "arribo", tab: "operacion" },
  { get: (p) => p.fechaZonaPrimaria, tipo: "ingreso-zpa", tab: "operacion" },
  { get: (p) => p.fechaCierre, tipo: "nacionalizacion", tab: "finanzas" },
];

function nuevoEvento(
  p: ProcesoCalendarioFuente,
  fecha: Date,
  tipo: CalendarioEventoTipo,
  tab: CalendarioEventoTab,
): CalendarioEvento {
  return {
    embarqueId: p.id,
    codigo: p.codigo,
    proveedorNombre: p.proveedor.nombre,
    tipo,
    fechaISO: fecha.toISOString(),
    tab,
  };
}

/** Fechas no nulas, de-duplicadas por DÍA (evita N íconos idénticos del mismo proceso). */
function fechasUnicasPorDia(fechas: (Date | null)[]): Date[] {
  const vistos = new Map<string, Date>();
  for (const f of fechas) {
    if (f) vistos.set(diaISOdeUTC(f), f);
  }
  return [...vistos.values()];
}

/** Eventos de UN proceso: fechas de nivel Embarque + las de arrays (contenedor/despacho/costo). */
export function tagEventosDeProceso(p: ProcesoCalendarioFuente): CalendarioEvento[] {
  const out: CalendarioEvento[] = [];
  for (const def of EVENTOS_EMBARQUE) {
    const fecha = def.get(p);
    if (fecha) out.push(nuevoEvento(p, fecha, def.tipo, def.tab));
  }
  const traslados = fechasUnicasPorDia(p.contenedores.map((c) => c.fechaTrasladoDF));
  for (const f of traslados) out.push(nuevoEvento(p, f, "traslado-df", "operacion"));
  const descons = fechasUnicasPorDia(p.contenedores.map((c) => c.fechaDesconsolidacion));
  for (const f of descons) out.push(nuevoEvento(p, f, "desconsolidacion", "operacion"));
  const despachos = fechasUnicasPorDia(p.despachos.map((d) => d.fecha));
  for (const f of despachos) out.push(nuevoEvento(p, f, "despacho", "aduana"));
  const pagos = fechasUnicasPorDia(p.costos.map((c) => c.fechaVencimiento));
  for (const f of pagos) out.push(nuevoEvento(p, f, "pago-exterior", "finanzas"));
  return out;
}

// ── Agrupamiento por día + grilla de semanas ──────────────────────────────────

export function agruparEventosPorDia(eventos: CalendarioEvento[]): Map<string, CalendarioEvento[]> {
  const map = new Map<string, CalendarioEvento[]>();
  for (const ev of eventos) {
    const key = ev.fechaISO.slice(0, 10);
    const lista = map.get(key);
    if (lista) lista.push(ev);
    else map.set(key, [ev]);
  }
  return map;
}

/** Rango de semanas: cubre la semana actual + los eventos, acotado por los topes. */
function rangoSemanas(diaKeys: string[], now: Date): { inicio: Date; total: number } {
  const lunesHoy = lunesUTC(now).getTime();
  const lunesEventos = diaKeys.map((k) => lunesUTC(fechaDeDiaISO(k)).getTime());
  const minEvento = lunesEventos.length ? Math.min(...lunesEventos) : lunesHoy;
  const maxEvento = lunesEventos.length ? Math.max(...lunesEventos) : lunesHoy;
  const atrasMin = lunesHoy - SEMANAS_ATRAS_MAX * MS_SEMANA;
  const inicioMs = Math.max(atrasMin, Math.min(lunesHoy, minEvento));
  const finForzado = lunesHoy + (SEMANAS_VISIBLES - 1) * MS_SEMANA;
  const finMs = Math.max(finForzado, maxEvento);
  const totalBruto = Math.round((finMs - inicioMs) / MS_SEMANA) + 1;
  const total = Math.min(SEMANAS_TOTAL_MAX, Math.max(SEMANAS_VISIBLES, totalBruto));
  return { inicio: new Date(inicioMs), total };
}

function construirSemanas(
  porDia: Map<string, CalendarioEvento[]>,
  now: Date,
): { semanas: SemanaCalendario[]; enVentana: number } {
  const { inicio, total } = rangoSemanas([...porDia.keys()], now);
  const hoyISO = diaISOdeUTC(now);
  const semanas: SemanaCalendario[] = [];
  let enVentana = 0;
  for (let w = 0; w < total; w++) {
    const lunes = addDiasUTC(inicio, w * 7);
    const dias: DiaCalendario[] = [];
    for (let d = 0; d < 7; d++) {
      const fecha = addDiasUTC(lunes, d);
      const diaISO = diaISOdeUTC(fecha);
      const eventos = porDia.get(diaISO) ?? [];
      enVentana += eventos.length;
      dias.push({ diaISO, dia: fecha.getUTCDate(), esHoy: diaISO === hoyISO, eventos });
    }
    semanas.push({ inicioISO: diaISOdeUTC(lunes), dias });
  }
  return { semanas, enVentana };
}

/** Orquestador puro: procesos (ya filtrados) → eventos → grilla semanal. */
export function construirCalendario(
  procesos: ProcesoCalendarioFuente[],
  now: Date,
): CalendarioData {
  const eventos = procesos.flatMap(tagEventosDeProceso);
  const porDia = agruparEventosPorDia(eventos);
  const { semanas, enVentana } = construirSemanas(porDia, now);
  return {
    semanas,
    totalEventos: eventos.length,
    fueraDeVentana: eventos.length - enVentana,
  };
}
