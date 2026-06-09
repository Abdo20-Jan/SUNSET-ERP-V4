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
  // IIBB jurisdiccional embutido en el precio (no discriminado al
  // cliente). Sunset absorbe el IIBB de la jurisdicción del cliente
  // (BA 5%, CBA 4,75%, Corrientes 5%, etc.) — el cliente paga el
  // mismo total mostrado en la factura, y Sunset reconoce el IIBB
  // como gasto contra este pasivo a depositar a la jurisdicción.
  // Distinto de IIBB_POR_PAGAR (2.1.3.02) que es el IIBB propio
  // manual de Sunset (Córdoba). Mantiene el código histórico 2.1.3.05.
  PERCEPCIONES_IIBB_A_DEPOSITAR: {
    codigo: "2.1.3.05",
    nombre: "IIBB JURISDICCIONAL A DEPOSITAR",
    categoria: CuentaCategoria.PASIVO,
  },
  // Gasto IIBB jurisdiccional embutido — contrapartida de
  // PERCEPCIONES_IIBB_A_DEPOSITAR. Reduce la utilidad bruta de la
  // venta y por ende la base de Provisión Ganancias 35%.
  IIBB_GASTO: {
    codigo: "5.5.02",
    nombre: "INGRESOS BRUTOS",
    categoria: CuentaCategoria.EGRESO,
  },
  // Costo de Mercadería Vendida (CMV/COGS) — cuando se emite una venta
  // se debita aquí el costo a precio promedio, equilibrando con HABER en
  // 1.1.5.01 Estoque TP - Nacionalizado. Esto hace que la utilidad bruta (ingreso - CMV)
  // quede reflejada en Estado de Resultados.
  CMV: {
    codigo: "5.6.1.01",
    nombre: "COSTO MERCADERÍA VENDIDA",
    categoria: CuentaCategoria.EGRESO,
  },
  MERCADERIAS: {
    codigo: "1.1.5.01",
    nombre: "Estoque TP - Nacionalizado",
    categoria: CuentaCategoria.ACTIVO,
  },
  // Cuenta provisória del flujo stock dual (W3). Cuando se EMITE una
  // venta, el CMV se debita aquí en lugar de en MERCADERIAS — porque la
  // mercadería todavía está físicamente en el depósito. Cuando la
  // entrega (remito) se confirma, se hace DEBE 1.1.5.03 / HABER 1.1.5.01
  // y se crea el MovimientoStock EGRESO efectivo. Mantiene el contable
  // y el físico alineados durante la ventana emisión→entrega.
  //
  // Nota: el código 1.1.5.02 ya está ocupado por MERCADERIAS_EN_TRANSITO
  // (mercadería en zona primaria pre-despacho), por eso esta cuenta
  // provisória usa 1.1.5.03.
  MERCADERIAS_A_ENTREGAR: {
    codigo: "1.1.5.03",
    nombre: "Estoque a Entregar",
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
  // Excedente cuando los cheques de terceros recibidos suman MÁS que el
  // total facturado. El sobrante queda como pasivo (saldo a favor del
  // cliente) aplicable a facturas futuras. Antes esta diferencia se
  // descartaba silenciosamente en asiento-automatico (cheques truncados
  // al total); ahora se contabiliza para reflejar el efectivo recibido.
  ANTICIPOS_CLIENTES: {
    codigo: "2.1.7.01",
    nombre: "ANTICIPOS DE CLIENTES",
    categoria: CuentaCategoria.PASIVO,
  },
  // Flete sobre ventas — gasto cuando lo pagamos nosotros (no se cobra
  // al cliente). Reduce el margen neto y la utilidad bruta sobre la que
  // se devenga la provisión Ganancias.
  FLETE_GASTO: {
    codigo: "5.5.1.60",
    nombre: "FLETE SOBRE VENTAS",
    categoria: CuentaCategoria.EGRESO,
  },
  FLETE_POR_PAGAR: {
    codigo: "2.1.1.05",
    nombre: "FLETES SOBRE VENTAS POR PAGAR",
    categoria: CuentaCategoria.PASIVO,
  },
} as const satisfies Record<string, CuentaDef>;

// Tasa de Impuesto a las Ganancias para sociedades en Argentina
// (Ley 27.430 + 27.541). Tasa proporcional para PyMEs sería 25/30/35
// según escala. Por ahora 35% (no PyME / monto alto). Editable acá.
export const TASA_PROVISION_GANANCIAS = 0.35;

// ----- RETENCIÓN GANANCIAS (RG 830) — Sunset agente ----------
// Pasivo a depositar en ARCA por las retenciones de Ganancias
// practicadas al pagar facturas de proveedores. Distinto de:
//   2.1.3.03 GANANCIAS POR PAGAR (tributo de importación)
//   2.1.3.06 PROVISIÓN GANANCIAS (devengo 35% s/ utilidad de ventas)
// Acá se acumula lo retenido a terceros, pendiente de depósito (F.997
// SICORE). Como es 2.1.3.x aparece automáticamente en la vista de
// cuentas-a-pagar (sección fiscales) sin cambios en cuentas-a-pagar.ts.
export const RETENCION_GANANCIAS_CODIGOS = {
  RETENCIONES_GANANCIAS_POR_PAGAR: {
    codigo: "2.1.3.07",
    nombre: "RETENCIONES GANANCIAS A PAGAR",
    categoria: CuentaCategoria.PASIVO,
  },
} as const satisfies Record<string, CuentaDef>;

