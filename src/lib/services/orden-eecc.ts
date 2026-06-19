/**
 * Orden de exposición de los Estados Contables (EECC) — fuente única.
 *
 * Transcripto de `ORDEN EECC.xlsx` (hoja "ORDEN EECC") y verificado 1:1 contra
 * la columna "Sección del documento" del Excel maestro del plan (`PLANO DE
 * CONTAS FINAL.xlsx`): cada cuenta cae en el rubro de su ancestro de código
 * (3 segmentos en clases 1/2, 2 segmentos en PN, sub/clase en resultado).
 *
 * Módulo PURO: sin `server-only` ni DB. Lo consume el plan (para derivar
 * `rubroEECC`) y los reportes Balance General / Estado de Resultados.
 */

export type GrupoBalance =
  | "Activo corriente"
  | "Activo no corriente"
  | "Pasivo corriente"
  | "Pasivo no corriente"
  | "Patrimonio neto";

/** Un rubro del Balance: su grupo patrimonial, orden de exposición, prefijo de
 * código (3 segmentos en clases 1/2; 2 segmentos en PN) y rótulo. */
export type RubroBalance = {
  grupo: GrupoBalance;
  orden: number;
  prefijo: string;
  rubro: string;
};

// Rubros del Balance en el orden del Excel. Activo corriente (1.1.x) / no
// corriente (1.2.x) / Pasivo corriente (2.1.x) / no corriente (2.2.x) salen del
// bloque "Balance" del ORDEN EECC; el Patrimonio Neto (3.x) no figura en ese
// bloque y se deriva de la estructura del plan (decisión del dueño).
export const BALANCE_RUBROS: readonly RubroBalance[] = [
  // Activo corriente
  { grupo: "Activo corriente", orden: 1, prefijo: "1.1.1", rubro: "Caja y bancos" },
  {
    grupo: "Activo corriente",
    orden: 2,
    prefijo: "1.1.2",
    rubro: "Inversiones financieras corrientes",
  },
  { grupo: "Activo corriente", orden: 3, prefijo: "1.1.3", rubro: "Cuentas por cobrar a clientes" },
  {
    grupo: "Activo corriente",
    orden: 4,
    prefijo: "1.1.4",
    rubro: "Créditos impositivos y aduaneros",
  },
  {
    grupo: "Activo corriente",
    orden: 5,
    prefijo: "1.1.5",
    rubro: "Créditos con partes relacionadas",
  },
  { grupo: "Activo corriente", orden: 6, prefijo: "1.1.6", rubro: "Otras cuentas por cobrar" },
  { grupo: "Activo corriente", orden: 7, prefijo: "1.1.7", rubro: "Bienes de cambio" },
  { grupo: "Activo corriente", orden: 8, prefijo: "1.1.8", rubro: "Otros activos corrientes" },
  // Activo no corriente
  {
    grupo: "Activo no corriente",
    orden: 1,
    prefijo: "1.2.1",
    rubro: "Inversiones financieras no corrientes",
  },
  {
    grupo: "Activo no corriente",
    orden: 2,
    prefijo: "1.2.2",
    rubro: "Cuentas por cobrar no corrientes",
  },
  {
    grupo: "Activo no corriente",
    orden: 3,
    prefijo: "1.2.3",
    rubro: "Créditos impositivos no corrientes",
  },
  {
    grupo: "Activo no corriente",
    orden: 4,
    prefijo: "1.2.4",
    rubro: "Créditos con partes relacionadas no corrientes",
  },
  {
    grupo: "Activo no corriente",
    orden: 5,
    prefijo: "1.2.5",
    rubro: "Otras cuentas por cobrar no corrientes",
  },
  {
    grupo: "Activo no corriente",
    orden: 6,
    prefijo: "1.2.6",
    rubro: "Bienes de cambio no corrientes",
  },
  { grupo: "Activo no corriente", orden: 7, prefijo: "1.2.7", rubro: "Propiedades de inversión" },
  { grupo: "Activo no corriente", orden: 8, prefijo: "1.2.8", rubro: "Bienes de uso" },
  { grupo: "Activo no corriente", orden: 9, prefijo: "1.2.9", rubro: "Activos intangibles" },
  {
    grupo: "Activo no corriente",
    orden: 10,
    prefijo: "1.2.10",
    rubro: "Activo por impuesto diferido",
  },
  {
    grupo: "Activo no corriente",
    orden: 11,
    prefijo: "1.2.11",
    rubro: "Otros activos no corrientes",
  },
  // Pasivo corriente
  { grupo: "Pasivo corriente", orden: 1, prefijo: "2.1.1", rubro: "Cuentas por pagar comerciales" },
  {
    grupo: "Pasivo corriente",
    orden: 2,
    prefijo: "2.1.2",
    rubro: "Préstamos y otros pasivos financieros",
  },
  { grupo: "Pasivo corriente", orden: 3, prefijo: "2.1.3", rubro: "Cargas fiscales" },
  {
    grupo: "Pasivo corriente",
    orden: 4,
    prefijo: "2.1.4",
    rubro: "Remuneraciones y cargas sociales",
  },
  {
    grupo: "Pasivo corriente",
    orden: 5,
    prefijo: "2.1.5",
    rubro: "Deudas en especie y anticipos de clientes",
  },
  {
    grupo: "Pasivo corriente",
    orden: 6,
    prefijo: "2.1.6",
    rubro: "Deudas con partes relacionadas",
  },
  { grupo: "Pasivo corriente", orden: 7, prefijo: "2.1.7", rubro: "Otras cuentas por pagar" },
  { grupo: "Pasivo corriente", orden: 8, prefijo: "2.1.8", rubro: "Previsiones corrientes" },
  // Pasivo no corriente
  {
    grupo: "Pasivo no corriente",
    orden: 1,
    prefijo: "2.2.1",
    rubro: "Préstamos y otros pasivos financieros no corrientes",
  },
  {
    grupo: "Pasivo no corriente",
    orden: 2,
    prefijo: "2.2.2",
    rubro: "Deudas comerciales no corrientes",
  },
  {
    grupo: "Pasivo no corriente",
    orden: 3,
    prefijo: "2.2.3",
    rubro: "Deudas con partes relacionadas no corrientes",
  },
  {
    grupo: "Pasivo no corriente",
    orden: 4,
    prefijo: "2.2.4",
    rubro: "Cargas fiscales no corrientes",
  },
  {
    grupo: "Pasivo no corriente",
    orden: 5,
    prefijo: "2.2.5",
    rubro: "Otras cuentas por pagar no corrientes",
  },
  {
    grupo: "Pasivo no corriente",
    orden: 6,
    prefijo: "2.2.6",
    rubro: "Pasivo por impuesto diferido",
  },
  { grupo: "Pasivo no corriente", orden: 7, prefijo: "2.2.7", rubro: "Previsiones no corrientes" },
  // Patrimonio neto (no figura en el bloque Balance del Excel; derivado del plan)
  { grupo: "Patrimonio neto", orden: 1, prefijo: "3.1", rubro: "Aportes de los propietarios" },
  {
    grupo: "Patrimonio neto",
    orden: 2,
    prefijo: "3.2",
    rubro: "Reservas y otros componentes del patrimonio neto",
  },
  { grupo: "Patrimonio neto", orden: 3, prefijo: "3.3", rubro: "Resultados acumulados" },
  { grupo: "Patrimonio neto", orden: 4, prefijo: "3.4", rubro: "Resultado del ejercicio" },
];

