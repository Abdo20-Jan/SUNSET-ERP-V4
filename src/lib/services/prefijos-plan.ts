/**
 * Prefijos y códigos del plan de cuentas, centralizados (PLAN ULTRA, 9 clases).
 *
 * Antes estaban hardcodeados en ~25 archivos (actions, services, reportes, bi,
 * UI); con el plan ULTRA se cambian acá una sola vez y el resto importa de este
 * módulo. Complementa a `cuenta-registry.ts` (cuentas analíticas canónicas que
 * el motor crea/reutiliza): este módulo agrupa los PREFIJOS usados en filtros
 * `startsWith` y algunos códigos puntuales compartidos.
 *
 * Sin `import "server-only"`: lo consumen services del runtime y componentes UI.
 */

// ----- ACTIVO ------------------------------------------------
// Caja (1.1.1.01) y Bancos (1.1.1.02) — ambos bajo 1.1.1 CAJA Y BANCOS.
export const PREFIJO_CAJA = "1.1.1.01.";
export const PREFIJO_BANCOS = "1.1.1.02.";
export const PREFIJOS_BANCO_CAJA = [PREFIJO_CAJA, PREFIJO_BANCOS] as const;

// Inversiones financieras corrientes (FCI / plazos fijos) — 1.1.2.
export const PREFIJO_INVERSIONES = "1.1.2.";

// Créditos por ventas (clientes) — 1.1.3 (nacionales 1.1.3.01 / exterior 1.1.3.02).
export const PREFIJO_CLIENTES = "1.1.3.";

// Créditos impositivos y aduaneros — 1.1.4. Subgrupos:
//   .1 IVA · .2 IIBB · .3 Ganancias · .4 Aduana.
export const PREFIJO_CREDITOS_FISCALES = "1.1.4.";
export const PREFIJO_CREDITO_IVA = "1.1.4.1.";
export const PREFIJO_CREDITO_IIBB = "1.1.4.2.";
export const PREFIJO_CREDITO_GANANCIAS = "1.1.4.3.";
export const PREFIJO_CREDITO_ADUANA = "1.1.4.4.";

// Bienes de cambio (estoque) — 1.1.7.
export const PREFIJO_BIENES_DE_CAMBIO = "1.1.7.";

// Cheques de terceros (Valores a depositar) — 1.1.1.03.01.
export const CODIGO_VALORES_A_COBRAR = "1.1.1.03.01";

// ----- PASIVO ------------------------------------------------
// Deudas comerciales: proveedores nacionales (2.1.1.01) + exterior (2.1.1.02).
export const PREFIJO_PROVEEDORES_LOCAL = "2.1.1.01.";
export const PREFIJO_PROVEEDORES_EXTERIOR = "2.1.1.02.";
export const PREFIJOS_PROVEEDORES = [
  PREFIJO_PROVEEDORES_LOCAL,
  PREFIJO_PROVEEDORES_EXTERIOR,
] as const;

// Cargas fiscales a pagar (2.1.3) y tributos aduaneros por pagar (2.1.3.4).
export const PREFIJO_DEUDAS_FISCALES = "2.1.3.";
export const PREFIJO_ADUANA = "2.1.3.4.";
export const CODIGO_SALDO_PENDIENTE_ADUANA = "2.1.3.4.99";
// Filtro de tributos en despacho (aduana + fiscales).
export const PREFIJOS_TRIBUTOS_DESPACHO = [PREFIJO_ADUANA, PREFIJO_DEUDAS_FISCALES] as const;

// Préstamos bancarios — corrientes 2.1.2.02, no corrientes 2.2.1.01. Se acota
// al subárbol BANCARIO (no overdrafts 2.1.2.01 ni tarjetas/intereses) porque
// `prestamos` lista/crea cuentas analíticas de préstamo bajo estos padres.
export const PREFIJO_PRESTAMO_CORTO_PLAZO = "2.1.2.02.";
export const PREFIJO_PRESTAMO_LARGO_PLAZO = "2.2.1.01.";

// ----- PATRIMONIO --------------------------------------------
// Resultado del ejercicio: cuenta de cierre SINTÉTICA (3.4), calculada por el
// reporte como suma de clases 4-9. La ANALÍTICA imputable de cierre es 3.4.01
// (SOLO_SISTEMA): recibe el asiento de cierre (clases 4-9 → 3.4.01) y se
// transfiere a resultados no asignados (3.4.01 → 3.3.01) por el destino.
export const CODIGO_RESULTADO_EJERCICIO = "3.4";
export const CODIGO_RESULTADO_EJERCICIO_IMPUTABLE = "3.4.01";
export const CODIGO_RESULTADOS_NO_ASIGNADOS = "3.3.01";

// ----- RESULTADOS: diferencia de cambio (clase 9.2) ----------
// Realizada: ganancia 9.2.01 / pérdida 9.2.02. No realizada (cierre): 9.2.03 /
// 9.2.04 (sólo asiento manual; incluidas para detección en reconciliación).
export const FX_GAIN_CODIGOS = new Set(["9.2.01", "9.2.03"]);
export const FX_LOSS_CODIGOS = new Set(["9.2.02", "9.2.04"]);
