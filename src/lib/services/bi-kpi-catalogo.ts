/**
 * Catálogo de KPI versionado (registry puro). Fuente única de las definiciones
 * de indicadores del BI: etiqueta, unidad, descripción, fórmula legible y
 * dirección ideal. La UI lee de acá para no duplicar literales.
 *
 * Diseñado para crecer por olas (giro → liquidez → rentabilidad → valor): para
 * sumar un indicador se agrega una entrada acá y se conecta su cálculo. El test
 * de drift garantiza que cada indicador calculado tenga su definición.
 */

export const CATALOGO_KPI_VERSION = "2026-06-20";

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
  {
    id: "liquidez.razonCorriente",
    label: "Razón corriente",
    sigla: "RC",
    categoria: "liquidez",
    unidad: "ratio",
    descripcion: "Capacidad de cubrir el pasivo corriente con el activo corriente.",
    formula: "Activo corriente ÷ Pasivo corriente",
    direccionIdeal: "mayor-mejor",
  },
  {
    id: "liquidez.pruebaAcida",
    label: "Prueba ácida",
    sigla: "PA",
    categoria: "liquidez",
    unidad: "ratio",
    descripcion: "Liquidez sin depender de vender el inventario.",
    formula: "(Activo corriente − Inventario) ÷ Pasivo corriente",
    direccionIdeal: "mayor-mejor",
  },
  {
    id: "liquidez.liquidezInmediata",
    label: "Liquidez inmediata",
    sigla: "LI",
    categoria: "liquidez",
    unidad: "ratio",
    descripcion: "Cobertura del pasivo corriente sólo con caja y bancos.",
    formula: "Disponibilidades ÷ Pasivo corriente",
    direccionIdeal: "mayor-mejor",
  },
  {
    id: "liquidez.capitalTrabajo",
    label: "Capital de trabajo",
    sigla: "CT",
    categoria: "liquidez",
    unidad: "monto",
    descripcion: "Colchón operativo: activo corriente menos pasivo corriente.",
    formula: "Activo corriente − Pasivo corriente",
    direccionIdeal: "mayor-mejor",
  },
  {
    id: "rentabilidad.margenBruto",
    label: "Resultado bruto",
    sigla: "RB",
    categoria: "rentabilidad",
    unidad: "monto",
    descripcion: "Ventas netas menos el costo de la mercadería vendida.",
    formula: "Ingresos netos − Costo de ventas",
    direccionIdeal: "mayor-mejor",
  },
  {
    id: "rentabilidad.margenBrutoPct",
    label: "Margen bruto",
    sigla: "MB%",
    categoria: "rentabilidad",
    unidad: "porcentaje",
    descripcion: "Resultado bruto como porcentaje de las ventas netas.",
    formula: "Resultado bruto ÷ Ingresos netos",
    direccionIdeal: "mayor-mejor",
  },
  {
    id: "rentabilidad.ebit",
    label: "Resultado operativo",
    sigla: "EBIT",
    categoria: "rentabilidad",
    unidad: "monto",
    descripcion: "Ganancia operativa antes de resultados financieros e impuestos.",
    formula: "Resultado bruto − Comercialización − Administración − Otros gastos operativos",
    direccionIdeal: "mayor-mejor",
  },
  {
    id: "rentabilidad.margenOperativoPct",
    label: "Margen operativo",
    sigla: "MO%",
    categoria: "rentabilidad",
    unidad: "porcentaje",
    descripcion: "Resultado operativo (EBIT) como porcentaje de las ventas netas.",
    formula: "EBIT ÷ Ingresos netos",
    direccionIdeal: "mayor-mejor",
  },
  {
    id: "rentabilidad.ebitda",
    label: "EBITDA",
    sigla: "EBITDA",
    categoria: "rentabilidad",
    unidad: "monto",
    descripcion: "Resultado operativo antes de depreciaciones y amortizaciones.",
    formula: "EBIT + Depreciación y amortización (7.7.)",
    direccionIdeal: "mayor-mejor",
  },
  {
    id: "rentabilidad.margenEbitdaPct",
    label: "Margen EBITDA",
    sigla: "ME%",
    categoria: "rentabilidad",
    unidad: "porcentaje",
    descripcion: "EBITDA como porcentaje de las ventas netas.",
    formula: "EBITDA ÷ Ingresos netos",
    direccionIdeal: "mayor-mejor",
  },
  {
    id: "rentabilidad.resultadoNeto",
    label: "Resultado neto",
    sigla: "RN",
    categoria: "rentabilidad",
    unidad: "monto",
    descripcion: "Resultado del ejercicio, después de impuestos.",
    formula: "Σ (haber − debe) de las cuentas de resultado",
    direccionIdeal: "mayor-mejor",
  },
  {
    id: "rentabilidad.margenNetoPct",
    label: "Margen neto",
    sigla: "MN%",
    categoria: "rentabilidad",
    unidad: "porcentaje",
    descripcion: "Resultado neto como porcentaje de las ventas netas.",
    formula: "Resultado neto ÷ Ingresos netos",
    direccionIdeal: "mayor-mejor",
  },
] as const;

const POR_ID = new Map(CATALOGO_KPI.map((k) => [k.id, k]));

export function kpiPorId(id: string): KpiDef | undefined {
  return POR_ID.get(id);
}

export function kpisPorCategoria(categoria: KpiCategoria): KpiDef[] {
  return CATALOGO_KPI.filter((k) => k.categoria === categoria);
}
