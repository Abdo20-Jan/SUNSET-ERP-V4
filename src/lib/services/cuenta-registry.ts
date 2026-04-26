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
} as const satisfies Record<string, CuentaDef>;

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
