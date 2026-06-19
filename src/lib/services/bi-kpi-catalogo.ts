/**
 * Catálogo de KPI versionado (registry puro). Fuente única de las definiciones
 * de indicadores del BI: etiqueta, unidad, descripción, fórmula legible y
 * dirección ideal. La UI lee de acá para no duplicar literales.
 *
 * Diseñado para crecer por olas (giro → liquidez → rentabilidad → valor): para
 * sumar un indicador se agrega una entrada acá y se conecta su cálculo. El test
 * de drift garantiza que cada indicador calculado tenga su definición.
 */

export const CATALOGO_KPI_VERSION = "2026-06-19";

export type KpiCategoria = "giro" | "liquidez" | "rentabilidad" | "valor";
export type KpiUnidad = "dias" | "monto" | "porcentaje" | "ratio";
/** Hacia dónde es "mejor" el indicador (para lectura/semáforo). */
export type DireccionIdeal = "menor-mejor" | "mayor-mejor" | "neutral";

export type KpiDef = {
  id: string;
  /** Etiqueta corta para tarjetas (ES, consistente con la UI). */
  label: string;
  /** Sigla / abreviatura (DSO, DIO, …). */
  sigla: string;
  categoria: KpiCategoria;
  unidad: KpiUnidad;
  /** Qué mide, en una frase. */
  descripcion: string;
  /** Fórmula legible. */
  formula: string;
  direccionIdeal: DireccionIdeal;
};

export const CATALOGO_KPI: readonly KpiDef[] = [
  {
    id: "giro.dso",
    label: "Días de cobranza",
    sigla: "DSO",
    categoria: "giro",
    unidad: "dias",
    descripcion: "Días promedio que tardan los clientes en pagar.",
    formula: "Cuentas por cobrar ÷ Ventas (c/IVA) × días del período",
    direccionIdeal: "menor-mejor",
  },
  {
    id: "giro.dio",
    label: "Días de inventario",
    sigla: "DIO",
    categoria: "giro",
    unidad: "dias",
    descripcion: "Días promedio que la mercadería permanece en stock antes de venderse.",
    formula: "Inventario (al costo) ÷ CMV × días del período",
    direccionIdeal: "menor-mejor",
  },
  {
    id: "giro.dpo",
    label: "Días de pago",
    sigla: "DPO",
    categoria: "giro",
    unidad: "dias",
    descripcion: "Días promedio que la empresa tarda en pagar a proveedores comerciales.",
    formula: "Proveedores comerciales ÷ CMV × días del período",
    direccionIdeal: "mayor-mejor",
  },
  {
    id: "giro.ccc",
    label: "Ciclo de caja",
    sigla: "CCC",
    categoria: "giro",
    unidad: "dias",
    descripcion:
      "Días que el efectivo queda inmovilizado en el ciclo operativo. Negativo = proveedores financian la operación.",
    formula: "DSO + DIO − DPO",
    direccionIdeal: "menor-mejor",
  },
  {
    id: "giro.nof",
    label: "Necesidades de fondos",
    sigla: "NOF",
    categoria: "giro",
    unidad: "monto",
    descripcion: "Capital de trabajo operativo a financiar (necesidades operativas de fondos).",
    formula: "Cuentas por cobrar + Inventario − Proveedores comerciales",
    direccionIdeal: "menor-mejor",
  },
] as const;

const POR_ID = new Map(CATALOGO_KPI.map((k) => [k.id, k]));

export function kpiPorId(id: string): KpiDef | undefined {
  return POR_ID.get(id);
}

export function kpisPorCategoria(categoria: KpiCategoria): KpiDef[] {
  return CATALOGO_KPI.filter((k) => k.categoria === categoria);
}
