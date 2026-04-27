/**
 * Módulo de Relatórios Financeiros — fachada.
 *
 * Fonte única de verdade: `Asiento` + `LineaAsiento` onde `estado = CONTABILIZADO`.
 * Todos os cálculos usam `decimal.js` (ROUND_HALF_UP, precisão 28).
 */

export { getLibroDiario } from "./reportes/libro-diario";
export type {
  LibroDiarioAsiento,
  LibroDiarioLinea,
  LibroDiarioResult,
} from "./reportes/libro-diario";

export { getLibroMayor, LibroMayorError } from "./reportes/libro-mayor";
export type {
  LibroMayorLinea,
  LibroMayorResult,
} from "./reportes/libro-mayor";

export {
  getBalanceGeneral,
  getBalanceGeneralByFecha,
} from "./reportes/balance-general";
export type {
  BalanceGeneralResult,
  BalanceGeneralContexto,
} from "./reportes/balance-general";

export {
  getEstadoResultados,
  getEstadoResultadosByFecha,
} from "./reportes/estado-resultados";
export type { EstadoResultadosResult } from "./reportes/estado-resultados";

export { getFlujoCaja } from "./reportes/flujo-caja";
export type {
  FlujoCajaResult,
  FlujoCelula,
  FlujoItemRow,
  FlujoOrigen,
  FlujoSeccionRow,
  FlujoSubseccionRow,
} from "./reportes/flujo-caja";

export {
  FLUJO_CAJA_ESTRUCTURA,
  type FlujoDireccion,
  type FlujoItem,
  type FlujoSeccion,
  type FlujoSeccionId,
  type FlujoSubseccion,
} from "./reportes/flujo-caja-config";

export type { CuentaTreeNode } from "./reportes/shared";
