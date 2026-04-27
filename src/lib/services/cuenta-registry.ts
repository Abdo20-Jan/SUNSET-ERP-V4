import "server-only";

import { CuentaCategoria } from "@/generated/prisma/client";
import type { CuentaDef } from "./cuenta-auto";

/**
 * Registry central de cuentas analíticas canónicas usadas por el motor
 * contable. Cuando un asiento generator necesita una cuenta (IVA débito,
 * IIBB compras, mercaderías en tránsito, etc.) hace getOrCreateCuenta(def)
 * — si no existe la crea, si existe la reutiliza. De esta forma el plan
 * de cuentas se construye solo a medida que el sistema opera.
 */

// ----- VENTAS ------------------------------------------------
export const VENTA_CODIGOS = {
  CLIENTE_FALLBACK: {
    codigo: "1.1.3.01",
    nombre: "DEUDORES POR VENTAS",
    categoria: CuentaCategoria.ACTIVO,
  },
  VENTAS: {
    codigo: "4.1.1.01",
    nombre: "VENTAS NEUMÁTICOS NUEVOS",
    categoria: CuentaCategoria.INGRESO,
  },
  IVA_DEBITO: {
    codigo: "2.1.6.01",
    nombre: "IVA VENTAS POR PAGAR",
    categoria: CuentaCategoria.PASIVO,
  },
  IIBB_POR_PAGAR: {
    codigo: "2.1.3.02",
    nombre: "IIBB POR PAGAR",
    categoria: CuentaCategoria.PASIVO,
  },
  OTROS_IMPUESTOS: {
    codigo: "2.1.3.04",
    nombre: "OTROS IMPUESTOS",
    categoria: CuentaCategoria.PASIVO,
  },
  // Costo de Mercadería Vendida (CMV/COGS) — cuando se emite una venta
  // se debita aquí el costo a precio promedio, equilibrando con HABER en
  // 1.1.5.01 MERCADERÍAS. Esto hace que la utilidad bruta (ingreso - CMV)
  // quede reflejada en Estado de Resultados.
  CMV: {
    codigo: "5.6.1.01",
    nombre: "COSTO MERCADERÍA VENDIDA",
    categoria: CuentaCategoria.EGRESO,
  },
  MERCADERIAS: {
    codigo: "1.1.5.01",
    nombre: "MERCADERÍAS",
    categoria: CuentaCategoria.ACTIVO,
  },
  // Provisión Impuesto a las Ganancias — se devenga la tasa sobre la
  // utilidad bruta de cada venta. El monto acumulado se paga al cierre
  // del ejercicio fiscal (DDJJ anual de Ganancias).
  PROVISION_GANANCIAS_GASTO: {
    codigo: "5.9.1.01",
    nombre: "PROVISIÓN IMPUESTO A LAS GANANCIAS",
    categoria: CuentaCategoria.EGRESO,
  },
  PROVISION_GANANCIAS_PASIVO: {
    codigo: "2.1.3.06",
    nombre: "PROVISIÓN IMPUESTO GANANCIAS POR PAGAR",
    categoria: CuentaCategoria.PASIVO,
  },
  // Cheques de terceros recibidos como cobro de venta — quedan en
  // cartera hasta acreditarse en cuenta bancaria. DEBE al recibir,
  // HABER al acreditar (contra DEBE banco).
  VALORES_A_COBRAR: {
    codigo: "1.1.4.20",
    nombre: "VALORES A COBRAR (CHEQUES DE TERCEROS)",
    categoria: CuentaCategoria.ACTIVO,
  },
} as const satisfies Record<string, CuentaDef>;

// Tasa de Impuesto a las Ganancias para sociedades en Argentina
// (Ley 27.430 + 27.541). Tasa proporcional para PyMEs sería 25/30/35
// según escala. Por ahora 35% (no PyME / monto alto). Editable acá.
export const TASA_PROVISION_GANANCIAS = 0.35;

