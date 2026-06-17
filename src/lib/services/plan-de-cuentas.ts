/**
 * Plan de cuentas ULTRA-ESTRUCTURADO (9 clases) — FUENTE ÚNICA estructurada.
 *
 * Reemplaza el plan RT9 de 5 clases por el modelo ULTRA de 9 clases contables
 * independientes (RT9/RT17/RT6 FACPCE): 4 Ingresos · 5 Costo de Ventas ·
 * 6 Gastos de Comercialización · 7 Gastos de Administración · 8 Otros
 * Resultados (incl. Impuesto a las Ganancias) · 9 Resultados Financieros y por
 * Tenencia. El plan vive aquí como dato, no disperso en seed/registry/hardcodes.
 * Lo consumen: el seed (`prisma/seed-plan-cuentas.ts`), el registry (mapas de
 * códigos canónicos), el guard de CI (`validarPlan`) y los reportes
 * (rubro/naturaleza/cascada del Estado de Resultados).
 *
 * ADAPTACIONES respecto del documento "ULTRA" (ver ADR
 * `04-decisions/2026-06-17-parecer-divergencias-plan-ultra.md`):
 *  - Subledger NUMÉRICO (no códigos-slug `{NOMBRE}`): clientes/proveedores/
 *    bancos/gastos-por-proveedor nacen en runtime como sufijo numérico bajo su
 *    padre (ver `cuenta-auto.ts`). Las plantillas `P {…}` del documento NO se
 *    siembran.
 *  - Las cuentas que el motor IMPUTA directamente y el documento modela como
 *    agrupadores dinámicos (estoque en tránsito/ZP/DF/a entregar, anticipos a
 *    proveedores, honorarios canónicos) se declaran ANALÍTICAS imputables —
 *    preserva el motor sin reescribir la auto-creación.
 *  - Capitalización DIRECTA al estoque (sin el pool landed-cost 1.1.7.08).
 *
 * Sin `import "server-only"`: importable desde `prisma/` (tsx) y el runtime.
 */

export type TipoCuenta = "SINTETICA" | "ANALITICA";
export type CategoriaCuenta = "ACTIVO" | "PASIVO" | "PATRIMONIO" | "INGRESO" | "EGRESO";
export type NaturalezaCuenta = "DEUDOR" | "ACREEDOR";
export type MonedaCuenta = "ARS" | "USD" | "BI" | "ME";

export type CuentaPlan = {
  codigo: string;
  nombre: string;
  tipo: TipoCuenta;
  categoria: CategoriaCuenta;
  /** Explícita en regularizadoras y en resultados mixtos (clases 8/9). */
  naturaleza?: NaturalezaCuenta;
  /** USD/BI/ME en cuentas con moneda extranjera (revalúo al cierre). Default ARS. */
  moneda?: MonedaCuenta;
  /** Rubro de exposición EECC. Manda sobre el árbol de código en los reportes. */
  rubroEECC?: string;
  /** true en Bienes de Cambio (1.1.7.x): puede recibir costo landed. */
  inventariable?: boolean;
};

/**
 * Categoría contable (agrupamiento de la ecuación patrimonial / Balance) por
 * dígito raíz. Las clases de resultado del Estado de Resultados (5 Costo,
 * 6 Comerc, 7 Adm, 8 Otros, 9 Financieros) son todas EGRESO/INGRESO a efectos
 * de la ecuación — la SECCIÓN fina del EERR la determina el código/`rubroEECC`,
 * no la categoría (ver reportes/estado-resultados). Las clases mixtas 8 y 9
 * (tienen ingresos y egresos) NO están acá: cada cuenta fija su categoría
 * explícita; así el guard R2 no las controla por dígito.
 */
const CATEGORIA_POR_DIGITO: Record<string, CategoriaCuenta> = {
  "1": "ACTIVO",
  "2": "PASIVO",
  "3": "PATRIMONIO",
  "4": "INGRESO",
  "5": "EGRESO",
  "6": "EGRESO",
  "7": "EGRESO",
};

/** ACTIVO/EGRESO → DEUDOR; PASIVO/PATRIMONIO/INGRESO → ACREEDOR. */
export function naturalezaPorDefecto(categoria: CategoriaCuenta): NaturalezaCuenta {
  return categoria === "ACTIVO" || categoria === "EGRESO" ? "DEUDOR" : "ACREEDOR";
}

/** Registro que el seed escribe en `CuentaContable` (1:1 con sus columnas). */
export type CuentaSeedRecord = {
  codigo: string;
  nombre: string;
  tipo: TipoCuenta;
  categoria: CategoriaCuenta;
  nivel: number;
  padreCodigo: string | null;
  activa: boolean;
  naturaleza: NaturalezaCuenta;
  moneda: MonedaCuenta | null;
  rubroEECC: string | null;
};

/**
 * Proyecta una `CuentaPlan` al registro de `CuentaContable` que siembra el seed:
 * deriva `nivel` (segmentos del código) y `padreCodigo` (todo antes del último
 * "."), resuelve `naturaleza` (explícita, o default por categoría) y normaliza
 * `moneda`/`rubroEECC` a null. `inventariable` NO se persiste (sólo lo usa el guard).
 */
export function planEntryToSeedRecord(c: CuentaPlan): CuentaSeedRecord {
  const i = c.codigo.lastIndexOf(".");
  return {
    codigo: c.codigo,
    nombre: c.nombre,
    tipo: c.tipo,
    categoria: c.categoria,
    nivel: c.codigo.split(".").length,
    padreCodigo: i === -1 ? null : c.codigo.slice(0, i),
    activa: true,
    naturaleza: c.naturaleza ?? naturalezaPorDefecto(c.categoria),
    moneda: c.moneda ?? null,
    rubroEECC: c.rubroEECC ?? null,
  };
}

/** Default por dígito; 8/9 (mixtas) caen a EGRESO salvo override explícito. */
function categoriaPorCodigo(codigo: string): CategoriaCuenta {
  return CATEGORIA_POR_DIGITO[codigo[0]] ?? "EGRESO";
}

/** Sintética (agrupadora). `categoria` opcional para raíces de clases 8/9. */
function s(codigo: string, nombre: string, categoria?: CategoriaCuenta): CuentaPlan {
  return { codigo, nombre, tipo: "SINTETICA", categoria: categoria ?? categoriaPorCodigo(codigo) };
}
/** Analítica (recibe asientos). `opts` para categoria/naturaleza/moneda/rubro/inventariable. */
function a(codigo: string, nombre: string, opts: Partial<CuentaPlan> = {}): CuentaPlan {
  return { codigo, nombre, tipo: "ANALITICA", categoria: categoriaPorCodigo(codigo), ...opts };
}

// Rubros EECC reutilizados (exposición de Estados Contables).
const R_CYB = "Caja y bancos";
const R_INV = "Inversiones financieras";
const R_CXV = "Créditos por ventas";
const R_FISC = "Otros créditos fiscales";
const R_ADU = "Créditos aduaneros";
const R_OC = "Otros créditos";
const R_BC = "Bienes de cambio";
const R_DC = "Deudas comerciales";
const R_DSOC = "Deudas sociales";
const R_DFISC = "Deudas fiscales";
const R_DFIN = "Deudas financieras";
const R_VENTAS = "Ventas netas";
const R_COSTO = "Costo de ventas";
const R_COM = "Gastos de comercialización";
const R_ADM = "Gastos de administración";
const R_OR = "Otros resultados";
const R_IG = "Impuesto a las ganancias";
const R_RF = "Resultados financieros y por tenencia";

