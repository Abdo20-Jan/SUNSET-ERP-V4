import "server-only";

import { CuentaCategoria } from "@/generated/prisma/client";
import type { CuentaDef } from "./cuenta-auto";

/**
 * Registry central de cuentas analíticas canónicas usadas por el motor
 * contable. Cuando un asiento generator necesita una cuenta (IVA débito,
 * IIBB compras, mercaderías en tránsito, etc.) hace getOrCreateCuenta(def)
 * — si no existe la crea, si existe la reutiliza. De esta forma el plan
 * de cuentas se construye solo a medida que el sistema opera.
 *
 * PLAN ULTRA (9 clases). Los códigos siguen `plan-de-cuentas.ts` (PLAN_CUENTAS).
 * Las clases de resultado se separan: 4 Ingresos · 5 Costo de Ventas ·
 * 6 Comercialización · 7 Administración · 8 Otros Resultados (incl. Impuesto a
 * las Ganancias) · 9 Resultados Financieros y por Tenencia. La diferencia de
 * cambio vive en 9.2.x; la Ley 25.413 no computable en 9.6.01.
 *
 * El split de Ventas/CMV por tipo de neumático se resuelve por
 * Producto.categoria vía `cuentaVentaLocalPorCategoria` / `cuentaCmvPorCategoria`;
 * las constantes VENTAS/CMV son el fallback sin desagregar.
 */

// ----- VENTAS ------------------------------------------------
export const VENTA_CODIGOS = {
  CLIENTE_FALLBACK: {
    codigo: "1.1.3.01.01",
    nombre: "DEUDORES POR VENTAS (GENÉRICO)",
    categoria: CuentaCategoria.ACTIVO,
  },
  // Venta local sin desagregar (fallback). El motor agrupa por
  // Producto.categoria → 4.1.01.01..04 vía cuentaVentaLocalPorCategoria.
  VENTAS: {
    codigo: "4.1.01.09",
    nombre: "VENTA MERCADERÍAS LOCAL (SIN DESAGREGAR)",
    categoria: CuentaCategoria.INGRESO,
  },
  IVA_DEBITO: {
    codigo: "2.1.4.1.01",
    nombre: "IVA DÉBITO FISCAL",
    categoria: CuentaCategoria.PASIVO,
  },
  IIBB_POR_PAGAR: {
    codigo: "2.1.4.2.01",
    nombre: "IIBB A PAGAR",
    categoria: CuentaCategoria.PASIVO,
  },
  OTROS_IMPUESTOS: {
    codigo: "2.1.4.5.99",
    nombre: "OTROS IMPUESTOS A PAGAR",
    categoria: CuentaCategoria.PASIVO,
  },
  // IIBB jurisdiccional embutido en el precio (no discriminado al cliente).
  // Sunset absorbe el IIBB de la jurisdicción del cliente como gasto (6.5.01)
  // contra este pasivo a depositar. Distinto de IIBB_POR_PAGAR (2.1.4.2.01).
  PERCEPCIONES_IIBB_A_DEPOSITAR: {
    codigo: "2.1.4.2.02",
    nombre: "IIBB CONVENIO MULTILATERAL A DEPOSITAR",
    categoria: CuentaCategoria.PASIVO,
  },
  // Gasto IIBB jurisdiccional embutido — contrapartida de
  // PERCEPCIONES_IIBB_A_DEPOSITAR (clase 6, comercialización).
  IIBB_GASTO: {
    codigo: "6.5.01",
    nombre: "INGRESOS BRUTOS (IIBB)",
    categoria: CuentaCategoria.EGRESO,
  },
  // CMV sin desagregar (fallback). El motor agrupa por categoría →
  // 5.1.01..04 vía cuentaCmvPorCategoria. Contrapartida HABER 1.1.7.01.
  CMV: {
    codigo: "5.1.99",
    nombre: "CMV OTRAS MERCADERÍAS",
    categoria: CuentaCategoria.EGRESO,
  },
  MERCADERIAS: {
    codigo: "1.1.7.01",
    nombre: "MERCADERÍAS NACIONALIZADAS",
    categoria: CuentaCategoria.ACTIVO,
  },
  // Cuenta provisória del flujo stock dual (W3). Al EMITIR la venta el CMV se
  // debita acá (la mercadería aún está físicamente en depósito); al confirmar
  // la entrega: DEBE 1.1.7.05 / HABER 1.1.7.01.
  MERCADERIAS_A_ENTREGAR: {
    codigo: "1.1.7.05",
    nombre: "MERCADERÍAS A ENTREGAR",
    categoria: CuentaCategoria.ACTIVO,
  },
  // Cheques de terceros recibidos como cobro — quedan en cartera (Valores a
  // depositar) hasta acreditarse. DEBE al recibir, HABER al acreditar.
  VALORES_A_COBRAR: {
    codigo: "1.1.1.03.01",
    nombre: "CHEQUES DE TERCEROS AL DÍA",
    categoria: CuentaCategoria.ACTIVO,
  },
  ANTICIPOS_CLIENTES: {
    codigo: "2.1.2.01",
    nombre: "ANTICIPOS DE CLIENTES NACIONALES",
    categoria: CuentaCategoria.PASIVO,
  },
  // Flete sobre ventas — gasto de comercialización (clase 6) cuando lo paga Sunset.
  FLETE_GASTO: {
    codigo: "6.3.01",
    nombre: "FLETES SOBRE VENTAS (SALIDA)",
    categoria: CuentaCategoria.EGRESO,
  },
  FLETE_POR_PAGAR: {
    codigo: "2.1.1.07",
    nombre: "FLETES SOBRE VENTAS POR PAGAR",
    categoria: CuentaCategoria.PASIVO,
  },
} as const satisfies Record<string, CuentaDef>;

