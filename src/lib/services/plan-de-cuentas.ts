/**
 * Plan de cuentas — FUENTE ÚNICA estructurada (modelo de 9 clases del Excel
 * maestro `PLANO DE CONTAS FINAL.xlsx`, 631 cuentas). El dato vive en
 * `plan-de-cuentas.data.ts` (GENERADO por `scripts/extract-plan-de-cuentas.py`);
 * acá viven los tipos, la proyección al registro de `CuentaContable` y el guard
 * (`validarPlan`).
 *
 * Modelo de 9 clases contables independientes: 1 Activo · 2 Pasivo ·
 * 3 Patrimonio Neto · 4 Ingresos · 5 Costo de Ventas · 6 Gastos de
 * Comercialización · 7 Gastos de Administración · 8 Otros Ingresos/Egresos y
 * Resultados · 9 Resultados Financieros y de Tenencia.
 *
 * ETAPA 1/3 (este cambio): SÓLO se instalan las cuentas. El motor de asientos
 * (cuenta-registry/cuenta-auto/prefijos) y los 4 reportes se reapuntan en las
 * etapas 2 (EECC) y 3 (flujos contables); por eso `rubroEECC` queda en null acá.
 *
 * `categoria` (5 valores, ecuación patrimonial legada) y `moneda` se DERIVAN de
 * la clase y de las flags; el modelo nuevo manda vía `clase`/`clasificacion`.
 *
 * Sin `import "server-only"`: importable desde `prisma/` (tsx) y el runtime.
 */

import { PLAN_CUENTAS_DATA } from "./plan-de-cuentas.data";

export type TipoCuenta = "SINTETICA" | "ANALITICA";
/** Categoría legada (ecuación patrimonial / Balance). Derivada de la clase. */
export type CategoriaCuenta = "ACTIVO" | "PASIVO" | "PATRIMONIO" | "INGRESO" | "EGRESO";
/** Naturaleza del saldo. MIXTA y SISTEMA_VARIABLE para resultados/cierre. */
export type NaturalezaCuenta = "DEUDOR" | "ACREEDOR" | "MIXTA" | "SISTEMA_VARIABLE";
export type MonedaCuenta = "ARS" | "USD" | "BI" | "ME";
/** Agrupamiento de exposición del Balance (corriente/no corriente/resultado). */
export type ClasificacionCuenta =
  | "ACTIVO"
  | "PASIVO"
  | "CORRIENTE"
  | "NO_CORRIENTE"
  | "PATRIMONIO_NETO"
  | "RESULTADO";
/** Imputabilidad: ¿la cuenta recibe asientos directos? */
export type ImputacionCuenta = "IMPUTABLE" | "NO_IMPUTABLE" | "SOLO_SISTEMA";

/**
 * Una cuenta del plan, 1:1 con las columnas del Excel maestro (salvo
 * `nivel`/`padreCodigo`/`categoria`/`moneda`, que se derivan). El dato concreto
 * vive en `PLAN_CUENTAS_DATA` (generado); este tipo es su contrato.
 */
export type CuentaPlan = {
  /** Orden de exhibición (1..631) — manda el orden de los EECC (etapa 2). */
  orden: number;
  codigo: string;
  nombre: string;
  /** Clase contable 1..9 (= primer dígito del código). */
  clase: number;
  clasificacion: ClasificacionCuenta;
  tipo: TipoCuenta;
  /** Explícita en el Excel (regularizadoras invertidas, resultados mixtos). */
  naturaleza: NaturalezaCuenta;
  imputacion: ImputacionCuenta;
  /** Cuenta retificadora (depreciaciones/previsiones/deducciones). */
  regularizadora: boolean;
  /** Acumula ARS + ME (revalúo al cierre). */
  bimonetaria: boolean;
  /** Moneda extranjera pura. */
  monedaExtranjera: boolean;
  /** Recibe bienes en especie. */
  enEspecie: boolean;
  /** Vincula la cuenta con el stock (bienes de cambio). */
  inventariable: boolean;
  /** Movida sólo por el sistema (cierre, Ley 25.413). */
  sistema: boolean;
  /** Recibe subcuentas generadas en runtime (bancos, clientes, proveedores…). */
  dinamica: boolean;
};

/**
 * Categoría contable (5 valores, ecuación patrimonial) por clase. Las clases de
 * resultado (5-9) caen a EGRESO a efectos de la ecuación; la SECCIÓN fina del
 * Estado de Resultados la determinan `clase`/`clasificacion`/`rubroEECC` (etapa
 * 2), no esta categoría.
 */