export const PLAN_CUENTAS: readonly CuentaPlan[] = [
  // ============================= 1 · ACTIVO =============================
  s("1", "ACTIVO"),
  s("1.1", "ACTIVO CORRIENTE"),
  // --- 1.1.1 Caja y Bancos ---
  s("1.1.1", "CAJA Y BANCOS"),
  s("1.1.1.01", "CAJA Y FONDOS FIJOS"),
  a("1.1.1.01.01", "CAJA GENERAL — ARS", { rubroEECC: R_CYB }),
  a("1.1.1.01.02", "FONDO FIJO — ARS", { rubroEECC: R_CYB }),
  a("1.1.1.01.03", "COBRANZAS EN EFECTIVO PENDIENTES DE RENDICIÓN", { rubroEECC: R_CYB }),
  a("1.1.1.01.91", "CAJA — USD", { moneda: "USD", rubroEECC: R_CYB }),
  a("1.1.1.01.92", "CAJA — OTRAS MONEDAS", { moneda: "ME", rubroEECC: R_CYB }),
  // Bancos: las cuentas individuales nacen como 1.1.1.02.NN (ver cuenta-auto BANCO).
  s("1.1.1.02", "BANCOS"),
  a("1.1.1.02.06", "TRANSFERENCIAS BANCARIAS EN TRÁNSITO", { moneda: "BI", rubroEECC: R_CYB }),
  a("1.1.1.02.07", "COBRANZAS BANCARIAS A IDENTIFICAR", { moneda: "BI", rubroEECC: R_CYB }),
  s("1.1.1.03", "VALORES A DEPOSITAR"),
  a("1.1.1.03.01", "CHEQUES DE TERCEROS AL DÍA", { rubroEECC: R_CYB }),
  a("1.1.1.03.02", "CHEQUES DE PAGO DIFERIDO", { rubroEECC: R_CYB }),
  a("1.1.1.03.03", "E-CHEQ A DEPOSITAR", { rubroEECC: R_CYB }),
  a("1.1.1.03.04", "CUPONES Y LIQUIDACIONES DE TARJETAS A ACREDITAR", { rubroEECC: R_CYB }),
  a("1.1.1.03.09", "VALORES RECHAZADOS A RECUPERAR", { rubroEECC: R_OC }),
  // --- 1.1.2 Inversiones financieras corrientes ---
  s("1.1.2", "INVERSIONES FINANCIERAS CORRIENTES"),
  a("1.1.2.01", "FONDOS COMUNES DE INVERSIÓN", { moneda: "BI", rubroEECC: R_INV }),
  a("1.1.2.02", "PLAZOS FIJOS", { moneda: "BI", rubroEECC: R_INV }),
  a("1.1.2.03", "TÍTULOS PÚBLICOS Y OBLIGACIONES NEGOCIABLES", { moneda: "BI", rubroEECC: R_INV }),
  a("1.1.2.04", "INTERESES Y RENDIMIENTOS DEVENGADOS A COBRAR", { moneda: "BI", rubroEECC: R_INV }),
  s("1.1.2.09", "PARTIDAS REGULARIZADORAS DE INVERSIONES"),
  a("1.1.2.09.01", "(-) COMPONENTES FINANCIEROS NO DEVENGADOS — INVERSIONES", {
    naturaleza: "ACREEDOR",
    moneda: "BI",
    rubroEECC: R_INV,
  }),
  a("1.1.2.09.02", "(-) DETERIORO DE INVERSIONES FINANCIERAS CORRIENTES", {
    naturaleza: "ACREEDOR",
    moneda: "BI",
    rubroEECC: R_INV,
  }),
  // --- 1.1.3 Cuentas por cobrar a clientes ---
  s("1.1.3", "CUENTAS POR COBRAR A CLIENTES"),
  // Las cuentas por-cliente nacen como 1.1.3.01.NN / 1.1.3.02.NN (ver cuenta-auto
  // CLIENTE_*). La `.01` es el fallback genérico (mostrador / sin cuenta propia).
  s("1.1.3.01", "DEUDORES POR VENTAS NACIONALES"),
  a("1.1.3.01.01", "DEUDORES POR VENTAS (GENÉRICO)", { rubroEECC: R_CXV }),
  s("1.1.3.02", "DEUDORES POR VENTAS DEL EXTERIOR"),
  a("1.1.3.02.01", "DEUDORES POR VENTAS EXTERIOR (GENÉRICO)", { moneda: "ME", rubroEECC: R_CXV }),
  s("1.1.3.03", "DOCUMENTOS A COBRAR DE CLIENTES"),
  s("1.1.3.04", "DERECHOS A FACTURAR A CLIENTES"),
  s("1.1.3.05", "TARJETAS Y MEDIOS DE COBRO A LIQUIDAR"),
  a("1.1.3.06", "NOTAS DE DÉBITO A EMITIR", { moneda: "BI", rubroEECC: R_CXV }),
  s("1.1.3.07", "DEUDORES EN GESTIÓN JUDICIAL"),
  s("1.1.3.09", "PARTIDAS REGULARIZADORAS DE CRÉDITOS POR VENTAS"),
  a("1.1.3.09.01", "(-) PREVISIÓN PARA CRÉDITOS DE COBRO DUDOSO", {
    naturaleza: "ACREEDOR",
    moneda: "BI",
    rubroEECC: R_CXV,
  }),
  a("1.1.3.09.02", "(-) COMPONENTES FINANCIEROS NO DEVENGADOS — CLIENTES", {
    naturaleza: "ACREEDOR",
    moneda: "BI",
    rubroEECC: R_CXV,
  }),
  a("1.1.3.09.03", "(-) BONIFICACIONES Y NOTAS DE CRÉDITO A EMITIR", {
    naturaleza: "ACREEDOR",
    moneda: "BI",
    rubroEECC: R_CXV,
  }),
  // --- 1.1.4 Créditos impositivos y aduaneros ---
  s("1.1.4", "CRÉDITOS IMPOSITIVOS Y ADUANEROS"),
  s("1.1.4.1", "IMPUESTO AL VALOR AGREGADO"),
  a("1.1.4.1.01", "IVA CRÉDITO FISCAL — COMPRAS LOCALES", { rubroEECC: R_FISC }),
  a("1.1.4.1.02", "IVA RETENCIONES SUFRIDAS", { rubroEECC: R_FISC }),
  a("1.1.4.1.03", "IVA CRÉDITO FISCAL — IMPORTACIONES", { rubroEECC: R_FISC }),
  a("1.1.4.1.04", "IVA PERCEPCIÓN ADICIONAL — IMPORTACIONES", { rubroEECC: R_FISC }),
  a("1.1.4.1.05", "IVA PERCEPCIONES SUFRIDAS — COMPRAS", { rubroEECC: R_FISC }),
  a("1.1.4.1.06", "IVA PERCEPCIÓN RG 2408 (BANCARIA)", { rubroEECC: R_FISC }),
  a("1.1.4.1.07", "IVA SALDO TÉCNICO A FAVOR", { rubroEECC: R_FISC }),
  a("1.1.4.1.08", "IVA SALDO DE LIBRE DISPONIBILIDAD", { rubroEECC: R_FISC }),
  s("1.1.4.2", "INGRESOS BRUTOS"),
  a("1.1.4.2.01", "IIBB PERCEPCIÓN SUFRIDA — IMPORTACIONES", { rubroEECC: R_FISC }),
  a("1.1.4.2.02", "IIBB PERCEPCIONES SUFRIDAS — COMPRAS", { rubroEECC: R_FISC }),
  a("1.1.4.2.03", "IIBB RECAUDACIONES BANCARIAS — SIRCREB", { rubroEECC: R_FISC }),
  a("1.1.4.2.04", "IIBB RETENCIONES SUFRIDAS", { rubroEECC: R_FISC }),
  s("1.1.4.2.05", "IIBB SALDO A FAVOR POR JURISDICCIÓN"),
  s("1.1.4.3", "IMPUESTO A LAS GANANCIAS"),
  a("1.1.4.3.01", "GANANCIAS PERCEPCIÓN SUFRIDA — IMPORTACIONES", { rubroEECC: R_FISC }),
  a("1.1.4.3.02", "IMPUESTO LEY 25.413 COMPUTABLE", { rubroEECC: R_FISC }),
  a("1.1.4.3.03", "GANANCIAS RETENCIONES SUFRIDAS", { rubroEECC: R_FISC }),
  a("1.1.4.3.04", "GANANCIAS ANTICIPOS INGRESADOS", { rubroEECC: R_FISC }),
  a("1.1.4.3.05", "GANANCIAS SALDO A FAVOR", { rubroEECC: R_FISC }),
  s("1.1.4.4", "CRÉDITOS ADUANEROS"),
  a("1.1.4.4.01", "SALDO A FAVOR EN CUENTA ADUANERA / VEP", { rubroEECC: R_ADU }),
  a("1.1.4.4.02", "REINTEGROS ADUANEROS A COBRAR", { rubroEECC: R_ADU }),
  a("1.1.4.4.03", "GARANTÍAS ADUANERAS RECUPERABLES — CORRIENTE", {
    moneda: "BI",
    rubroEECC: R_ADU,
  }),
  s("1.1.4.5", "OTROS CRÉDITOS FISCALES"),
  s("1.1.4.5.01", "IMPUESTOS NACIONALES A FAVOR"),
  s("1.1.4.5.02", "IMPUESTOS PROVINCIALES A FAVOR"),
  a("1.1.4.5.03", "TASAS MUNICIPALES A FAVOR", { rubroEECC: R_FISC }),
  // --- 1.1.5 Otras cuentas por cobrar ---
  s("1.1.5", "OTRAS CUENTAS POR COBRAR"),
  a("1.1.5.01", "ANTICIPOS A PROVEEDORES DE SERVICIOS", { moneda: "BI", rubroEECC: R_OC }),
  a("1.1.5.02", "ANTICIPOS Y PRÉSTAMOS AL PERSONAL", { moneda: "BI", rubroEECC: R_OC }),
  s("1.1.5.03", "CRÉDITOS CON SOCIOS, DIRECTORES Y PARTES RELACIONADAS"),
  s("1.1.5.04", "GASTOS PAGADOS POR ADELANTADO"),
  a("1.1.5.04.01", "SEGUROS PAGADOS POR ADELANTADO", { rubroEECC: R_OC }),
  a("1.1.5.04.02", "ALQUILERES PAGADOS POR ADELANTADO", { rubroEECC: R_OC }),
  a("1.1.5.04.03", "LICENCIAS Y SUSCRIPCIONES PAGADAS POR ADELANTADO", {
    moneda: "BI",
    rubroEECC: R_OC,
  }),
  a("1.1.5.04.99", "OTROS GASTOS PAGADOS POR ADELANTADO", { moneda: "BI", rubroEECC: R_OC }),
  s("1.1.5.05", "DEPÓSITOS Y GARANTÍAS RECUPERABLES — CORRIENTE"),
  a("1.1.5.06", "SINIESTROS, RECLAMOS Y RECUPEROS A COBRAR", { moneda: "BI", rubroEECC: R_OC }),
  s("1.1.5.08", "SALDOS DEUDORES DIVERSOS"),
  s("1.1.5.09", "PARTIDAS REGULARIZADORAS DE OTROS CRÉDITOS"),
  a("1.1.5.09.01", "(-) PREVISIÓN PARA OTROS CRÉDITOS DE COBRO DUDOSO", {
    naturaleza: "ACREEDOR",
    moneda: "BI",
    rubroEECC: R_OC,
  }),
  // --- 1.1.7 Bienes de cambio (estoque) ---
  s("1.1.7", "BIENES DE CAMBIO"),
  // Stock nacionalizado: cuenta ÚNICA imputable (el motor COMEX nacionaliza acá:
  // 1.1.7.04/03 → 1.1.7.01). El split por tipo de neumático es de Ventas/CMV
  // (P&L, clases 4 y 5), NO del stock.
  a("1.1.7.01", "MERCADERÍAS NACIONALIZADAS", {
    moneda: "BI",
    inventariable: true,
    rubroEECC: R_BC,
  }),
  a("1.1.7.02", "IMPORTACIONES EMBARCADAS / EN TRÁNSITO", {
    moneda: "BI",
    inventariable: true,
    rubroEECC: R_BC,
  }),
  a("1.1.7.03", "MERCADERÍAS EN PUERTO / ZONA PRIMARIA", {
    moneda: "BI",
    inventariable: true,
    rubroEECC: R_BC,
  }),
  a("1.1.7.04", "MERCADERÍAS EN DEPÓSITO FISCAL", {
    moneda: "BI",
    inventariable: true,
    rubroEECC: R_BC,
  }),
  a("1.1.7.05", "MERCADERÍAS A ENTREGAR", { moneda: "BI", inventariable: true, rubroEECC: R_BC }),
  s("1.1.7.06", "MERCADERÍAS EN PODER DE TERCEROS"),
  a("1.1.7.06.03", "MERCADERÍAS BLOQUEADAS / EN INSPECCIÓN", {
    moneda: "BI",
    inventariable: true,
    rubroEECC: R_BC,
  }),
  a("1.1.7.06.04", "DEVOLUCIONES DE CLIENTES PENDIENTES DE INSPECCIÓN", {
    moneda: "BI",
    inventariable: true,
    rubroEECC: R_BC,
  }),
  a("1.1.7.07", "ANTICIPOS A PROVEEDORES DE BIENES DE CAMBIO", { moneda: "BI", rubroEECC: R_BC }),
  s("1.1.7.09", "PARTIDAS REGULARIZADORAS DE BIENES DE CAMBIO"),
  a("1.1.7.09.01", "(-) DESVALORIZACIÓN A VALOR RECUPERABLE / VNR", {
    naturaleza: "ACREEDOR",
    moneda: "BI",
    rubroEECC: R_BC,
  }),
  a("1.1.7.09.02", "(-) PREVISIÓN POR OBSOLESCENCIA", {
    naturaleza: "ACREEDOR",
    moneda: "BI",
    rubroEECC: R_BC,
  }),
  a("1.1.7.09.03", "(-) PREVISIÓN POR LENTO MOVIMIENTO", {
    naturaleza: "ACREEDOR",
    moneda: "BI",
    rubroEECC: R_BC,
  }),
  // --- 1.1.9 Otros activos corrientes ---
  s("1.1.9", "OTROS ACTIVOS CORRIENTES"),
  s("1.1.9.01", "ACTIVOS NO CORRIENTES MANTENIDOS PARA LA VENTA"),
  a("1.1.9.99", "OTROS ACTIVOS CORRIENTES", { moneda: "BI", rubroEECC: "Otros activos" }),
  // --- 1.2 Activo No Corriente ---
  s("1.2", "ACTIVO NO CORRIENTE"),
  s("1.2.1", "INVERSIONES FINANCIERAS NO CORRIENTES"),
  s("1.2.1.01", "TÍTULOS E INSTRUMENTOS FINANCIEROS NO CORRIENTES"),
  s("1.2.1.02", "PARTICIPACIONES EN SOCIEDADES Y PARTES RELACIONADAS"),
  a("1.2.1.03", "FONDOS RESTRINGIDOS — NO CORRIENTES", {
    moneda: "BI",
    rubroEECC: "Inversiones no corrientes",
  }),
  a("1.2.1.09", "(-) DETERIORO DE INVERSIONES NO CORRIENTES", {
    naturaleza: "ACREEDOR",
    moneda: "BI",
    rubroEECC: "Inversiones no corrientes",
  }),
  s("1.2.2", "CUENTAS POR COBRAR NO CORRIENTES"),
  s("1.2.2.01", "CRÉDITOS POR VENTAS NO CORRIENTES"),
  s("1.2.2.03", "DEPÓSITOS Y GARANTÍAS RECUPERABLES — NO CORRIENTES"),
  a("1.2.2.09", "(-) DETERIORO DE CUENTAS POR COBRAR NO CORRIENTES", {
    naturaleza: "ACREEDOR",
    moneda: "BI",
    rubroEECC: "Créditos no corrientes",
  }),
  s("1.2.4", "BIENES DE USO"),
  a("1.2.4.01", "TERRENOS", { moneda: "BI", rubroEECC: "Bienes de uso" }),
  a("1.2.4.02", "EDIFICIOS", { moneda: "BI", rubroEECC: "Bienes de uso" }),
  a("1.2.4.03", "INSTALACIONES", { moneda: "BI", rubroEECC: "Bienes de uso" }),
  a("1.2.4.04", "MAQUINARIAS Y EQUIPOS", { moneda: "BI", rubroEECC: "Bienes de uso" }),
  a("1.2.4.05", "RODADOS", { moneda: "BI", rubroEECC: "Bienes de uso" }),
  a("1.2.4.06", "EQUIPOS DE COMPUTACIÓN", { moneda: "BI", rubroEECC: "Bienes de uso" }),
  a("1.2.4.07", "MUEBLES Y ÚTILES", { moneda: "BI", rubroEECC: "Bienes de uso" }),
  a("1.2.4.08", "MEJORAS EN INMUEBLES DE TERCEROS", { moneda: "BI", rubroEECC: "Bienes de uso" }),
  s("1.2.4.80", "DEPRECIACIONES ACUMULADAS"),
  a("1.2.4.80.02", "(-) DEPRECIACIÓN ACUMULADA — EDIFICIOS", {
    naturaleza: "ACREEDOR",
    moneda: "BI",
    rubroEECC: "Bienes de uso",
  }),
  a("1.2.4.80.04", "(-) DEPRECIACIÓN ACUMULADA — MAQUINARIAS Y EQUIPOS", {
    naturaleza: "ACREEDOR",
    moneda: "BI",
    rubroEECC: "Bienes de uso",
  }),
  a("1.2.4.80.05", "(-) DEPRECIACIÓN ACUMULADA — RODADOS", {
    naturaleza: "ACREEDOR",
    moneda: "BI",
    rubroEECC: "Bienes de uso",
  }),
  a("1.2.4.80.06", "(-) DEPRECIACIÓN ACUMULADA — EQUIPOS DE COMPUTACIÓN", {
    naturaleza: "ACREEDOR",
    moneda: "BI",
    rubroEECC: "Bienes de uso",
  }),
  a("1.2.4.80.07", "(-) DEPRECIACIÓN ACUMULADA — MUEBLES Y ÚTILES", {
    naturaleza: "ACREEDOR",
    moneda: "BI",
    rubroEECC: "Bienes de uso",
  }),
  s("1.2.6", "ACTIVOS INTANGIBLES"),
  a("1.2.6.01", "SOFTWARE Y LICENCIAS (ERP, SISTEMAS)", {
    moneda: "BI",
    rubroEECC: "Activos intangibles",
  }),
  a("1.2.6.04", "LLAVE DE NEGOCIO (VALOR LLAVE)", {
    moneda: "BI",
    rubroEECC: "Activos intangibles",
  }),
  a("1.2.6.80", "(-) AMORTIZACIÓN ACUMULADA DE INTANGIBLES", {
    naturaleza: "ACREEDOR",
    moneda: "BI",
    rubroEECC: "Activos intangibles",
  }),
  s("1.2.7", "ACTIVO POR IMPUESTO DIFERIDO"),
  a("1.2.7.01", "ACTIVO POR IMPUESTO A LAS GANANCIAS DIFERIDO", {
    rubroEECC: "Activo por impuesto diferido",
  }),
  s("1.2.8", "OTROS ACTIVOS NO CORRIENTES"),
  a("1.2.8.99", "OTROS ACTIVOS NO CORRIENTES DIVERSOS", {
    moneda: "BI",
    rubroEECC: "Otros activos no corrientes",
  }),

  // ============================= 2 · PASIVO =============================
  s("2", "PASIVO"),
  s("2.1", "PASIVO CORRIENTE"),
  // --- 2.1.1 Cuentas por pagar comerciales ---
  s("2.1.1", "CUENTAS POR PAGAR COMERCIALES"),
  // Las cuentas por-proveedor nacen como 2.1.1.01.NN (nacional) / 2.1.1.02.NN
  // (exterior) — ver cuenta-auto PROVEEDOR_*. La `.01` es el fallback genérico.
  s("2.1.1.01", "PROVEEDORES NACIONALES"),
  a("2.1.1.01.01", "PROVEEDORES LOCALES (GENÉRICO)", { rubroEECC: R_DC }),
  s("2.1.1.02", "PROVEEDORES DEL EXTERIOR"),
  a("2.1.1.02.01", "PROVEEDORES DEL EXTERIOR (GENÉRICO)", { moneda: "USD", rubroEECC: R_DC }),
  s("2.1.1.03", "PROVEEDORES PARTES RELACIONADAS (INTERCOMPANY)"),
  s("2.1.1.05", "PROVEEDORES DE SERVICIOS LOGÍSTICOS Y ADUANEROS"),
  a("2.1.1.05.01", "PROVEEDORES LOGÍSTICOS/ADUANEROS (GENÉRICO)", {
    moneda: "BI",
    rubroEECC: R_DC,
  }),
  a("2.1.1.06", "FACTURAS Y SERVICIOS A RECIBIR (PROVISIONADOS)", {
    moneda: "BI",
    rubroEECC: R_DC,
  }),
  a("2.1.1.07", "FLETES SOBRE VENTAS POR PAGAR", { moneda: "BI", rubroEECC: R_DC }),
  a("2.1.1.09", "(-) NOTAS DE CRÉDITO DE PROVEEDORES A RECIBIR", {
    naturaleza: "DEUDOR",
    moneda: "BI",
    rubroEECC: R_DC,
  }),
  // --- 2.1.2 Anticipos de clientes ---
  s("2.1.2", "ANTICIPOS DE CLIENTES"),
  a("2.1.2.01", "ANTICIPOS DE CLIENTES NACIONALES", {
    moneda: "BI",
    rubroEECC: "Anticipos de clientes",
  }),
  a("2.1.2.02", "ANTICIPOS DE CLIENTES DEL EXTERIOR", {
    moneda: "ME",
    rubroEECC: "Anticipos de clientes",
  }),
  // --- 2.1.3 Remuneraciones y cargas sociales ---
  s("2.1.3", "REMUNERACIONES Y CARGAS SOCIALES"),
  a("2.1.3.01", "SUELDOS Y JORNALES A PAGAR", { rubroEECC: R_DSOC }),
  a("2.1.3.02", "SAC A PAGAR", { rubroEECC: R_DSOC }),
  a("2.1.3.03", "PROVISIÓN PARA VACACIONES", { rubroEECC: R_DSOC }),
  a("2.1.3.04", "CARGAS SOCIALES A PAGAR (SUSS)", { rubroEECC: R_DSOC }),
  a("2.1.3.05", "SINDICATOS Y OBRAS SOCIALES A DEPOSITAR", { rubroEECC: R_DSOC }),
  a("2.1.3.06", "ART A PAGAR", { rubroEECC: R_DSOC }),
  a("2.1.3.07", "RETENCIONES AL PERSONAL A DEPOSITAR", { rubroEECC: R_DSOC }),
  // --- 2.1.4 Cargas fiscales ---
  s("2.1.4", "CARGAS FISCALES"),
  s("2.1.4.1", "IVA"),
  a("2.1.4.1.01", "IVA DÉBITO FISCAL", { rubroEECC: R_DFISC }),
  a("2.1.4.1.02", "IVA SALDO A PAGAR (POSICIÓN DEL PERÍODO)", { rubroEECC: R_DFISC }),
  a("2.1.4.1.03", "IVA PERCEPCIONES PRACTICADAS A DEPOSITAR", { rubroEECC: R_DFISC }),
  a("2.1.4.1.04", "IVA RETENCIONES PRACTICADAS A DEPOSITAR", { rubroEECC: R_DFISC }),
  s("2.1.4.2", "INGRESOS BRUTOS"),
  a("2.1.4.2.01", "IIBB A PAGAR", { rubroEECC: R_DFISC }),
  a("2.1.4.2.02", "IIBB CONVENIO MULTILATERAL A DEPOSITAR", { rubroEECC: R_DFISC }),
  a("2.1.4.2.03", "IIBB PERCEPCIONES/RETENCIONES PRACTICADAS A DEPOSITAR", { rubroEECC: R_DFISC }),
  s("2.1.4.3", "IMPUESTO A LAS GANANCIAS"),
  a("2.1.4.3.01", "IMPUESTO A LAS GANANCIAS A PAGAR (PROVISIÓN)", { rubroEECC: R_DFISC }),
  a("2.1.4.3.02", "GANANCIAS RETENCIONES PRACTICADAS A DEPOSITAR (SICORE)", { rubroEECC: R_DFISC }),
  s("2.1.4.4", "IMPUESTOS ADUANEROS A PAGAR"),
  a("2.1.4.4.01", "DERECHOS DE IMPORTACIÓN A PAGAR", { rubroEECC: R_DFISC }),
  a("2.1.4.4.02", "TASA ESTADÍSTICA A PAGAR", { rubroEECC: R_DFISC }),
  a("2.1.4.4.03", "ARANCEL SIM A PAGAR", { rubroEECC: R_DFISC }),
  a("2.1.4.4.04", "IVA IMPORTACIÓN A PAGAR", { rubroEECC: R_DFISC }),
  a("2.1.4.4.05", "PERCEPCIONES DE IMPORTACIÓN A PAGAR", { rubroEECC: R_DFISC }),
  a("2.1.4.4.99", "SALDO PENDIENTE ADUANA (REFUERZO VEP)", { rubroEECC: R_DFISC }),
  s("2.1.4.5", "OTROS IMPUESTOS Y TASAS"),
  a("2.1.4.5.01", "IMPUESTO A LOS DÉBITOS Y CRÉDITOS A PAGAR", { rubroEECC: R_DFISC }),
  a("2.1.4.5.02", "IMPUESTO DE SELLOS A PAGAR", { rubroEECC: R_DFISC }),
  a("2.1.4.5.03", "TASAS MUNICIPALES A PAGAR", { rubroEECC: R_DFISC }),
  a("2.1.4.5.99", "OTROS IMPUESTOS A PAGAR", { rubroEECC: R_DFISC }),
  // --- 2.1.5 Deudas financieras ---
  s("2.1.5", "DEUDAS FINANCIERAS"),
  s("2.1.5.01", "PRÉSTAMOS BANCARIOS — CORTO PLAZO"),
  s("2.1.5.02", "ADELANTOS EN CUENTA CORRIENTE / DESCUBIERTO"),
  a("2.1.5.05", "INTERESES A PAGAR DEVENGADOS", { moneda: "BI", rubroEECC: R_DFIN }),
  a("2.1.5.06", "PORCIÓN CORRIENTE DE DEUDAS FINANCIERAS NO CORRIENTES", {
    moneda: "BI",
    rubroEECC: R_DFIN,
  }),
  // --- 2.1.6 Deudas con partes relacionadas ---
  s("2.1.6", "DEUDAS CON PARTES RELACIONADAS"),
  s("2.1.6.01", "PRÉSTAMOS DE SOCIOS, DIRECTORES Y VINCULADAS — CP"),
  // --- 2.1.7 Otras cuentas por pagar ---
  s("2.1.7", "OTRAS CUENTAS POR PAGAR"),
  s("2.1.7.01", "ACREEDORES VARIOS"),
  a("2.1.7.02", "HONORARIOS A DIRECTORES Y SÍNDICOS A PAGAR", { rubroEECC: "Otras deudas" }),
  a("2.1.7.03", "DIVIDENDOS A PAGAR", { moneda: "BI", rubroEECC: "Otras deudas" }),
  a("2.1.7.05", "COBROS ANTICIPADOS E INGRESOS A DEVENGAR", {
    moneda: "BI",
    rubroEECC: "Otras deudas",
  }),
  // --- 2.1.8 Previsiones corrientes ---
  s("2.1.8", "PREVISIONES CORRIENTES"),
  a("2.1.8.01", "PREVISIÓN PARA JUICIOS Y RECLAMOS — CORRIENTE", {
    moneda: "BI",
    rubroEECC: "Previsiones",
  }),
  a("2.1.8.02", "PREVISIÓN PARA GARANTÍAS DE PRODUCTOS", {
    moneda: "BI",
    rubroEECC: "Previsiones",
  }),
  // --- 2.2 Pasivo No Corriente ---
  s("2.2", "PASIVO NO CORRIENTE"),
  s("2.2.1", "DEUDAS COMERCIALES NO CORRIENTES"),
  s("2.2.2", "DEUDAS FINANCIERAS NO CORRIENTES"),
  s("2.2.2.01", "PRÉSTAMOS BANCARIOS — LARGO PLAZO"),
  s("2.2.2.02", "PRÉSTAMOS DEL EXTERIOR — LARGO PLAZO"),
  s("2.2.3", "DEUDAS CON PARTES RELACIONADAS NO CORRIENTES"),
  s("2.2.4", "CARGAS FISCALES NO CORRIENTES"),
  s("2.2.5", "PASIVO POR IMPUESTO DIFERIDO"),
  a("2.2.5.01", "PASIVO POR IMPUESTO A LAS GANANCIAS DIFERIDO", {
    rubroEECC: "Pasivo por impuesto diferido",
  }),
  s("2.2.6", "PREVISIONES NO CORRIENTES"),
  a("2.2.6.01", "PREVISIÓN PARA INDEMNIZACIONES POR DESPIDO", { rubroEECC: "Previsiones NC" }),
  a("2.2.6.02", "PREVISIÓN PARA JUICIOS Y CONTINGENCIAS — NO CORRIENTE", {
    moneda: "BI",
    rubroEECC: "Previsiones NC",
  }),

  // ========================= 3 · PATRIMONIO NETO =========================
  s("3", "PATRIMONIO NETO"),
  s("3.1", "APORTES DE LOS PROPIETARIOS"),
  a("3.1.01", "CAPITAL SOCIAL", { rubroEECC: "Aportes — Capital" }),
  a("3.1.02", "APORTES IRREVOCABLES A CUENTA DE FUTURAS SUSCRIPCIONES", {
    rubroEECC: "Aportes — Capital",
  }),
  a("3.1.03", "AJUSTE DE CAPITAL (REEXPRESIÓN RT 6)", { rubroEECC: "Aportes — Ajuste de capital" }),
  a("3.1.04", "PRIMA DE EMISIÓN", { rubroEECC: "Aportes — Primas" }),
  a("3.1.06", "(-) ACCIONES PROPIAS EN CARTERA", {
    naturaleza: "DEUDOR",
    rubroEECC: "Aportes — Capital",
  }),
  s("3.2", "RESERVAS"),
  a("3.2.01", "RESERVA LEGAL", { rubroEECC: "Reservas" }),
  a("3.2.02", "RESERVA FACULTATIVA", { rubroEECC: "Reservas" }),
  a("3.2.03", "RESERVA ESTATUTARIA", { rubroEECC: "Reservas" }),
  a("3.2.04", "RESERVA POR REVALÚO TÉCNICO (RT 31)", { rubroEECC: "Reservas" }),
  a("3.2.05", "OTROS RESULTADOS INTEGRALES ACUMULADOS (ORI)", { rubroEECC: "Reservas" }),
  s("3.3", "RESULTADOS ACUMULADOS"),
  a("3.3.01", "RESULTADOS NO ASIGNADOS (EJERCICIOS ANTERIORES)", {
    rubroEECC: "Resultados acumulados",
  }),
  a("3.3.02", "(-) DIVIDENDOS DECLARADOS", {
    naturaleza: "DEUDOR",
    rubroEECC: "Resultados acumulados",
  }),
  // 3.4 RESULTADO DEL EJERCICIO: cuenta de cierre, SINTÉTICA. La calcula el
  // reporte (suma de clases 4-9); el motor NO imputa asientos acá.
  s("3.4", "RESULTADO DEL EJERCICIO"),

  // ============================ 4 · INGRESOS ============================
  s("4", "INGRESOS"),
  s("4.1", "INGRESOS POR VENTAS"),
  s("4.1.01", "VENTA DE MERCADERÍAS — MERCADO LOCAL"),
  a("4.1.01.01", "VENTA NEUMÁTICOS TBR — LOCAL", { rubroEECC: R_VENTAS }),
  a("4.1.01.02", "VENTA NEUMÁTICOS PCR/LTR — LOCAL", { rubroEECC: R_VENTAS }),
  a("4.1.01.03", "VENTA NEUMÁTICOS OTR/AGRÍCOLAS — LOCAL", { rubroEECC: R_VENTAS }),
  a("4.1.01.04", "VENTA CÁMARAS Y ACCESORIOS — LOCAL", { rubroEECC: R_VENTAS }),
  // Fallback cuando el producto no tiene categoría mapeada (el motor agrupa por
  // Producto.categoria → 4.1.01.01..04; sin categoría cae acá).
  a("4.1.01.09", "VENTA MERCADERÍAS LOCAL (SIN DESAGREGAR)", { rubroEECC: R_VENTAS }),
  a("4.1.02", "VENTA DE MERCADERÍAS — EXTERIOR (EXPORTACIÓN)", {
    moneda: "ME",
    rubroEECC: R_VENTAS,
  }),
  a("4.1.03", "VENTA DE SERVICIOS", { rubroEECC: R_VENTAS }),
  s("4.2", "DEDUCCIONES SOBRE VENTAS"),
  a("4.2.01", "(-) DEVOLUCIONES SOBRE VENTAS", { naturaleza: "DEUDOR", rubroEECC: R_VENTAS }),
  a("4.2.02", "(-) BONIFICACIONES Y DESCUENTOS COMERCIALES", {
    naturaleza: "DEUDOR",
    rubroEECC: R_VENTAS,
  }),
  s("4.3", "OTROS INGRESOS OPERATIVOS"),
  a("4.3.01", "FLETES Y SERVICIOS FACTURADOS A CLIENTES", {
    rubroEECC: "Otros ingresos operativos",
  }),
  a("4.3.02", "RECUPERO DE GASTOS", { rubroEECC: "Otros ingresos operativos" }),
  a("4.3.99", "OTROS INGRESOS OPERATIVOS DIVERSOS", { rubroEECC: "Otros ingresos operativos" }),

  // ========================= 5 · COSTO DE VENTAS =========================
  s("5", "COSTO DE VENTAS"),
  s("5.1", "COSTO DE MERCADERÍAS VENDIDAS"),
  a("5.1.01", "CMV NEUMÁTICOS TBR", { rubroEECC: R_COSTO }),
  a("5.1.02", "CMV NEUMÁTICOS PCR/LTR", { rubroEECC: R_COSTO }),
  a("5.1.03", "CMV NEUMÁTICOS OTR/AGRÍCOLAS", { rubroEECC: R_COSTO }),
  a("5.1.04", "CMV CÁMARAS Y ACCESORIOS", { rubroEECC: R_COSTO }),
  a("5.1.99", "CMV OTRAS MERCADERÍAS", { rubroEECC: R_COSTO }),
  s("5.2", "DIFERENCIAS DE INVENTARIO"),
  a("5.2.01", "FALTANTES DE INVENTARIO", { rubroEECC: R_COSTO }),
  a("5.2.02", "MERMAS Y ROTURAS", { rubroEECC: R_COSTO }),
  a("5.2.03", "(-) SOBRANTES DE INVENTARIO", { naturaleza: "ACREEDOR", rubroEECC: R_COSTO }),
  s("5.3", "DESVALORIZACIÓN DE BIENES DE CAMBIO"),
  a("5.3.01", "CONSTITUCIÓN DE DESVALORIZACIÓN A VNR", { rubroEECC: R_COSTO }),
  a("5.3.02", "CONSTITUCIÓN DE PREVISIÓN POR OBSOLESCENCIA / LENTO MOVIMIENTO", {
    rubroEECC: R_COSTO,
  }),

  // ===================== 6 · GASTOS DE COMERCIALIZACIÓN =====================
  s("6", "GASTOS DE COMERCIALIZACIÓN"),
  s("6.1", "PERSONAL COMERCIAL"),
  a("6.1.01", "SUELDOS Y JORNALES — COMERCIAL", { rubroEECC: R_COM }),
  a("6.1.02", "SAC Y VACACIONES — COMERCIAL", { rubroEECC: R_COM }),
  a("6.1.03", "CARGAS SOCIALES — COMERCIAL", { rubroEECC: R_COM }),
  a("6.1.04", "COMISIONES A VENDEDORES (RELACIÓN DE DEPENDENCIA)", { rubroEECC: R_COM }),
  a("6.1.99", "OTROS GASTOS DE PERSONAL COMERCIAL", { rubroEECC: R_COM }),
  s("6.2", "COMISIONES Y REPRESENTACIONES"),
  a("6.2.01", "COMISIONES A REPRESENTANTES Y TERCEROS", { rubroEECC: R_COM }),
  a("6.2.02", "REGALÍAS Y ROYALTIES SOBRE VENTAS", { moneda: "BI", rubroEECC: R_COM }),
  s("6.3", "FLETES Y DISTRIBUCIÓN"),
  a("6.3.01", "FLETES SOBRE VENTAS (SALIDA)", { rubroEECC: R_COM }),
  a("6.3.02", "ACARREOS Y DISTRIBUCIÓN LOCAL", { rubroEECC: R_COM }),
  a("6.3.03", "ENVASES Y EMBALAJES DE DESPACHO", { rubroEECC: R_COM }),
  s("6.4", "PUBLICIDAD Y MARKETING"),
  a("6.4.01", "PUBLICIDAD Y PROMOCIÓN", { moneda: "BI", rubroEECC: R_COM }),
  a("6.4.02", "MARKETING DIGITAL Y REDES", { moneda: "BI", rubroEECC: R_COM }),
  a("6.4.03", "FERIAS, EVENTOS Y MUESTRAS", { moneda: "BI", rubroEECC: R_COM }),
  // Marketing por proveedor: cuentas auto-creadas 6.4.09.NN (ver cuenta-auto GASTO_MARKETING).
  s("6.4.09", "MARKETING POR PROVEEDOR"),
  s("6.5", "IMPUESTOS SOBRE VENTAS"),
  a("6.5.01", "INGRESOS BRUTOS (IIBB)", { rubroEECC: R_COM }),
  a("6.5.02", "IMPUESTOS Y TASAS SOBRE COMERCIALIZACIÓN", { rubroEECC: R_COM }),
  s("6.6", "DEPÓSITO Y LOGÍSTICA DE SALIDA"),
  a("6.6.01", "ALMACENAJE DE STOCK PROPIO (POST-NACIONALIZACIÓN)", { rubroEECC: R_COM }),
  a("6.6.02", "SERVICIOS DE LOGÍSTICA Y WMS", { rubroEECC: R_COM }),
  s("6.7", "DEUDORES INCOBRABLES"),
  a("6.7.01", "CARGO POR INCOBRABILIDAD / CONSTITUCIÓN DE PREVISIÓN", { rubroEECC: R_COM }),
  a("6.7.02", "DEUDORES INCOBRABLES (CASTIGO DIRECTO)", { rubroEECC: R_COM }),
  s("6.9", "OTROS GASTOS DE COMERCIALIZACIÓN"),
  a("6.9.99", "OTROS GASTOS COMERCIALES DIVERSOS", { rubroEECC: R_COM }),

  // ===================== 7 · GASTOS DE ADMINISTRACIÓN =====================
  s("7", "GASTOS DE ADMINISTRACIÓN"),
  s("7.1", "PERSONAL ADMINISTRATIVO"),
  a("7.1.01", "SUELDOS Y JORNALES — ADMINISTRACIÓN", { rubroEECC: R_ADM }),
  a("7.1.02", "SAC Y VACACIONES — ADMINISTRACIÓN", { rubroEECC: R_ADM }),
  a("7.1.03", "CARGAS SOCIALES — ADMINISTRACIÓN", { rubroEECC: R_ADM }),
  a("7.1.99", "OTROS GASTOS DE PERSONAL ADMINISTRATIVO", { rubroEECC: R_ADM }),
  s("7.2", "HONORARIOS PROFESIONALES"),
  a("7.2.01", "HONORARIOS CONTABLES", { rubroEECC: R_ADM }),
  a("7.2.02", "HONORARIOS JURÍDICOS", { rubroEECC: R_ADM }),
  a("7.2.03", "HONORARIOS DE AUDITORÍA", { rubroEECC: R_ADM }),
  a("7.2.04", "HONORARIOS DE CONSULTORÍA", { moneda: "BI", rubroEECC: R_ADM }),
  // Honorarios por proveedor: cuentas auto-creadas 7.2.09.NN (GASTO_SERVICIOS_PROFESIONALES).
  s("7.2.09", "HONORARIOS PROFESIONALES POR PROVEEDOR"),
  s("7.3", "SISTEMAS Y TECNOLOGÍA"),
  a("7.3.01", "SOFTWARE COMO SERVICIO (SAAS) Y LICENCIAS", { moneda: "BI", rubroEECC: R_ADM }),
  a("7.3.02", "HOSTING, NUBE E INFRAESTRUCTURA IT", { moneda: "BI", rubroEECC: R_ADM }),
  a("7.3.03", "SOPORTE Y MANTENIMIENTO DE SISTEMAS", { moneda: "BI", rubroEECC: R_ADM }),
  s("7.3.09", "IT / SOFTWARE POR PROVEEDOR"),
  s("7.4", "ALQUILERES"),
  a("7.4.01", "ALQUILER DE OFICINAS", { rubroEECC: R_ADM }),
  a("7.4.02", "ALQUILER DE DEPÓSITOS", { rubroEECC: R_ADM }),
  a("7.4.03", "EXPENSAS Y GASTOS COMUNES", { rubroEECC: R_ADM }),
  s("7.4.09", "ALQUILERES POR PROVEEDOR"),
  s("7.5", "SERVICIOS"),
  a("7.5.01", "ENERGÍA ELÉCTRICA", { rubroEECC: R_ADM }),
  a("7.5.02", "GAS", { rubroEECC: R_ADM }),
  a("7.5.03", "AGUA", { rubroEECC: R_ADM }),
  a("7.5.04", "TELEFONÍA E INTERNET", { rubroEECC: R_ADM }),
  a("7.5.05", "LIMPIEZA Y SEGURIDAD", { rubroEECC: R_ADM }),
  a("7.5.99", "OTROS SERVICIOS", { rubroEECC: R_ADM }),
  s("7.6", "SEGUROS"),
  a("7.6.01", "SEGUROS GENERALES Y DE BIENES", { rubroEECC: R_ADM }),
  a("7.6.02", "SEGUROS DE TRANSPORTE (NO INVENTARIABLES)", { rubroEECC: R_ADM }),
  s("7.7", "DEPRECIACIONES Y AMORTIZACIONES"),
  a("7.7.01", "DEPRECIACIÓN DE BIENES DE USO", { rubroEECC: R_ADM }),
  a("7.7.02", "AMORTIZACIÓN DE ACTIVOS INTANGIBLES", { rubroEECC: R_ADM }),
  s("7.8", "GASTOS SOCIETARIOS Y LEGALES"),
  a("7.8.01", "TASAS IGJ/DPPJ Y GASTOS SOCIETARIOS", { rubroEECC: R_ADM }),
  a("7.8.02", "GASTOS DE ESCRIBANÍA Y LEGALES", { rubroEECC: R_ADM }),
  s("7.9", "OTROS GASTOS DE ADMINISTRACIÓN"),
  a("7.9.01", "PAPELERÍA Y ÚTILES DE OFICINA", { rubroEECC: R_ADM }),
  a("7.9.02", "MOVILIDAD, VIÁTICOS Y REPRESENTACIÓN", { rubroEECC: R_ADM }),
  a("7.9.99", "OTROS GASTOS ADMINISTRATIVOS DIVERSOS", { rubroEECC: R_ADM }),
  s("7.9.09", "OTROS GASTOS DE ADMINISTRACIÓN POR PROVEEDOR"),

  // ========================= 8 · OTROS RESULTADOS =========================
  s("8", "OTROS RESULTADOS", "EGRESO"),
  s("8.1", "OTROS INGRESOS NO OPERATIVOS", "INGRESO"),
  a("8.1.01", "INGRESOS POR ALQUILERES", { categoria: "INGRESO", rubroEECC: R_OR }),
  a("8.1.02", "RECUPERO DE PREVISIONES Y DEUDAS INCOBRABLES", {
    categoria: "INGRESO",
    rubroEECC: R_OR,
  }),
  a("8.1.99", "OTROS INGRESOS NO OPERATIVOS", {
    categoria: "INGRESO",
    moneda: "BI",
    rubroEECC: R_OR,
  }),
  s("8.2", "OTROS EGRESOS NO OPERATIVOS"),
  a("8.2.01", "GASTOS NO OPERATIVOS DIVERSOS", { moneda: "BI", rubroEECC: R_OR }),
  a("8.2.02", "DONACIONES", { rubroEECC: R_OR }),
  s("8.3", "RESULTADOS POR VENTA Y BAJA DE ACTIVOS FIJOS"),
  a("8.3.01", "RESULTADO POR VENTA DE BIENES DE USO", { categoria: "INGRESO", rubroEECC: R_OR }),
  a("8.3.02", "RESULTADO POR BAJA DE ACTIVOS", { rubroEECC: R_OR }),
  s("8.4", "CONTINGENCIAS"),
  a("8.4.01", "CONSTITUCIÓN DE PREVISIONES PARA CONTINGENCIAS", { moneda: "BI", rubroEECC: R_OR }),
  a("8.4.02", "(-) REVERSIÓN DE PREVISIONES PARA CONTINGENCIAS", {
    naturaleza: "ACREEDOR",
    moneda: "BI",
    rubroEECC: R_OR,
  }),
  s("8.5", "MULTAS Y SANCIONES"),
  a("8.5.01", "MULTAS, RECARGOS E INTERESES RESARCITORIOS FISCALES", { rubroEECC: R_OR }),
  a("8.5.02", "SANCIONES Y PENALIDADES CONTRACTUALES", { moneda: "BI", rubroEECC: R_OR }),
  s("8.6", "IMPUESTO A LAS GANANCIAS"),
  a("8.6.01", "IMPUESTO A LAS GANANCIAS — CORRIENTE", { rubroEECC: R_IG }),
  a("8.6.02", "IMPUESTO A LAS GANANCIAS — DIFERIDO", { rubroEECC: R_IG }),

  // ============= 9 · RESULTADOS FINANCIEROS Y POR TENENCIA =============
  s("9", "RESULTADOS FINANCIEROS Y POR TENENCIA", "EGRESO"),
  s("9.1", "INTERESES", "EGRESO"),
  a("9.1.01", "INTERESES GANADOS — FINANCIEROS", {
    categoria: "INGRESO",
    moneda: "BI",
    rubroEECC: R_RF,
  }),
  a("9.1.02", "INTERESES GANADOS — COMERCIALES (CLIENTES)", {
    categoria: "INGRESO",
    rubroEECC: R_RF,
  }),
  a("9.1.03", "INTERESES PERDIDOS — PRÉSTAMOS", { moneda: "BI", rubroEECC: R_RF }),
  a("9.1.04", "INTERESES PERDIDOS — CAPITAL DE GIRO / DESCUBIERTO", { rubroEECC: R_RF }),
  a("9.1.05", "INTERESES PERDIDOS — COMERCIALES (PROVEEDORES)", { moneda: "BI", rubroEECC: R_RF }),
  s("9.2", "DIFERENCIAS DE CAMBIO", "INGRESO"),
  a("9.2.01", "DIFERENCIA DE CAMBIO POSITIVA — REALIZADA", {
    categoria: "INGRESO",
    moneda: "BI",
    rubroEECC: R_RF,
  }),
  a("9.2.02", "DIFERENCIA DE CAMBIO NEGATIVA — REALIZADA", { moneda: "BI", rubroEECC: R_RF }),
  a("9.2.03", "DIFERENCIA DE CAMBIO POSITIVA — NO REALIZADA (CIERRE)", {
    categoria: "INGRESO",
    moneda: "BI",
    rubroEECC: R_RF,
  }),
  a("9.2.04", "DIFERENCIA DE CAMBIO NEGATIVA — NO REALIZADA (CIERRE)", {
    moneda: "BI",
    rubroEECC: R_RF,
  }),
  s("9.3", "RESULTADOS POR TENENCIA", "INGRESO"),
  a("9.3.01", "RESULTADO POR TENENCIA DE INVERSIONES FINANCIERAS", {
    categoria: "INGRESO",
    moneda: "BI",
    rubroEECC: R_RF,
  }),
  a("9.3.02", "RESULTADO POR TENENCIA DE BIENES DE CAMBIO", {
    categoria: "INGRESO",
    moneda: "BI",
    rubroEECC: R_RF,
  }),
  s("9.4", "RECPAM", "INGRESO"),
  a("9.4.01", "RECPAM — RESULTADO POR EXPOSICIÓN A LA INFLACIÓN", {
    categoria: "INGRESO",
    rubroEECC: R_RF,
  }),
  s("9.5", "COMISIONES Y GASTOS BANCARIOS"),
  a("9.5.01", "COMISIONES Y GASTOS BANCARIOS", { rubroEECC: R_RF }),
  a("9.5.02", "GASTOS DE TRANSFERENCIAS AL EXTERIOR (SWIFT/TT)", { moneda: "BI", rubroEECC: R_RF }),
  s("9.6", "IMPUESTOS FINANCIEROS"),
  a("9.6.01", "IMPUESTO LEY 25.413 (PORCIÓN NO COMPUTABLE)", { rubroEECC: R_RF }),
  a("9.6.02", "IMPUESTO DE SELLOS SOBRE OPERACIONES FINANCIERAS", { rubroEECC: R_RF }),
  s("9.7", "DESCUENTOS FINANCIEROS", "INGRESO"),
  a("9.7.01", "DESCUENTOS OBTENIDOS POR PRONTO PAGO", { categoria: "INGRESO", rubroEECC: R_RF }),
  a("9.7.02", "DESCUENTOS CONCEDIDOS POR PRONTO PAGO", { categoria: "EGRESO", rubroEECC: R_RF }),
  s("9.8", "OTROS RESULTADOS FINANCIEROS"),
  a("9.8.01", "DIFERENCIAS DE REDONDEO", { rubroEECC: R_RF }),
  a("9.8.99", "OTROS RESULTADOS FINANCIEROS DIVERSOS", { moneda: "BI", rubroEECC: R_RF }),
];