/**
 * Split de Ventas locales por tipo de neumático (Producto.categoria → folha
 * 4.1.01.0x). Sin categoría reconocida cae al fallback VENTAS (4.1.01.09).
 */
export function cuentaVentaLocalPorCategoria(categoria?: string | null): CuentaDef {
  switch ((categoria ?? "").trim().toUpperCase()) {
    case "TBR":
      return {
        codigo: "4.1.01.01",
        nombre: "VENTA NEUMÁTICOS TBR — LOCAL",
        categoria: CuentaCategoria.INGRESO,
      };
    case "PCR":
    case "LTR":
    case "SUV":
    case "UHP":
      return {
        codigo: "4.1.01.02",
        nombre: "VENTA NEUMÁTICOS PCR/LTR — LOCAL",
        categoria: CuentaCategoria.INGRESO,
      };
    case "OTR":
    case "AGRICOLA":
    case "AGRÍCOLA":
      return {
        codigo: "4.1.01.03",
        nombre: "VENTA NEUMÁTICOS OTR/AGRÍCOLAS — LOCAL",
        categoria: CuentaCategoria.INGRESO,
      };
    case "CAMARA":
    case "CÁMARA":
    case "ACCESORIO":
      return {
        codigo: "4.1.01.04",
        nombre: "VENTA CÁMARAS Y ACCESORIOS — LOCAL",
        categoria: CuentaCategoria.INGRESO,
      };
    default:
      return VENTA_CODIGOS.VENTAS;
  }
}

/** Split de CMV por tipo de neumático (Producto.categoria → folha 5.1.0x). */
export function cuentaCmvPorCategoria(categoria?: string | null): CuentaDef {
  switch ((categoria ?? "").trim().toUpperCase()) {
    case "TBR":
      return { codigo: "5.1.01", nombre: "CMV NEUMÁTICOS TBR", categoria: CuentaCategoria.EGRESO };
    case "PCR":
    case "LTR":
    case "SUV":
    case "UHP":
      return {
        codigo: "5.1.02",
        nombre: "CMV NEUMÁTICOS PCR/LTR",
        categoria: CuentaCategoria.EGRESO,
      };
    case "OTR":
    case "AGRICOLA":
    case "AGRÍCOLA":
      return {
        codigo: "5.1.03",
        nombre: "CMV NEUMÁTICOS OTR/AGRÍCOLAS",
        categoria: CuentaCategoria.EGRESO,
      };
    case "CAMARA":
    case "CÁMARA":
    case "ACCESORIO":
      return {
        codigo: "5.1.04",
        nombre: "CMV CÁMARAS Y ACCESORIOS",
        categoria: CuentaCategoria.EGRESO,
      };
    default:
      return VENTA_CODIGOS.CMV;
  }
}