const CATEGORIA_POR_CLASE: Record<number, CategoriaCuenta> = {
  1: "ACTIVO",
  2: "PASIVO",
  3: "PATRIMONIO",
  4: "INGRESO",
  5: "EGRESO",
  6: "EGRESO",
  7: "EGRESO",
  8: "EGRESO",
  9: "EGRESO",
};

/** Categoría legada (5 valores) derivada de la clase 1-9. */
export function categoriaPorClase(clase: number): CategoriaCuenta {
  return CATEGORIA_POR_CLASE[clase] ?? "EGRESO";
}

/**
 * Clasificaciones de exposición del Balance válidas por clase (el Excel maestro
 * las cumple 100%). Activo/Pasivo sólo en la raíz; el resto del activo/pasivo es
 * corriente/no corriente; PN siempre PATRIMONIO_NETO; las clases 4-9 son RESULTADO.
 */
const CLASIFICACIONES_POR_CLASE: Record<number, readonly ClasificacionCuenta[]> = {
  1: ["ACTIVO", "CORRIENTE", "NO_CORRIENTE"],
  2: ["PASIVO", "CORRIENTE", "NO_CORRIENTE"],
  3: ["PATRIMONIO_NETO"],
  4: ["RESULTADO"],
  5: ["RESULTADO"],
  6: ["RESULTADO"],
  7: ["RESULTADO"],
  8: ["RESULTADO"],
  9: ["RESULTADO"],
};

/** ACTIVO/EGRESO → DEUDOR; PASIVO/PATRIMONIO/INGRESO → ACREEDOR. */
export function naturalezaPorDefecto(categoria: CategoriaCuenta): "DEUDOR" | "ACREEDOR" {
  return categoria === "ACTIVO" || categoria === "EGRESO" ? "DEUDOR" : "ACREEDOR";
}

/** Moneda funcional derivada de las flags: ME pura > bimonetaria > ARS (null). */
export function monedaDeCuenta(c: CuentaPlan): MonedaCuenta | null {
  if (c.monedaExtranjera) return "ME";
  if (c.bimonetaria) return "BI";
  return null;
}

/** Registro que el seed escribe en `CuentaContable` (1:1 con sus columnas). */
export type CuentaSeedRecord = {
  codigo: string;
  nombre: string;
  tipo: TipoCuenta;
  categoria: CategoriaCuenta;
  clase: number;
  clasificacion: ClasificacionCuenta;
  orden: number;
  nivel: number;
  padreCodigo: string | null;
  activa: boolean;
  naturaleza: NaturalezaCuenta;
  moneda: MonedaCuenta | null;
  imputacion: ImputacionCuenta;
  regularizadora: boolean;
  bimonetaria: boolean;
  monedaExtranjera: boolean;
  enEspecie: boolean;
  inventariable: boolean;
  sistema: boolean;
  dinamica: boolean;
  rubroEECC: string | null;
};

/**
 * Proyecta una `CuentaPlan` al registro de `CuentaContable`: deriva `nivel`
 * (segmentos del código), `padreCodigo` (todo antes del último "."), `categoria`
 * (legada, por clase) y `moneda` (por flags). `rubroEECC` = null en esta etapa
 * (lo fija la etapa 2/EECC).
 */
export function planEntryToSeedRecord(c: CuentaPlan): CuentaSeedRecord {
  const i = c.codigo.lastIndexOf(".");
  return {
    codigo: c.codigo,
    nombre: c.nombre,
    tipo: c.tipo,
    categoria: categoriaPorClase(c.clase),
    clase: c.clase,
    clasificacion: c.clasificacion,
    orden: c.orden,
    nivel: c.codigo.split(".").length,
    padreCodigo: i === -1 ? null : c.codigo.slice(0, i),
    activa: true,
    naturaleza: c.naturaleza,
    moneda: monedaDeCuenta(c),
    imputacion: c.imputacion,
    regularizadora: c.regularizadora,
    bimonetaria: c.bimonetaria,
    monedaExtranjera: c.monedaExtranjera,
    enEspecie: c.enEspecie,
    inventariable: c.inventariable,
    sistema: c.sistema,
    dinamica: c.dinamica,
    rubroEECC: null,
  };
}