/** Alias temporal para importadores que aún referencian el nombre RT9. */
export const PLAN_RT9 = PLAN_CUENTAS;

/** Un problema de consistencia detectado por el guard. */
export type ProblemaPlan = { codigo: string; regla: string; detalle: string };

/**
 * Guard del plan (las invariantes del ADR). Devuelve la lista de problemas;
 * vacía = plan consistente. Reglas:
 *  - R1_ORFA: toda cuenta con padre tiene a ese padre declarado como SINTÉTICA.
 *  - R2_CATEGORIA: la categoría coincide con el dígito raíz (clases 1-7; las
 *    mixtas 8/9 fijan categoría explícita y no se controlan por dígito).
 *  - R3_INVENTARIABLE_RESULTADO: ninguna cuenta de resultado (5-9) inventariable.
 *  - R4_REGULARIZADORA: toda analítica "(-)" tiene naturaleza explícita e
 *    invertida respecto del default de su categoría.
 *  - R5_DUP: códigos únicos.
 */
export function validarPlan(plan: readonly CuentaPlan[]): ProblemaPlan[] {
  const out: ProblemaPlan[] = [];
  const porCodigo = new Map<string, CuentaPlan>();
  for (const c of plan) {
    if (porCodigo.has(c.codigo)) {
      out.push({ codigo: c.codigo, regla: "R5_DUP", detalle: "código duplicado" });
    }
    porCodigo.set(c.codigo, c);
  }
  const sinteticas = new Set(plan.filter((c) => c.tipo === "SINTETICA").map((c) => c.codigo));

  for (const c of plan) {
    const segs = c.codigo.split(".");

    const esperada = CATEGORIA_POR_DIGITO[segs[0]];
    if (esperada && c.categoria !== esperada) {
      out.push({
        codigo: c.codigo,
        regla: "R2_CATEGORIA",
        detalle: `categoría ${c.categoria} ≠ ${esperada} (dígito ${segs[0]})`,
      });
    }

    if (segs.length > 1) {
      const padre = segs.slice(0, -1).join(".");
      if (!sinteticas.has(padre)) {
        out.push({
          codigo: c.codigo,
          regla: "R1_ORFA",
          detalle: `padre ${padre} no declarado como SINTÉTICA`,
        });
      }
    }

    const claseResultado = ["5", "6", "7", "8", "9"].includes(segs[0]);
    if (claseResultado && c.inventariable) {
      out.push({
        codigo: c.codigo,
        regla: "R3_INVENTARIABLE_RESULTADO",
        detalle: "una cuenta de resultado no puede ser inventariable",
      });
    }

    if (c.tipo === "ANALITICA" && c.nombre.trimStart().startsWith("(-)")) {
      const def = naturalezaPorDefecto(c.categoria);
      if (!c.naturaleza) {
        out.push({
          codigo: c.codigo,
          regla: "R4_REGULARIZADORA",
          detalle: "regularizadora '(-)' sin naturaleza explícita",
        });
      } else if (c.naturaleza === def) {
        out.push({
          codigo: c.codigo,
          regla: "R4_REGULARIZADORA",
          detalle: `regularizadora con naturaleza ${def} (= default); debe ser la opuesta`,
        });
      }
    }
  }
  return out;
}