// ----- RETENCIÓN GANANCIAS (RG 830) — Sunset agente ----------
// Pasivo a depositar en ARCA (SICORE) por las retenciones de Ganancias
// practicadas al pagar facturas de proveedores.
export const RETENCION_GANANCIAS_CODIGOS = {
  RETENCIONES_GANANCIAS_POR_PAGAR: {
    codigo: "2.1.4.3.02",
    nombre: "GANANCIAS RETENCIONES PRACTICADAS A DEPOSITAR (SICORE)",
    categoria: CuentaCategoria.PASIVO,
  },
} as const satisfies Record<string, CuentaDef>;

export const DIAS_VENCIMIENTO_RETENCION_ARCA = 15;

// ----- COMPRAS LOCALES ---------------------------------------
export const COMPRA_CODIGOS = {
  MERCADERIAS: {
    codigo: "1.1.7.01",
    nombre: "MERCADERÍAS NACIONALIZADAS",
    categoria: CuentaCategoria.ACTIVO,
  },
  IVA_CREDITO: {
    codigo: "1.1.4.1.01",
    nombre: "IVA CRÉDITO FISCAL — COMPRAS LOCALES",
    categoria: CuentaCategoria.ACTIVO,
  },
  IIBB_CREDITO: {
    codigo: "1.1.4.2.02",
    nombre: "IIBB PERCEPCIONES SUFRIDAS — COMPRAS",
    categoria: CuentaCategoria.ACTIVO,
  },
  PROVEEDOR_FALLBACK: {
    codigo: "2.1.1.01.01",
    nombre: "PROVEEDORES LOCALES (GENÉRICO)",
    categoria: CuentaCategoria.PASIVO,
  },
  OTROS_GASTOS: {
    codigo: "7.9.99",
    nombre: "OTROS GASTOS ADMINISTRATIVOS DIVERSOS",
    categoria: CuentaCategoria.EGRESO,
  },
} as const satisfies Record<string, CuentaDef>;

// ----- ANTICIPOS A PROVEEDORES (decisión contador #4) --------
// Adelanto a proveedor LOCAL registrado antes de la factura. La clasificación
// bien vs servicio NO es un enum: la codifica la cuenta-destino elegida en el
// drilldown del plan. BIENES (1.1.7.07) cuelga de Bienes de Cambio; SERVICIOS
// (1.1.5.01) de Otros Créditos. Ambas son ACTIVO (saldo deudor a favor).
export const ANTICIPO_PROVEEDOR_CODIGOS = {
  BIENES: {
    codigo: "1.1.7.07",
    nombre: "ANTICIPOS A PROVEEDORES DE BIENES DE CAMBIO",
    categoria: CuentaCategoria.ACTIVO,
  },
  SERVICIOS: {
    codigo: "1.1.5.01",
    nombre: "ANTICIPOS A PROVEEDORES DE SERVICIOS",
    categoria: CuentaCategoria.ACTIVO,
  },
} as const satisfies Record<string, CuentaDef>;

// Raíces del subárbol de anticipo a proveedor: el drilldown
// (`listarCuentasAnticipoProveedor`) sólo ofrece estas cuentas y sus
// descendientes, y la action de registro valida que la cuenta elegida caiga
// bajo una de ellas.
export const ANTICIPO_PROVEEDOR_ROOTS: readonly string[] = [
  ANTICIPO_PROVEEDOR_CODIGOS.BIENES.codigo,
  ANTICIPO_PROVEEDOR_CODIGOS.SERVICIOS.codigo,
];

