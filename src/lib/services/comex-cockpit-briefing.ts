/**
 * Composición PURA del briefing diario del Cockpit Operacional Comex
 * (CX-01 §9-funcional 9 · PR-022d). Aplana el payload del cockpit
 * (`CockpitData`) en filas tabulares homogéneas (`BriefingRow`) para serializar
 * a CSV/XLSX desde la server action `exportarCockpitDia`.
 *
 * Sin I/O, sin `server-only`: helpers puros unit-testables con fixtures (igual
 * que `comex-cockpit-derivaciones`/`filtros`/`calendario`). SÓLO consume tipos
 * del cockpit vía `import type` (erasado en runtime → NO arrastra el módulo
 * `server-only` ni el motor de rateio). NADA se recalcula: los valores ya vienen
 * derivados y ENMASCARADOS server-side por `getCockpitData` (CRIT-10 / G-09).
 *
 * Strip de costo: cuando faltó `VER_COSTO_LANDED`, los campos USD del payload ya
 * llegan `null` (→ celda vacía) y la sección Financeiro viene `null` (→ sin filas
 * de Pago). El builder NUNCA reintroduce un valor enmascarado.
 *
 * El briefing reproduce las pendencias YA filtradas por `filtros` (PR-022b): el
 * `CockpitData` recibido proviene de `getCockpitData({ filtros })`, de modo que
 * las filas reflejan la vista/filtros de SERVIDOR (no la búsqueda rápida client).
 */

import type { ExportColumn } from "@/lib/export/types";
import type {
  ArriboItem,
  CockpitData,
  CostoPendienteItem,
  DocumentoProxyItem,
  ProcesoCriticoItem,
  SinActualizacionItem,
} from "@/lib/services/comex-cockpit";

/** Fila tabular homogénea del briefing (modelo plano `ExportColumn`). */
export type BriefingRow = {
  /** Sección OD-08 / bloque de origen (Indicador, Crítico, Arribo, …). */
  seccion: string;
  codigo: string;
  entidad: string;
  estado: string;
  fecha: string;
  detalle: string;
  alerta: string;
  /** USD; "" cuando el valor fue enmascarado server-side (sin VER_COSTO_LANDED). */
  valor: string;
};

/** Columnas del archivo (estáticas; el valor enmascarado ya viaja como ""). */
export const BRIEFING_COLUMNS: ExportColumn<BriefingRow>[] = [
  { header: "Sección", value: (r) => r.seccion },
  { header: "Código", value: (r) => r.codigo },
  { header: "Entidad", value: (r) => r.entidad },
  { header: "Estado", value: (r) => r.estado },
  { header: "Fecha", value: (r) => r.fecha },
  { header: "Detalle", value: (r) => r.detalle },
  { header: "Alerta", value: (r) => r.alerta },
  { header: "Valor (USD)", value: (r) => r.valor },
];