// ----- COMPRAS LOCALES ---------------------------------------
export const COMPRA_CODIGOS = {
  MERCADERIAS: {
    codigo: "1.1.5.01",
    nombre: "MERCADERÍAS",
    categoria: CuentaCategoria.ACTIVO,
  },
  IVA_CREDITO: {
    codigo: "1.1.4.08",
    nombre: "IVA CRÉDITO FISCAL COMPRAS",
    categoria: CuentaCategoria.ACTIVO,
  },
  IIBB_CREDITO: {
    codigo: "1.1.4.11",
    nombre: "CRÉDITO INGRESOS BRUTOS COMPRAS",
    categoria: CuentaCategoria.ACTIVO,
  },
  PROVEEDOR_FALLBACK: {
    codigo: "2.1.1.01",
    nombre: "PROVEEDORES LOCALES",
    categoria: CuentaCategoria.PASIVO,
  },
  OTROS_GASTOS: {
    codigo: "5.3.1.99",
    nombre: "OTROS GASTOS",
    categoria: CuentaCategoria.EGRESO,
  },
} as const satisfies Record<string, CuentaDef>;

// ----- EMBARQUE / IMPORTACIÓN --------------------------------
export const EMBARQUE_CODIGOS = {
  // Activos: capitalización + créditos fiscales importación
  MERCADERIAS_EN_TRANSITO: {
    codigo: "1.1.5.02",
    nombre: "MERCADERÍAS EN TRÁNSITO",
    categoria: CuentaCategoria.ACTIVO,
  },
  IVA_CREDITO_IMPORTACION: {
    codigo: "1.1.4.04",
    nombre: "IVA CRÉDITO FISCAL IMPORTACIÓN",
    categoria: CuentaCategoria.ACTIVO,
  },
  IVA_ADICIONAL_CREDITO: {
    codigo: "1.1.4.05",
    nombre: "IVA ADICIONAL IMPORTACIÓN",
    categoria: CuentaCategoria.ACTIVO,
  },
  IIBB_CREDITO_IMPORTACION: {
    codigo: "1.1.4.06",
    nombre: "PERCEPCIÓN IIBB IMPORTACIÓN",
    categoria: CuentaCategoria.ACTIVO,
  },
  GANANCIAS_CREDITO: {
    codigo: "1.1.4.07",
    nombre: "PERCEPCIÓN GANANCIAS IMPORTACIÓN",
    categoria: CuentaCategoria.ACTIVO,
  },
  IVA_CREDITO_COMPRAS: {
    codigo: "1.1.4.01",
    nombre: "IVA CRÉDITO FISCAL",
    categoria: CuentaCategoria.ACTIVO,
  },
  IIBB_CREDITO_COMPRAS: {
    codigo: "1.1.4.11",
    nombre: "CRÉDITO INGRESOS BRUTOS COMPRAS",
    categoria: CuentaCategoria.ACTIVO,
  },
  // Egresos: tributos aduaneros como gasto
  DIE_EGRESO: {
    codigo: "5.7.1.01",
    nombre: "DERECHOS DE IMPORTACIÓN",
    categoria: CuentaCategoria.EGRESO,
  },
  TASA_ESTADISTICA_EGRESO: {
    codigo: "5.7.1.02",
    nombre: "TASA ESTADÍSTICA",
    categoria: CuentaCategoria.EGRESO,
  },
  ARANCEL_SIM_EGRESO: {
    codigo: "5.7.1.03",
    nombre: "ARANCEL SIM IMPORTACIÓN",
    categoria: CuentaCategoria.EGRESO,
  },
  // Pasivos: por pagar a Aduana / proveedor exterior
  DIE_PASIVO: {
    codigo: "2.1.5.01",
    nombre: "DERECHOS DE IMPORTACIÓN POR PAGAR",
    categoria: CuentaCategoria.PASIVO,
  },
  TASA_ESTADISTICA_PASIVO: {
    codigo: "2.1.5.02",
    nombre: "TASA ESTADÍSTICA POR PAGAR",
    categoria: CuentaCategoria.PASIVO,
  },
  ARANCEL_SIM_PASIVO: {
    codigo: "2.1.5.03",
    nombre: "ARANCEL SIM POR PAGAR",
    categoria: CuentaCategoria.PASIVO,
  },
  IVA_POR_PAGAR: {
    codigo: "2.1.5.04",
    nombre: "IVA IMPORTACIÓN POR PAGAR",
    categoria: CuentaCategoria.PASIVO,
  },
  IIBB_POR_PAGAR: {
    codigo: "2.1.3.02",
    nombre: "IIBB POR PAGAR",
    categoria: CuentaCategoria.PASIVO,
  },
  GANANCIAS_POR_PAGAR: {
    codigo: "2.1.3.03",
    nombre: "GANANCIAS POR PAGAR",
    categoria: CuentaCategoria.PASIVO,
  },
  PROVEEDOR_EXTERIOR_FALLBACK: {
    codigo: "2.1.1.02",
    nombre: "PROVEEDORES DEL EXTERIOR",
    categoria: CuentaCategoria.PASIVO,
  },
} as const satisfies Record<string, CuentaDef>;