// ----- EMBARQUE / IMPORTACIÓN --------------------------------
export const EMBARQUE_CODIGOS = {
  MERCADERIAS: {
    codigo: "1.1.7.01",
    nombre: "MERCADERÍAS NACIONALIZADAS",
    categoria: CuentaCategoria.ACTIVO,
  },
  MERCADERIAS_EN_TRANSITO: {
    codigo: "1.1.7.02",
    nombre: "IMPORTACIONES EMBARCADAS / EN TRÁNSITO",
    categoria: CuentaCategoria.ACTIVO,
  },
  IVA_CREDITO_IMPORTACION: {
    codigo: "1.1.4.1.03",
    nombre: "IVA CRÉDITO FISCAL — IMPORTACIONES",
    categoria: CuentaCategoria.ACTIVO,
  },
  IVA_ADICIONAL_CREDITO: {
    codigo: "1.1.4.1.04",
    nombre: "IVA PERCEPCIÓN ADICIONAL — IMPORTACIONES",
    categoria: CuentaCategoria.ACTIVO,
  },
  IIBB_CREDITO_IMPORTACION: {
    codigo: "1.1.4.2.01",
    nombre: "IIBB PERCEPCIÓN SUFRIDA — IMPORTACIONES",
    categoria: CuentaCategoria.ACTIVO,
  },
  GANANCIAS_CREDITO: {
    codigo: "1.1.4.3.01",
    nombre: "GANANCIAS PERCEPCIÓN SUFRIDA — IMPORTACIONES",
    categoria: CuentaCategoria.ACTIVO,
  },
  IVA_CREDITO_COMPRAS: {
    codigo: "1.1.4.1.01",
    nombre: "IVA CRÉDITO FISCAL — COMPRAS LOCALES",
    categoria: CuentaCategoria.ACTIVO,
  },
  IIBB_CREDITO_COMPRAS: {
    codigo: "1.1.4.2.02",
    nombre: "IIBB PERCEPCIONES SUFRIDAS — COMPRAS",
    categoria: CuentaCategoria.ACTIVO,
  },
  // Tributos aduaneros (DIE/Tasa/Arancel) CAPITALIZAN al costo (1.1.7.01/02,
  // RT17). El DEBE va al stock; acá viven sólo los pasivos "por pagar a Aduana".
  DIE_PASIVO: {
    codigo: "2.1.4.4.01",
    nombre: "DERECHOS DE IMPORTACIÓN A PAGAR",
    categoria: CuentaCategoria.PASIVO,
  },
  TASA_ESTADISTICA_PASIVO: {
    codigo: "2.1.4.4.02",
    nombre: "TASA ESTADÍSTICA A PAGAR",
    categoria: CuentaCategoria.PASIVO,
  },
  ARANCEL_SIM_PASIVO: {
    codigo: "2.1.4.4.03",
    nombre: "ARANCEL SIM A PAGAR",
    categoria: CuentaCategoria.PASIVO,
  },
  IVA_POR_PAGAR: {
    codigo: "2.1.4.4.04",
    nombre: "IVA IMPORTACIÓN A PAGAR",
    categoria: CuentaCategoria.PASIVO,
  },
  IIBB_POR_PAGAR: {
    codigo: "2.1.4.2.01",
    nombre: "IIBB A PAGAR",
    categoria: CuentaCategoria.PASIVO,
  },
  // Percepción de Ganancias de importación a pagar a Aduana (era 2.1.3.4.01,
  // un bucket genérico; ahora hogar preciso: percepciones de importación).
  GANANCIAS_POR_PAGAR: {
    codigo: "2.1.4.4.05",
    nombre: "PERCEPCIONES DE IMPORTACIÓN A PAGAR",
    categoria: CuentaCategoria.PASIVO,
  },
  PROVEEDOR_EXTERIOR_FALLBACK: {
    codigo: "2.1.1.02.01",
    nombre: "PROVEEDORES DEL EXTERIOR (GENÉRICO)",
    categoria: CuentaCategoria.PASIVO,
  },
  // "Otros" del header de una factura (sin categoría/concepto) → cuenta dedicada,
  // no la primera línea de gasto (decisión #9). Mismo código que COMPRA_CODIGOS.
  OTROS_GASTOS: {
    codigo: "7.9.99",
    nombre: "OTROS GASTOS ADMINISTRATIVOS DIVERSOS",
    categoria: CuentaCategoria.EGRESO,
  },
} as const satisfies Record<string, CuentaDef>;