function fmtFecha(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

/** Construye una fila completando los campos no provistos con "". */
function fila(seccion: string, p: Partial<Omit<BriefingRow, "seccion">>): BriefingRow {
  return {
    seccion,
    codigo: p.codigo ?? "",
    entidad: p.entidad ?? "",
    estado: p.estado ?? "",
    fecha: p.fecha ?? "",
    detalle: p.detalle ?? "",
    alerta: p.alerta ?? "",
    valor: p.valor ?? "",
  };
}

/** 4 indicadores del topo (counts en `detalle`; USD gateado en `valor`). */
function filasIndicadores(d: CockpitData): BriefingRow[] {
  const i = d.indicadores;
  return [
    fila("Indicador", {
      codigo: "Containers en tránsito",
      detalle: `${i.contenedoresEnTransito} contenedores`,
      valor: i.contenedoresTransitoFobUsd ?? "",
    }),
    fila("Indicador", { codigo: "FOB/CFR abierto", valor: i.fobCfrAbiertoUsd ?? "" }),
    fila("Indicador", { codigo: "Cash-out proyectado 30d", valor: i.cashOut30dUsd ?? "" }),
    fila("Indicador", {
      codigo: "Alertas críticos",
      detalle: `${i.alertasCriticos} alertas`,
    }),
  ];
}

/** Procesos críticos = la faixa de alertas críticas (CX-01 §9-funcional). */
function filasCriticos(items: ProcesoCriticoItem[]): BriefingRow[] {
  return items.map((i) =>
    fila("Crítico", {
      codigo: i.codigo,
      entidad: i.proveedorNombre,
      estado: i.estado,
      detalle: i.proximaAccion,
      alerta: i.motivo,
    }),
  );
}

function tonoEta(t: ArriboItem["etaTono"]): string {
  if (t === "overdue") return "ETA vencida";
  if (t === "soon") return "ETA próxima";
  return "";
}

function filasArribos(items: ArriboItem[]): BriefingRow[] {
  return items.map((i) =>
    fila("Arribo", {
      codigo: i.codigo,
      entidad: i.proveedorNombre,
      estado: i.estado,
      fecha: fmtFecha(i.fechaLlegada),
      detalle: i.proximaAccion,
      alerta: tonoEta(i.etaTono),
      valor: i.fobUsd ?? "",
    }),
  );
}

function filasSinActualizacion(items: SinActualizacionItem[]): BriefingRow[] {
  return items.map((i) =>
    fila("Sin actualizar", {
      codigo: i.codigo,
      entidad: i.proveedorNombre,
      estado: i.estado,
      fecha: fmtFecha(i.updatedAt),
      detalle: i.proximaAccion,
      alerta: `${i.dias}d sin mover`,
    }),
  );
}

function filasDocumentos(items: DocumentoProxyItem[]): BriefingRow[] {
  return items.map((i) =>
    fila("Documento", {
      codigo: i.codigo,
      entidad: i.proveedorNombre,
      estado: i.estado,
      detalle: "Contenedores sin BL",
      alerta: `${i.contenedoresSinBL} sin BL`,
    }),
  );
}

function filasCostos(items: CostoPendienteItem[]): BriefingRow[] {
  return items.map((i) =>
    fila("Costo", {
      codigo: i.codigo,
      entidad: i.proveedorNombre,
      estado: i.estado,
      detalle: "Costo aún sin facturar",
      alerta: i.statusCosto,
    }),
  );
}

/** Pagos exteriores: SÓLO cuando la sección Financeiro NO fue omitida (con permiso). */
function filasPagos(d: CockpitData): BriefingRow[] {
  if (!d.financeiro) return [];
  return d.financeiro.pagosExteriores.map((i) =>
    fila("Pago", {
      codigo: i.embarqueCodigo ?? "—",
      entidad: i.proveedorNombre,
      fecha: fmtFecha(i.fechaVencimiento),
      detalle: "Pago exterior pendiente",
      valor: i.saldoUsd,
    }),
  );
}

/** Agenda del día = eventos del calendario que caen en `now` (celda `esHoy`). */
function filasAgenda(d: CockpitData): BriefingRow[] {
  const hoy = d.calendario.semanas.flatMap((s) => s.dias).find((dia) => dia.esHoy);
  if (!hoy) return [];
  return hoy.eventos.map((e) =>
    fila("Agenda", {
      codigo: e.codigo,
      entidad: e.proveedorNombre,
      fecha: fmtFecha(e.fechaISO),
      detalle: e.tipo,
    }),
  );
}

/**
 * Briefing diario completo: indicadores + pendencias activas + agenda del día +
 * alertas (= críticos). El orden refleja el layout del cockpit (CX-01 §9).
 */
export function construirBriefing(d: CockpitData): BriefingRow[] {
  return [
    ...filasIndicadores(d),
    ...filasCriticos(d.operacion.procesosCriticos),
    ...filasArribos(d.operacion.proximosArribos),
    ...filasSinActualizacion(d.operacion.sinActualizacion),
    ...filasDocumentos(d.documentos),
    ...filasCostos(d.custos),
    ...filasPagos(d),
    ...filasAgenda(d),
  ];
}