// Días desde la fecha de pago hasta el vencimiento del depósito ARCA
// (default RG 830). Editable acá hasta parametrizarlo por régimen.
export const DIAS_VENCIMIENTO_RETENCION_ARCA = 15;

// ----- COMPRAS LOCALES ---------------------------------------
export const COMPRA_CODIGOS = {
  MERCADERIAS: {
    codigo: "1.1.5.01",
    nombre: "Estoque TP - Nacionalizado",
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
  MERCADERIAS: {
    codigo: "1.1.5.01",
    nombre: "Estoque TP - Nacionalizado",
    categoria: CuentaCategoria.ACTIVO,
  },
  MERCADERIAS_EN_TRANSITO: {
    codigo: "1.1.5.02",
    nombre: "Estoque En Tránsito - Marítimo",
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

// ----- COMEX ZPA / DESCONSOLIDACIÓN (errata Q6 + D9) ---------
// Cuentas del flujo de contenedores / zona primaria / depósito fiscal.
//
// Q6 (resuelta 2026-05-20): 1.1.5.02 Estoque En Tránsito - Marítimo ya es
// analítica EN USO (fábrica → puerto) y conserva su historial — NO se
// toca. Por eso las cuentas nuevas usan códigos vacíos 1.1.5.04 / .05
// en vez de subcuentas .02.01/.02.02. Mapping de asientos (Fase 3):
//   - Llegada al puerto (ZPA):      DEBE 1.1.5.04 / HABER 1.1.5.02
//   - Traslado ZPA → depósito fiscal: DEBE 1.1.5.05 / HABER 1.1.5.04
//   - Nacionalización (vía DF):      DEBE 1.1.5.01 / HABER 1.1.5.05
//   - Nacionalización directa puerto: DEBE 1.1.5.01 / HABER 1.1.5.04
// Pendiente confirmación final del contador sobre disponibilidad de
// 1.1.5.04 / 1.1.5.05 en el rango.
//
// Nota: las cuentas de orden 9.x (Responsabilidad Sustituta Aduanera,
// Q9) NO viven acá — requieren una categoría ORDEN nueva en el enum
// CuentaCategoria (cambio de schema) para no contaminar el balance, y
// sólo se usan en Fase 3. Se agregan en el PR 3.1 junto al helper
// crearAsientoRespSustituta.
export const COMEX_ZPA_CODIGOS = {
  MERCADERIAS_EN_ZONA_PRIMARIA: {
    codigo: "1.1.5.04",
    nombre: "Estoque TP Logistica - Zona Primária",
    categoria: CuentaCategoria.ACTIVO,
  },
  MERCADERIAS_EN_DEPOSITO_FISCAL: {
    codigo: "1.1.5.05",
    nombre: "Estoque TP Logistica - Depósito Fiscal",
    categoria: CuentaCategoria.ACTIVO,
  },
  // D9 — divergencia formal (físico ≠ declarado). Falta sin responsable
  // identificado: DEBE acá (pérdida) / HABER 1.1.5.05 (o 1.1.5.04).
  PERDIDAS_LOGISTICAS: {
    codigo: "5.9.2.01",
    nombre: "PÉRDIDAS LOGÍSTICAS Y FALTANTES DE INVENTARIO",
    categoria: CuentaCategoria.EGRESO,
  },
  // D9 — sobra sin responsable: DEBE 1.1.5.05 / HABER acá (ingreso).
  INGRESO_POR_DIFERENCIA_INVENTARIO: {
    codigo: "4.9.1.01",
    nombre: "INGRESOS POR DIFERENCIA DE INVENTARIO",
    categoria: CuentaCategoria.INGRESO,
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
  DIFERENCIAS_REDONDEO: {
    codigo: "5.8.3.01",
    nombre: "DIFERENCIAS DE REDONDEO",
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

// ----- DIFERENCIA DE CAMBIO (pasivos/activos en moneda extranjera) ----
// Generadas automáticamente al pagar una factura USD con un TC distinto
// al de emisión. Ganancia si TC_pago < TC_factura (deuda se vuelve más
// barata); pérdida si TC_pago > TC_factura.
export const DIFERENCIA_CAMBIO_CODIGOS = {
  GANANCIA: {
    codigo: "4.5.1.01",
    nombre: "GANANCIA POR DIFERENCIA DE CAMBIO",
    categoria: CuentaCategoria.INGRESO,
  },
  PERDIDA: {
    codigo: "5.5.3.01",
    nombre: "PÉRDIDA POR DIFERENCIA DE CAMBIO",
    categoria: CuentaCategoria.EGRESO,
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
    nombre: "Estoque TP - Nacionalizado",
    categoria: CuentaCategoria.ACTIVO,
  },
  MERCADERIA_EXTERIOR: {
    codigo: "1.1.5.02",
    nombre: "Estoque En Tránsito - Marítimo",
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