// ----- COMEX ZPA / DESCONSOLIDACIÓN -------------------------
// Flujo de contenedores / zona primaria / depósito fiscal:
//   - Llegada al puerto (ZPA):        DEBE 1.1.7.03 / HABER 1.1.7.02
//   - Traslado ZPA → depósito fiscal: DEBE 1.1.7.04 / HABER 1.1.7.03
//   - Nacionalización (vía DF):       DEBE 1.1.7.01 / HABER 1.1.7.04
//   - Nacionalización directa puerto: DEBE 1.1.7.01 / HABER 1.1.7.03
export const COMEX_ZPA_CODIGOS = {
  MERCADERIAS_EN_ZONA_PRIMARIA: {
    codigo: "1.1.7.03",
    nombre: "MERCADERÍAS EN PUERTO / ZONA PRIMARIA",
    categoria: CuentaCategoria.ACTIVO,
  },
  MERCADERIAS_EN_DEPOSITO_FISCAL: {
    codigo: "1.1.7.04",
    nombre: "MERCADERÍAS EN DEPÓSITO FISCAL",
    categoria: CuentaCategoria.ACTIVO,
  },
  // D9 — falta sin responsable identificado: DEBE acá / HABER 1.1.7.04 (o 03).
  PERDIDAS_LOGISTICAS: {
    codigo: "5.2.01",
    nombre: "FALTANTES DE INVENTARIO",
    categoria: CuentaCategoria.EGRESO,
  },
  // D9 — sobra sin responsable. ULTRA: contra-CMV (regularizadora ACREEDOR),
  // no ingreso. Se ACREDITA → reduce el costo de ventas neto.
  // NOTA: ya NO se usa en el ajuste D9 de despacho (ver DIFERENCIA_DESPACHO_*);
  // queda para la reconciliación de entrega stock-dual (crearAsientoEntrega).
  INGRESO_POR_DIFERENCIA_INVENTARIO: {
    codigo: "5.2.03",
    nombre: "(-) SOBRANTES DE INVENTARIO",
    categoria: CuentaCategoria.EGRESO,
  },
  // D9 despacho — SOBRANTE (físico > declarado): los bultos de más no son
  // ingreso; son deuda con el proveedor a regularizar (rectificar
  // factura/proforma + despacho, o devolver). Pasivo-puente hasta la
  // reclasificación a la CxP del proveedor. Decisión contador #6.
  DIFERENCIA_DESPACHO_A_PAGAR: {
    codigo: "2.1.1.08",
    nombre: "DIFERENCIAS DE DESPACHO A REGULARIZAR (A PAGAR)",
    categoria: CuentaCategoria.PASIVO,
  },
  // D9 despacho — FALTANTE sin responsable (físico < declarado): pagamos por
  // bultos no recibidos → saldo a favor con el proveedor a regularizar, no
  // pérdida directa. Activo-puente hasta la reclasificación. Decisión contador #6.
  DIFERENCIA_DESPACHO_A_FAVOR: {
    codigo: "1.1.5.07",
    nombre: "DIFERENCIAS DE DESPACHO A REGULARIZAR (SALDO A FAVOR PROVEEDOR)",
    categoria: CuentaCategoria.ACTIVO,
  },
} as const satisfies Record<string, CuentaDef>;

// ----- TRANSFERENCIAS / DIFERENCIA DE CAMBIO -----------------
// Diferencia de cambio realizada (clase 9): ganancia 9.2.01 / pérdida 9.2.02.
export const TRANSFERENCIA_CODIGOS = {
  DIF_CAMBIO_POSITIVA: {
    codigo: "9.2.01",
    nombre: "DIFERENCIA DE CAMBIO POSITIVA — REALIZADA",
    categoria: CuentaCategoria.INGRESO,
  },
  DIF_CAMBIO_NEGATIVA: {
    codigo: "9.2.02",
    nombre: "DIFERENCIA DE CAMBIO NEGATIVA — REALIZADA",
    categoria: CuentaCategoria.EGRESO,
  },
  DIFERENCIAS_REDONDEO: {
    codigo: "9.8.01",
    nombre: "DIFERENCIAS DE REDONDEO",
    categoria: CuentaCategoria.EGRESO,
  },
} as const satisfies Record<string, CuentaDef>;

