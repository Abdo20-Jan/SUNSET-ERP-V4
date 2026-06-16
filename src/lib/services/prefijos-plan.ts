/**
 * Prefijos y códigos del plan de cuentas RT9, centralizados.
 *
 * Antes estaban hardcodeados en ~25 archivos (actions, services, reportes, bi,
 * UI); al renumerar el plan (rebuild RT9/RT17) se cambian acá una sola vez y
 * el resto importa de este módulo. Complementa a `cuenta-registry.ts` (cuentas
 * analíticas canónicas que el motor crea/reutiliza): este módulo agrupa los
 * PREFIJOS usados en filtros `startsWith` y los rangos de auto-creación, más
 * algunos códigos puntuales compartidos.
 *
 * Sin `import "server-only"`: lo consumen services del runtime y componentes UI.
 */

// ----- ACTIVO ------------------------------------------------
// Caja (1.1.1) y Bancos (1.1.2).
export const PREFIJO_CAJA = "1.1.1.";
export const PREFIJO_BANCOS = "1.1.2.";
export const PREFIJOS_BANCO_CAJA = [PREFIJO_CAJA, PREFIJO_BANCOS] as const;

// Inversiones (FCI / plazos fijos) — RT9: rubro 1.1.3 (antes 1.1.6.01).
export const PREFIJO_INVERSIONES = "1.1.3.";

// Créditos por ventas (clientes) — RT9: 1.1.4 (antes 1.1.3).
export const PREFIJO_CLIENTES = "1.1.4.";

// Créditos fiscales — RT9: 1.1.5 (antes 1.1.4). Subgrupos:
//   .1 IVA · .2 IIBB · .3 Ganancias · .4 Aduana.
export const PREFIJO_CREDITOS_FISCALES = "1.1.5.";
export const PREFIJO_CREDITO_IVA = "1.1.5.1.";
export const PREFIJO_CREDITO_IIBB = "1.1.5.2.";
export const PREFIJO_CREDITO_GANANCIAS = "1.1.5.3.";
export const PREFIJO_CREDITO_ADUANA = "1.1.5.4.";

// Bienes de cambio (estoque) — RT9: 1.1.7 (antes 1.1.5).
export const PREFIJO_BIENES_DE_CAMBIO = "1.1.7.";

// Cheques de terceros (Otros Créditos) — RT9: 1.1.6.2.01 (antes 1.1.4.20).
export const CODIGO_VALORES_A_COBRAR = "1.1.6.2.01";

// ----- PASIVO ------------------------------------------------
// Deudas comerciales: proveedores locales (2.1.1) + exterior (2.1.8).
export const PREFIJO_PROVEEDORES_LOCAL = "2.1.1.";
export const PREFIJO_PROVEEDORES_EXTERIOR = "2.1.8.";
export const PREFIJOS_PROVEEDORES = [
  PREFIJO_PROVEEDORES_LOCAL,
  PREFIJO_PROVEEDORES_EXTERIOR,
] as const;

// Deudas fiscales (2.1.3) y tributos de nacionalización por pagar (2.1.5).
export const PREFIJO_DEUDAS_FISCALES = "2.1.3.";
export const PREFIJO_ADUANA = "2.1.5.";
export const CODIGO_SALDO_PENDIENTE_ADUANA = "2.1.5.99";
// Filtro de tributos en despacho (aduana + fiscales).
export const PREFIJOS_TRIBUTOS_DESPACHO = [PREFIJO_ADUANA, PREFIJO_DEUDAS_FISCALES] as const;

// Préstamos — RT9: corto plazo 2.1.2 (antes 2.1.7), largo plazo 2.2.1.
export const PREFIJO_PRESTAMO_CORTO_PLAZO = "2.1.2.";
export const PREFIJO_PRESTAMO_LARGO_PLAZO = "2.2.1.";

// ----- PATRIMONIO --------------------------------------------
export const CODIGO_RESULTADO_EJERCICIO = "3.2.1.02";

// ----- RESULTADOS: diferencia de cambio (par único RT9) ------
// Ganancia 4.3.1.02 / pérdida 5.8.1.02 (consolidan los antiguos pares
// 4.3.1.01+4.4.1.01 / 5.8.2.01+5.3.1.01).
export const FX_GAIN_CODIGOS = new Set(["4.3.1.02"]);
export const FX_LOSS_CODIGOS = new Set(["5.8.1.02"]);