// Prefijo de sub/clase de resultado → rótulo del concepto del Estado de
// Resultados (clases 4-9). Es el `rubroEECC` de las cuentas de resultado. El
// orden y la cascada (subtotales) viven en `estado-resultados-rt9.ts`.
export const RUBRO_RESULTADO_POR_PREFIJO: readonly { prefijo: string; rubro: string }[] = [
  { prefijo: "4.1", rubro: "Ingresos por ventas" },
  { prefijo: "4.2", rubro: "Deducciones sobre ventas" },
  { prefijo: "4.3", rubro: "Otros ingresos operativos" },
  { prefijo: "5", rubro: "Costo de ventas" },
  { prefijo: "6", rubro: "Gastos de comercialización" },
  { prefijo: "7", rubro: "Gastos de administración" },
  { prefijo: "8.0", rubro: "Otros gastos operativos" },
  { prefijo: "8.1", rubro: "Cambios en propiedades de inversión" },
  { prefijo: "8.2", rubro: "Pérdidas y reversión de desvalorizaciones" },
  { prefijo: "8.3", rubro: "Otros ingresos" },
  { prefijo: "8.4", rubro: "Otros egresos" },
  { prefijo: "8.5", rubro: "Resultados por venta y baja de activos" },
  { prefijo: "8.6", rubro: "Contingencias" },
  { prefijo: "8.7", rubro: "Multas, sanciones y penalidades" },
  { prefijo: "8.8", rubro: "Resultado neto de operaciones discontinuadas" },
  { prefijo: "8.9", rubro: "Impuesto a las ganancias" },
  { prefijo: "9", rubro: "Resultados financieros y de tenencia" },
];

// Lista unificada prefijo→rubro (balance + PN + resultado). El criterio de
// match `codigo === p || codigo.startsWith(p + ".")` es no ambiguo: cada cuenta
// matchea exactamente su ancestro de rubro (el "." final desambigua 1.2.1 vs
// 1.2.11). Las sintéticas por encima del nivel de rubro no matchean → null.
const RUBRO_POR_PREFIJO: readonly { prefijo: string; rubro: string }[] = [
  ...BALANCE_RUBROS.map((r) => ({ prefijo: r.prefijo, rubro: r.rubro })),
  ...RUBRO_RESULTADO_POR_PREFIJO,
];

/**
 * `rubroEECC` de una cuenta por su código. Determinístico y verificado 1:1
 * contra el Excel maestro. Devuelve null para las sintéticas de agrupación por
 * encima del nivel de rubro (raíz de clase, corriente/no corriente).
 */
export function rubroEECCDeCuenta(codigo: string): string | null {
  for (const { prefijo, rubro } of RUBRO_POR_PREFIJO) {
    if (codigo === prefijo || codigo.startsWith(`${prefijo}.`)) return rubro;
  }
  return null;
}