// ----- VEP / DESPACHO ADUANERO (diferencia cambiaria) -------
export const VEP_ADUANA_CODIGOS = {
  CREDITO_ADUANA: {
    codigo: "1.1.4.4.01",
    nombre: "SALDO A FAVOR EN CUENTA ADUANERA / VEP",
    categoria: CuentaCategoria.ACTIVO,
  },
  SALDO_PENDIENTE_ADUANA: {
    codigo: "2.1.4.4.99",
    nombre: "SALDO PENDIENTE ADUANA (REFUERZO VEP)",
    categoria: CuentaCategoria.PASIVO,
  },
} as const satisfies Record<string, CuentaDef>;

// ----- DIFERENCIA DE CAMBIO (pasivos/activos en moneda extranjera) ----
export const DIFERENCIA_CAMBIO_CODIGOS = {
  GANANCIA: {
    codigo: "9.2.01",
    nombre: "DIFERENCIA DE CAMBIO POSITIVA — REALIZADA",
    categoria: CuentaCategoria.INGRESO,
  },
  PERDIDA: {
    codigo: "9.2.02",
    nombre: "DIFERENCIA DE CAMBIO NEGATIVA — REALIZADA",
    categoria: CuentaCategoria.EGRESO,
  },
} as const satisfies Record<string, CuentaDef>;

// ----- COSTOS FINANCIEROS (incluye impuesto al cheque) ------
export const COSTOS_FINANCIEROS_CODIGOS = {
  COMISIONES_BANCARIAS: {
    codigo: "9.5.01",
    nombre: "COMISIONES Y GASTOS BANCARIOS",
    categoria: CuentaCategoria.EGRESO,
  },
  GASTOS_TRANSFERENCIA_EXTERIOR: {
    codigo: "9.5.02",
    nombre: "GASTOS DE TRANSFERENCIAS AL EXTERIOR (SWIFT/TT)",
    categoria: CuentaCategoria.EGRESO,
  },
  IMPUESTO_DE_SELLOS: {
    codigo: "9.6.02",
    nombre: "IMPUESTO DE SELLOS SOBRE OPERACIONES FINANCIERAS",
    categoria: CuentaCategoria.EGRESO,
  },
  IMPUESTO_AL_CHEQUE: {
    codigo: "9.6.01",
    nombre: "IMPUESTO LEY 25.413 (PORCIÓN NO COMPUTABLE)",
    categoria: CuentaCategoria.EGRESO,
  },
  INTERESES_PAGADOS: {
    codigo: "9.1.03",
    nombre: "INTERESES PERDIDOS — PRÉSTAMOS",
    categoria: CuentaCategoria.EGRESO,
  },
} as const satisfies Record<string, CuentaDef>;

// ----- EXTRACTO BANCARIO: percepciones / retenciones / FCI ---
export const EXTRACTO_BANCARIO_CODIGOS = {
  PERCEPCION_IVA_BANCARIA: {
    codigo: "1.1.4.1.06",
    nombre: "IVA PERCEPCIÓN RG 2408 (BANCARIA)",
    categoria: CuentaCategoria.ACTIVO,
  },
  PERCEPCION_IIBB_SIRCREB: {
    codigo: "1.1.4.2.03",
    nombre: "IIBB RECAUDACIONES BANCARIAS — SIRCREB",
    categoria: CuentaCategoria.ACTIVO,
  },
  // 33% de la Ley 25413 computable como pago a cuenta de Ganancias (no-PyME).
  // El 67% restante queda como gasto en 9.6.01.
  CREDITO_LEY_25413_GANANCIAS: {
    codigo: "1.1.4.3.02",
    nombre: "IMPUESTO LEY 25.413 COMPUTABLE",
    categoria: CuentaCategoria.ACTIVO,
  },
  INVERSIONES_FCI: {
    codigo: "1.1.2.01",
    nombre: "FONDOS COMUNES DE INVERSIÓN",
    categoria: CuentaCategoria.ACTIVO,
  },
} as const satisfies Record<string, CuentaDef>;