/** El plan completo (631 cuentas). Dato generado desde el Excel maestro. */
export const PLAN_CUENTAS: readonly CuentaPlan[] = PLAN_CUENTAS_DATA;

/** Alias temporal para importadores que aún referencian el nombre RT9. */
export const PLAN_RT9 = PLAN_CUENTAS;

/** Un problema de consistencia detectado por el guard. */
export type ProblemaPlan = { codigo: string; regla: string; detalle: string };

/**
 * Guard del plan: invariantes estructurales (las que el Excel maestro cumple
 * 100%). Devuelve la lista de problemas; vacía = plan consistente. Reglas:
 *  - R_DUP: códigos únicos.
 *  - R_ORDEN: `orden` único.
 *  - R_CLASE: `clase` = primer dígito del código.
 *  - R_CLASIF: `clasificacion` válida para la clase.
 *  - R_ORFA: toda cuenta con padre tiene a ese padre declarado y SINTÉTICA.
 *  - R_IMPUT: SINTÉTICA ⇒ no imputable; ANALÍTICA ⇒ imputable o solo-sistema.
 *  - R_INVENTARIABLE: sólo cuentas de ACTIVO (clase 1) pueden ser inventariables.
 *  - R_REGULARIZADORA: una regularizadora con naturaleza deudor/acreedor la tiene
 *    invertida respecto del default de su categoría.
 */
export function validarPlan(plan: readonly CuentaPlan[]): ProblemaPlan[] {
  const out: ProblemaPlan[] = [];
  const porCodigo = new Map<string, CuentaPlan>();
  const porOrden = new Map<number, string>();
  for (const c of plan) {
    if (porCodigo.has(c.codigo)) {
      out.push({ codigo: c.codigo, regla: "R_DUP", detalle: "código duplicado" });
    }
    porCodigo.set(c.codigo, c);
    const prev = porOrden.get(c.orden);
    if (prev !== undefined) {
      out.push({
        codigo: c.codigo,
        regla: "R_ORDEN",
        detalle: `orden ${c.orden} ya usado por ${prev}`,
      });
    } else {
      porOrden.set(c.orden, c.codigo);
    }
  }
  const sinteticas = new Set(plan.filter((c) => c.tipo === "SINTETICA").map((c) => c.codigo));

  for (const c of plan) {
    const segs = c.codigo.split(".");

    if (c.clase !== Number(segs[0])) {
      out.push({
        codigo: c.codigo,
        regla: "R_CLASE",
        detalle: `clase ${c.clase} ≠ dígito raíz ${segs[0]}`,
      });
    }

    const clasifOk = CLASIFICACIONES_POR_CLASE[c.clase];
    if (clasifOk && !clasifOk.includes(c.clasificacion)) {
      out.push({
        codigo: c.codigo,
        regla: "R_CLASIF",
        detalle: `clasificacion ${c.clasificacion} no válida para clase ${c.clase}`,
      });
    }

    if (segs.length > 1) {
      const padre = segs.slice(0, -1).join(".");
      if (!porCodigo.has(padre)) {
        out.push({ codigo: c.codigo, regla: "R_ORFA", detalle: `padre ${padre} inexistente` });
      } else if (!sinteticas.has(padre)) {
        out.push({ codigo: c.codigo, regla: "R_ORFA", detalle: `padre ${padre} no es SINTÉTICA` });
      }
    }

    if (c.tipo === "SINTETICA" && c.imputacion === "IMPUTABLE") {
      out.push({ codigo: c.codigo, regla: "R_IMPUT", detalle: "sintética marcada imputable" });
    }
    if (c.tipo === "ANALITICA" && c.imputacion === "NO_IMPUTABLE") {
      out.push({ codigo: c.codigo, regla: "R_IMPUT", detalle: "analítica marcada no imputable" });
    }

    if (c.inventariable && c.clase !== 1) {
      out.push({
        codigo: c.codigo,
        regla: "R_INVENTARIABLE",
        detalle: `inventariable fuera de ACTIVO (clase ${c.clase})`,
      });
    }

    if (c.regularizadora && (c.naturaleza === "DEUDOR" || c.naturaleza === "ACREEDOR")) {
      const def = naturalezaPorDefecto(categoriaPorClase(c.clase));
      if (c.naturaleza === def) {
        out.push({
          codigo: c.codigo,
          regla: "R_REGULARIZADORA",
          detalle: `regularizadora con naturaleza ${def} (= default); debe ser la opuesta`,
        });
      }
    }
  }
  return out;
}