// ----- TRANSFERENCIAS / DIFERENCIA DE CAMBIO -----------------
export const TRANSFERENCIA_CODIGOS = {
  DIF_CAMBIO_POSITIVA: {
    codigo: "4.3.1.01",
    nombre: "DIFERENCIA DE CAMBIO POSITIVA",
    categoria: CuentaCategoria.INGRESO,
  },
  DIF_CAMBIO_NEGATIVA: {
    codigo: "5.8.2.01",
    nombre: "DIFERENCIA DE CAMBIO NEGATIVA",
    categoria: CuentaCategoria.EGRESO,
  },
} as const satisfies Record<string, CuentaDef>;

// ----- VEP / DESPACHO ADUANERO (diferencia cambiaria) -------
// El VEP se paga al despachar provisorio (TC del día); cuando se
// oficializa con TC distinto, puede generarse un crédito a favor de
// Aduana (pago > liquidación) o un saldo pendiente (pago <
// liquidación) que requiere un VEP de refuerzo.
export const VEP_ADUANA_CODIGOS = {
  CREDITO_ADUANA: {
    codigo: "1.1.4.13",
    nombre: "CRÉDITO A FAVOR ADUANA (DIFERENCIA CAMBIARIA)",
    categoria: CuentaCategoria.ACTIVO,
  },
  SALDO_PENDIENTE_ADUANA: {
    codigo: "2.1.5.99",
    nombre: "SALDO PENDIENTE ADUANA (REFUERZO VEP)",
    categoria: CuentaCategoria.PASIVO,
  },
} as const satisfies Record<string, CuentaDef>;

// ----- COSTOS FINANCIEROS (incluye impuesto al cheque) ------
export const COSTOS_FINANCIEROS_CODIGOS = {
  COMISIONES_BANCARIAS: {
    codigo: "5.8.1.01",
    nombre: "COMISIONES BANCARIAS",
    categoria: CuentaCategoria.EGRESO,
  },
  GASTOS_TRANSFERENCIA_EXTERIOR: {
    codigo: "5.8.1.02",
    nombre: "GASTOS TRANSFERENCIA EXTERIOR",
    categoria: CuentaCategoria.EGRESO,
  },
  IMPUESTO_DE_SELLOS: {
    codigo: "5.8.1.04",
    nombre: "IMPUESTO DE SELLOS",
    categoria: CuentaCategoria.EGRESO,
  },
  IMPUESTO_AL_CHEQUE: {
    codigo: "5.8.1.06",
    nombre: "IMPUESTO LEY 25413 (DEB/CRED BANCARIOS)",
    categoria: CuentaCategoria.EGRESO,
  },
  INTERESES_PAGADOS: {
    codigo: "5.8.2.02",
    nombre: "INTERESES PAGADOS",
    categoria: CuentaCategoria.EGRESO,
  },
} as const satisfies Record<string, CuentaDef>;