// % computable de la Ley 25413 contra Ganancias (33% no-PyME / 100% PyME).
export const PORCENTAJE_LEY_25413_COMPUTABLE = 0.33;

// ----- GASTO CONTRAPARTIDA POR TIPO DE PROVEEDOR ------------
// Regla capitaliza-vs-gasto (RT17/NIC2): los servicios de IMPORTACIÓN
// (despachante, logística/flete de entrada, almacenaje bonded, portuarios,
// flete internacional) CAPITALIZAN al costo (1.1.7.02). Los gastos de PERÍODO
// van a resultado (clases 6/7).
const CAPITALIZA_IMPORTACION = {
  codigo: "1.1.7.02",
  nombre: "IMPORTACIONES EMBARCADAS / EN TRÁNSITO",
  categoria: CuentaCategoria.ACTIVO,
} as const satisfies CuentaDef;

export const GASTO_POR_TIPO_PROVEEDOR = {
  MERCADERIA_LOCAL: {
    codigo: "1.1.7.01",
    nombre: "MERCADERÍAS NACIONALIZADAS",
    categoria: CuentaCategoria.ACTIVO,
  },
  MERCADERIA_EXTERIOR: CAPITALIZA_IMPORTACION,
  DESPACHANTE: CAPITALIZA_IMPORTACION,
  LOGISTICA: CAPITALIZA_IMPORTACION,
  ALMACENAJE: CAPITALIZA_IMPORTACION,
  GASTOS_PORTUARIOS: CAPITALIZA_IMPORTACION,
  SERVICIOS_EXTERIOR: CAPITALIZA_IMPORTACION,
  // Gastos de período → egreso de resultado (clases 6/7).
  SERVICIOS_PROFESIONALES: {
    codigo: "7.2.01",
    nombre: "HONORARIOS CONTABLES",
    categoria: CuentaCategoria.EGRESO,
  },
  ALQUILERES: {
    codigo: "7.4.01",
    nombre: "ALQUILER DE OFICINAS",
    categoria: CuentaCategoria.EGRESO,
  },
  IT_SOFTWARE: {
    codigo: "7.3.01",
    nombre: "SOFTWARE COMO SERVICIO (SAAS) Y LICENCIAS",
    categoria: CuentaCategoria.EGRESO,
  },
  MARKETING: {
    codigo: "6.4.01",
    nombre: "PUBLICIDAD Y PROMOCIÓN",
    categoria: CuentaCategoria.EGRESO,
  },
  OTRO: {
    codigo: "7.9.99",
    nombre: "OTROS GASTOS ADMINISTRATIVOS DIVERSOS",
    categoria: CuentaCategoria.EGRESO,
  },
} as const satisfies Record<string, CuentaDef>;

// ----- ESTOQUE FÍSICO POR COMPRA (E18) -----------------------
// Códigos cuya selección como CATEGORÍA de un ítem de Compra dispara el
// ingreso de ESTOQUE FÍSICO nacional (MovimientoStock + costoPromedio) al
// emitir. Hoy sólo Bien de Cambio nacional (1.1.7.01, Estoque nacionalizado).
// La importación en tránsito (1.1.7.02) NO entra acá: su estoque físico entra
// por el Comex (Embarque→Despacho) — evita el doble conteo. Se deriva del
// registry para acompañar cualquier renumeración del plan.
export const ESTOQUE_FISICO_CODIGOS: readonly string[] = [COMPRA_CODIGOS.MERCADERIAS.codigo];

export function categoriaCapitalizaEstoque(codigo: string): boolean {
  return ESTOQUE_FISICO_CODIGOS.includes(codigo);
}
