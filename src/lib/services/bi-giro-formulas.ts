/**
 * Fórmulas PURAS del ciclo de giro (capital de trabajo). Sin acceso a la base
 * ni a `server-only`: testeables de forma aislada.
 *
 * Convención de signos / bases (decisiones del recorte v1):
 * - DSO: CxC (créditos por ventas, 1.1.3.*) ÷ ventas del período × días.
 *   Ventas = facturación CON IVA → consistente con el saldo de CxC (que también
 *   incluye IVA).
 * - DIO: inventario (stock valorado al costo) ÷ CMV del período × días. Ambos
 *   al costo.
 * - DPO: CxP comercial (proveedores, 2.1.1.*) ÷ CMV del período × días. Usa CMV
 *   como proxy de compras (aprox. estándar cuando no se aísla la compra del
 *   período); CxP excluye préstamos / fiscales / no comerciales.
 * - CCC = DSO + DIO − DPO (puede ser negativo si DPO domina → financiamiento
 *   gratuito de proveedores).
 * - NOF = CxC + Inventario − CxP comercial (necesidades operativas de fondos;
 *   no depende de los días del período).
 *
 * Los saldos son de cierre (saldo final en `hasta`), no promedios — el promedio
 * con snapshot de apertura queda como refino futuro.
 */

const MS_POR_DIA = 86_400_000;

export type GiroInputs = {
  /** Facturación del período en moneda base (ARS), CON IVA. */
  ventasPeriodo: number;
  /** Costo de la mercadería vendida del período, al costo. */
  cmvPeriodo: number;
  /** Stock valorado al costo (saldo final). */
  inventario: number;
  /** Saldo de créditos por ventas (1.1.3.*). */
  cxc: number;
  /** Saldo de proveedores comerciales (2.1.1.*). */
  cxpComercial: number;
  /** Días del período (inclusivo). */
  diasPeriodo: number;
};

export type GiroIndicadores = {
  /** Days Sales Outstanding — días de cobranza. */
  dso: number;
  /** Days Inventory Outstanding — días de inventario. */
  dio: number;
  /** Days Payable Outstanding — días de pago. */
  dpo: number;
  /** Cash Conversion Cycle — ciclo de conversión de efectivo (días). */
  ccc: number;
  /** Necesidades Operativas de Fondos (monto). */
  nof: number;
};

/**
 * Ratio en días = (saldo / flujo) × días. Zero-safe: si el flujo o los días no
 * son positivos devuelve 0 (post-wipe / período sin movimientos).
 */
function ratioDias(saldo: number, flujo: number, dias: number): number {
  if (flujo <= 0 || dias <= 0) return 0;
  return (saldo / flujo) * dias;
}

export function calcularGiro(i: GiroInputs): GiroIndicadores {
  const dso = ratioDias(i.cxc, i.ventasPeriodo, i.diasPeriodo);
  const dio = ratioDias(i.inventario, i.cmvPeriodo, i.diasPeriodo);
  const dpo = ratioDias(i.cxpComercial, i.cmvPeriodo, i.diasPeriodo);
  return {
    dso,
    dio,
    dpo,
    ccc: dso + dio - dpo,
    nof: i.cxc + i.inventario - i.cxpComercial,
  };
}

/** Días del período, inclusivos (apertura y cierre cuentan). 0 si falta o se invierte el rango. */
export function diasDelPeriodo(desde?: Date | null, hasta?: Date | null): number {
  if (!desde || !hasta) return 0;
  const ms = hasta.getTime() - desde.getTime();
  if (Number.isNaN(ms) || ms < 0) return 0;
  return Math.floor(ms / MS_POR_DIA) + 1;
}