// ----- EXTRACTO BANCARIO: percepciones / retenciones / FCI ---
// Cuentas usadas al importar extractos bancarios (Galicia, Santander).
// Las percepciones bancarias son crédito fiscal computable contra
// el impuesto correspondiente; los FCI son una inversión transitoria.
export const EXTRACTO_BANCARIO_CODIGOS = {
  PERCEPCION_IVA_BANCARIA: {
    codigo: "1.1.4.02",
    nombre: "PERCEPCIÓN IVA RG 2408 (BANCARIA)",
    categoria: CuentaCategoria.ACTIVO,
  },
  PERCEPCION_IIBB_SIRCREB: {
    codigo: "1.1.4.10",
    nombre: "PERCEPCIÓN IIBB SIRCREB",
    categoria: CuentaCategoria.ACTIVO,
  },
  // 33% del impuesto Ley 25413 (débitos y créditos) es computable
  // como pago a cuenta de Ganancias para empresas no-PyME (Decreto
  // 409/2018 + Ley 27743). El 67% restante queda como gasto en 5.8.1.06.
  CREDITO_LEY_25413_GANANCIAS: {
    codigo: "1.1.4.12",
    nombre: "CRÉDITO LEY 25413 PAGO A CUENTA GANANCIAS",
    categoria: CuentaCategoria.ACTIVO,
  },
  INVERSIONES_FCI: {
    codigo: "1.1.6.01",
    nombre: "INVERSIONES EN FONDOS COMUNES",
    categoria: CuentaCategoria.ACTIVO,
  },
} as const satisfies Record<string, CuentaDef>;

// % computable de la Ley 25413 contra Ganancias.
// Para PyMEs (cat. micro/pequeña) es 100%; para resto es 33%.
// Tomamos 33% como default — ajustar acá si la empresa cambia categoría.
export const PORCENTAJE_LEY_25413_COMPUTABLE = 0.33;

// ----- GASTO CONTRAPARTIDA POR TIPO DE PROVEEDOR ------------
// Mapa que crearAsientoCompra usa para elegir la cuenta de gasto
// según proveedor.tipoProveedor. Garantiza contabilización correcta:
// despachante → 5.1.1.03; almacenaje → 5.5.1.05; etc.
export const GASTO_POR_TIPO_PROVEEDOR = {
  MERCADERIA_LOCAL: {
    codigo: "1.1.5.01",
    nombre: "MERCADERÍAS",
    categoria: CuentaCategoria.ACTIVO,
  },
  MERCADERIA_EXTERIOR: {
    codigo: "1.1.5.02",
    nombre: "MERCADERÍAS EN TRÁNSITO",
    categoria: CuentaCategoria.ACTIVO,
  },
  DESPACHANTE: {
    codigo: "5.1.1.03",
    nombre: "HONORARIOS DESPACHANTE",
    categoria: CuentaCategoria.EGRESO,
  },
  LOGISTICA: {
    codigo: "5.5.1.01",
    nombre: "FLETE NACIONAL",
    categoria: CuentaCategoria.EGRESO,
  },
  ALMACENAJE: {
    codigo: "5.5.1.05",
    nombre: "ALMACENAJE Y WMS",
    categoria: CuentaCategoria.EGRESO,
  },
  SERVICIOS_PROFESIONALES: {
    codigo: "5.1.1.01",
    nombre: "HONORARIOS CONTABLES",
    categoria: CuentaCategoria.EGRESO,
  },
  ALQUILERES: {
    codigo: "5.2.1.01",
    nombre: "ALQUILER",
    categoria: CuentaCategoria.EGRESO,
  },
  IT_SOFTWARE: {
    codigo: "5.3.1.02",
    nombre: "SISTEMAS Y SOFTWARE",
    categoria: CuentaCategoria.EGRESO,
  },
  GASTOS_PORTUARIOS: {
    codigo: "5.4.1.01",
    nombre: "GASTOS PORTUARIOS",
    categoria: CuentaCategoria.EGRESO,
  },
  MARKETING: {
    codigo: "5.3.1.05",
    nombre: "PUBLICIDAD Y MARKETING",
    categoria: CuentaCategoria.EGRESO,
  },
  SERVICIOS_EXTERIOR: {
    codigo: "5.5.1.02",
    nombre: "FLETE INTERNACIONAL",
    categoria: CuentaCategoria.EGRESO,
  },
  OTRO: {
    codigo: "5.3.1.99",
    nombre: "OTROS GASTOS",
    categoria: CuentaCategoria.EGRESO,
  },
} as const satisfies Record<string, CuentaDef>;
