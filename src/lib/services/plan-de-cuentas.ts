/**
 * Plan de cuentas RT9/RT17 (rebuild) — FUENTE ÚNICA estructurada.
 *
 * El plan v3 (ver `docs/nuevo-plan-de-cuentas-rt9.md`) vive aquí como dato, no
 * disperso en seed/registry/hardcodes. Lo consumen: el seed (siembra la
 * espina + analíticas canónicas), el registry (mapas de códigos canónicos), el
 * guard de CI (`validarPlan`) y los reportes (rubro/naturaleza).
 *
 * Sin `import "server-only"`: importable desde `prisma/` (tsx) y desde el
 * runtime por igual.
 *
 * Sólo declara SINTÉTICAS + ANALÍTICAS canónicas. Las cuentas por-entidad
 * (clientes 1.1.4.10–99, proveedores 2.1.1/2.1.8, bancos, préstamos) nacen en
 * runtime bajo su padre sintético (ver `cuenta-auto.ts`).
 */

export type TipoCuenta = "SINTETICA" | "ANALITICA";
export type CategoriaCuenta = "ACTIVO" | "PASIVO" | "PATRIMONIO" | "INGRESO" | "EGRESO";
export type NaturalezaCuenta = "DEUDOR" | "ACREEDOR";
export type MonedaCuenta = "ARS" | "USD" | "BI";

export type CuentaPlan = {
  codigo: string;
  nombre: string;
  tipo: TipoCuenta;
  categoria: CategoriaCuenta;
  /** Explícita sólo en regularizadoras; el resto se deriva de la categoría. */
  naturaleza?: NaturalezaCuenta;
  /** USD/BI en cuentas con moneda extranjera (revalúo al cierre). Default ARS. */
  moneda?: MonedaCuenta;
  /** Rubro de exposición EECC (RT9). Manda sobre el árbol de código. */
  rubroEECC?: string;
  /** true en Bienes de Cambio (1.1.7.0x): puede recibir costo landed. */
  inventariable?: boolean;
};

const CATEGORIA_POR_DIGITO: Record<string, CategoriaCuenta> = {
  "1": "ACTIVO",
  "2": "PASIVO",
  "3": "PATRIMONIO",
  "4": "INGRESO",
  "5": "EGRESO",
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
 * "."), resuelve `naturaleza` (explícita en regularizadoras, default por
 * categoría) y normaliza `moneda`/`rubroEECC` a null. `inventariable` NO se
 * persiste — no es columna; lo usa sólo el guard.
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

function categoriaPorCodigo(codigo: string): CategoriaCuenta {
  return CATEGORIA_POR_DIGITO[codigo[0]] ?? "ACTIVO";
}

/** Sintética (agrupadora). */
function s(codigo: string, nombre: string): CuentaPlan {
  return { codigo, nombre, tipo: "SINTETICA", categoria: categoriaPorCodigo(codigo) };
}
/** Analítica (recibe asientos). `opts` para naturaleza/moneda/rubro/inventariable. */
function a(codigo: string, nombre: string, opts: Partial<CuentaPlan> = {}): CuentaPlan {
  return { codigo, nombre, tipo: "ANALITICA", categoria: categoriaPorCodigo(codigo), ...opts };
}

export const PLAN_RT9: readonly CuentaPlan[] = [
  // ===================== 1 · ACTIVO =====================
  s("1", "ACTIVO"),
  s("1.1", "ACTIVO CORRIENTE"),
  s("1.1.1", "CAJA"),
  s("1.1.2", "BANCOS"),
  s("1.1.3", "INVERSIONES"),
  a("1.1.3.01", "INVERSIONES EN FONDOS COMUNES"),
  a("1.1.3.02", "PLAZOS FIJOS"),
  s("1.1.4", "CRÉDITOS POR VENTAS"),
  a("1.1.4.01", "DEUDORES POR VENTAS"),
  a("1.1.4.09", "(-) PREVISIÓN DEUDORES INCOBRABLES", { naturaleza: "ACREEDOR" }),
  // 1.1.5 Créditos Fiscales (subgrupos · nivel 5)
  s("1.1.5", "CRÉDITOS FISCALES"),
  s("1.1.5.1", "IVA — CRÉDITO FISCAL Y PERCEPCIONES"),
  a("1.1.5.1.01", "IVA CRÉDITO FISCAL — COMPRAS LOCALES"),
  a("1.1.5.1.02", "PERCEPCIÓN IVA RG 2408 (BANCARIA)"),
  a("1.1.5.1.03", "IVA CRÉDITO FISCAL IMPORTACIÓN"),
  a("1.1.5.1.04", "PERCEPCIÓN IVA ADICIONAL IMPORTACIÓN"),
  s("1.1.5.2", "INGRESOS BRUTOS — PERCEPCIONES"),
  a("1.1.5.2.01", "PERCEPCIÓN IIBB IMPORTACIÓN"),
  a("1.1.5.2.02", "PERCEPCIÓN IIBB COMPRAS"),
  a("1.1.5.2.03", "PERCEPCIÓN IIBB BANCARIA (SIRCREB)"),
  s("1.1.5.3", "GANANCIAS — PERCEPCIONES Y PAGOS A CUENTA"),
  a("1.1.5.3.01", "PERCEPCIÓN GANANCIAS IMPORTACIÓN"),
  a("1.1.5.3.02", "CRÉDITO LEY 25413 PAGO A CTA GANANCIAS"),
  s("1.1.5.4", "ADUANA"),
  a("1.1.5.4.01", "CRÉDITO A FAVOR ADUANA (DIF CAMBIARIA)"),
  // 1.1.6 Otros Créditos (subgrupos)
  s("1.1.6", "OTROS CRÉDITOS"),
  s("1.1.6.1", "ANTICIPOS"),
  a("1.1.6.1.01", "ANTICIPOS A PROVEEDORES DEL EXTERIOR (USD)", { moneda: "USD" }),
  a("1.1.6.1.02", "ANTICIPOS A PROVEEDORES LOCALES"),
  a("1.1.6.1.03", "ANTICIPOS AL PERSONAL"),
  s("1.1.6.2", "OTROS"),
  a("1.1.6.2.01", "VALORES A COBRAR (CHEQUES DE TERCEROS)"),
  a("1.1.6.2.02", "GASTOS PAGADOS POR ADELANTADO"),
  // 1.1.7 Estoque / Bienes de Cambio (inventariables). NOTA: sólo cambian los
  // nombres de exposición; el ROL de cada código en el motor es inalterado
  // (flujo COMEX 02→03→04→01, ver cuenta-registry COMEX_ZPA_CODIGOS).
  s("1.1.7", "ESTOQUE"),
  a("1.1.7.01", "ESTOQUE NACIONALIZADO", { inventariable: true }),
  a("1.1.7.02", "ESTOQUE A DESPACHAR", { inventariable: true, moneda: "BI" }),
  a("1.1.7.03", "MERCADERÍAS EN TRÁNSITO", { inventariable: true }),
  a("1.1.7.04", "MERCADERÍAS EN DEPÓSITO FISCAL (DF)", { inventariable: true }),
  a("1.1.7.05", "MERCADERÍAS A ENTREGAR", { inventariable: true }),
  a("1.1.7.09", "(-) DESVALORIZACIÓN DE BIENES DE CAMBIO", { naturaleza: "ACREEDOR" }),
  // 1.2 Activo No Corriente
  s("1.2", "ACTIVO NO CORRIENTE"),
  s("1.2.1", "BIENES DE USO"),
  a("1.2.1.09", "(-) DEPRECIACIÓN ACUMULADA BIENES DE USO", { naturaleza: "ACREEDOR" }),
  s("1.2.2", "ACTIVOS INTANGIBLES"),
  a("1.2.2.01", "SOFTWARE Y LICENCIAS (ERP)"),
  a("1.2.2.09", "(-) AMORTIZACIÓN ACUMULADA INTANGIBLES", { naturaleza: "ACREEDOR" }),
  s("1.2.3", "OTROS ACTIVOS NO CORRIENTES"),
  a("1.2.3.01", "DEPÓSITOS EN GARANTÍA"),

  // ===================== 2 · PASIVO =====================
  s("2", "PASIVO"),
  s("2.1", "PASIVO CORRIENTE"),
  s("2.1.1", "DEUDAS COMERCIALES"),
  a("2.1.1.01", "PROVEEDORES LOCALES"),
  a("2.1.1.05", "FLETES SOBRE VENTAS POR PAGAR"),
  s("2.1.2", "DEUDAS BANCARIAS Y FINANCIERAS"),
  // 2.1.3 Deudas Fiscales (subgrupos · nivel 5)
  s("2.1.3", "DEUDAS FISCALES"),
  s("2.1.3.1", "IVA"),
  a("2.1.3.1.01", "IVA DÉBITO FISCAL"),
  a("2.1.3.1.02", "IVA SALDO A PAGAR (POSICIÓN)"),
  s("2.1.3.2", "INGRESOS BRUTOS"),
  a("2.1.3.2.01", "IIBB POR PAGAR"),
  a("2.1.3.2.02", "IIBB CONVENIO MULTILATERAL A DEPOSITAR"),
  s("2.1.3.3", "GANANCIAS"),
  a("2.1.3.3.01", "IMPUESTO A LAS GANANCIAS A PAGAR (PROVISIÓN)"),
  a("2.1.3.3.02", "RETENCIONES GANANCIAS A DEPOSITAR (SICORE)"),
  s("2.1.3.4", "RETENCIONES Y OTROS"),
  a("2.1.3.4.01", "RETENCIONES/PERCEPCIONES A DEPOSITAR (PRACTICADAS)"),
  a("2.1.3.4.02", "OTROS IMPUESTOS"),
  s("2.1.4", "DEUDAS SOCIALES"),
  a("2.1.4.01", "SUELDOS A PAGAR"),
  a("2.1.4.02", "CARGAS SOCIALES A PAGAR (SUSS)"),
  a("2.1.4.03", "PROVISIÓN SAC Y VACACIONES"),
  a("2.1.4.04", "ART / SINDICATO A DEPOSITAR"),
  s("2.1.5", "IMPUESTOS NACIONALIZACIÓN POR PAGAR"),
  a("2.1.5.01", "DERECHOS DE IMPORTACIÓN POR PAGAR"),
  a("2.1.5.02", "TASA ESTADÍSTICA POR PAGAR"),
  a("2.1.5.03", "ARANCEL SIM POR PAGAR"),
  a("2.1.5.04", "IVA IMPORTACIÓN POR PAGAR"),
  a("2.1.5.99", "SALDO PENDIENTE ADUANA (REFUERZO VEP)"),
  s("2.1.7", "ANTICIPOS DE CLIENTES"),
  a("2.1.7.01", "ANTICIPOS DE CLIENTES"),
  s("2.1.8", "PROVEEDORES DEL EXTERIOR"),
  a("2.1.8.01", "PROVEEDORES DEL EXTERIOR", { moneda: "USD" }),
  // 2.2 Pasivo No Corriente
  s("2.2", "PASIVO NO CORRIENTE"),
  s("2.2.1", "PRÉSTAMOS LARGO PLAZO"),
  s("2.2.2", "PREVISIONES (LARGO PLAZO)"),
  a("2.2.2.01", "PREVISIÓN PARA INDEMNIZACIONES / CONTINGENCIAS"),

  // ===================== 3 · PATRIMONIO NETO =====================
  s("3", "PATRIMONIO NETO"),
  s("3.1", "APORTES DE LOS PROPIETARIOS"),
  s("3.1.1", "CAPITAL"),
  a("3.1.1.01", "CAPITAL SOCIAL"),
  a("3.1.1.02", "APORTES IRREVOCABLES"),
  s("3.1.2", "AJUSTES Y PRIMAS"),
  a("3.1.2.01", "AJUSTE DE CAPITAL"),
  a("3.1.2.02", "PRIMA DE EMISIÓN"),
  s("3.2", "RESULTADOS"),
  s("3.2.1", "RESULTADOS ACUMULADOS"),
  a("3.2.1.01", "RESULTADOS NO ASIGNADOS (EJ. ANTERIORES)"),
  a("3.2.1.02", "RESULTADO DEL EJERCICIO"),
  a("3.2.1.03", "(-) DIVIDENDOS DECLARADOS", { naturaleza: "DEUDOR" }),
  s("3.3", "RESERVAS"),
  s("3.3.1", "RESERVAS"),
  a("3.3.1.01", "RESERVA LEGAL"),
  a("3.3.1.02", "RESERVA FACULTATIVA"),
  a("3.3.1.03", "RESERVA ESTATUTARIA"),

  // ===================== 4 · INGRESOS =====================
  s("4", "INGRESOS"),
  s("4.1", "INGRESOS POR VENTAS"),
  s("4.1.1", "VENTAS"),
  a("4.1.1.01", "VENTAS NEUMÁTICOS NUEVOS"),
  s("4.1.2", "DEDUCCIONES SOBRE VENTAS"),
  a("4.1.2.01", "(-) DEVOLUCIONES SOBRE VENTAS", { naturaleza: "DEUDOR" }),
  a("4.1.2.02", "(-) BONIFICACIONES SOBRE VENTAS", { naturaleza: "DEUDOR" }),
  s("4.2", "OTROS INGRESOS"),
  s("4.2.1", "OTROS INGRESOS OPERATIVOS"),
  a("4.2.1.01", "DESCUENTOS OBTENIDOS"),
  a("4.2.1.02", "RECUPERO DE GASTOS"),
  s("4.2.2", "RESULTADOS POR TENENCIA DE INVENTARIO"),
  a("4.2.2.01", "INGRESOS POR DIFERENCIA DE INVENTARIO (SOBRANTES)"),
  s("4.3", "RESULTADOS FINANCIEROS Y POR TENENCIA"),
  s("4.3.1", "RESULTADOS FINANCIEROS POSITIVOS"),
  a("4.3.1.01", "INTERESES GANADOS"),
  a("4.3.1.02", "GANANCIA POR DIFERENCIA DE CAMBIO", {
    rubroEECC: "Resultados Financieros y por Tenencia",
  }),
  a("4.3.1.03", "RENDIMIENTO DE INVERSIONES (FCI)"),
  a("4.3.1.04", "RECPAM POSITIVO"),

  // ===================== 5 · EGRESOS =====================
  s("5", "EGRESOS"),
  s("5.1", "COSTO DE MERCADERÍAS VENDIDAS"),
  s("5.1.1", "COSTO DE VENTAS"),
  a("5.1.1.01", "COSTO MERCADERÍA VENDIDA (CMV)"),
  a("5.1.1.02", "MERMAS Y FALTANTES DE INVENTARIO"),
  s("5.2", "GASTOS DE COMERCIALIZACIÓN"),
  s("5.2.1", "GASTOS DE COMERCIALIZACIÓN"),
  a("5.2.1.01", "FLETE SOBRE VENTAS"),
  a("5.2.1.02", "PUBLICIDAD Y MARKETING"),
  a("5.2.1.03", "INGRESOS BRUTOS (IIBB)"),
  a("5.2.1.04", "COMISIONES SOBRE VENTAS"),
  s("5.2.2", "MARKETING POR PROVEEDOR"),
  s("5.3", "GASTOS DE ADMINISTRACIÓN"),
  s("5.3.1", "GASTOS DE ADMINISTRACIÓN"),
  a("5.3.1.01", "HONORARIOS CONTABLES Y PROFESIONALES"),
  a("5.3.1.02", "SISTEMAS Y SOFTWARE"),
  a("5.3.1.03", "ALQUILERES"),
  a("5.3.1.04", "SUELDOS Y CARGAS SOCIALES (ADM.)"),
  a("5.3.1.05", "SERVICIOS Y GASTOS GENERALES"),
  a("5.3.1.06", "DEPRECIACIONES Y AMORTIZACIONES"),
  a("5.3.1.07", "ALMACENAJE DE STOCK PROPIO (POST-NACIONALIZACIÓN)"),
  a("5.3.1.99", "OTROS GASTOS DE ADMINISTRACIÓN"),
  s("5.3.2", "SERVICIOS PROFESIONALES POR PROVEEDOR"),
  s("5.3.3", "IT / SOFTWARE POR PROVEEDOR"),
  s("5.8", "RESULTADOS FINANCIEROS Y POR TENENCIA"),
  s("5.8.1", "RESULTADOS FINANCIEROS NEGATIVOS"),
  a("5.8.1.01", "COMISIONES BANCARIAS"),
  a("5.8.1.02", "PÉRDIDA POR DIFERENCIA DE CAMBIO", {
    rubroEECC: "Resultados Financieros y por Tenencia",
  }),
  a("5.8.1.03", "GASTOS TRANSFERENCIA EXTERIOR"),
  a("5.8.1.04", "IMPUESTO DE SELLOS"),
  a("5.8.1.05", "IMPUESTO LEY 25413 (NO COMPUTABLE)"),
  a("5.8.1.06", "RECPAM NEGATIVO"),
  a("5.8.1.07", "INTERESES PAGADOS"),
  a("5.8.1.08", "DIFERENCIAS DE REDONDEO"),
  s("5.9", "OTROS EGRESOS"),
  s("5.9.1", "OTROS EGRESOS"),
  a("5.9.1.01", "GASTOS NO DEDUCIBLES / MULTAS"),
  a("5.9.1.02", "OTROS EGRESOS"),
  s("5.10", "IMPUESTO A LAS GANANCIAS"),
  s("5.10.1", "IMPUESTO A LAS GANANCIAS"),
  a("5.10.1.01", "IMPUESTO A LAS GANANCIAS DEL EJERCICIO"),
];

/** Un problema de consistencia detectado por el guard. */
export type ProblemaPlan = { codigo: string; regla: string; detalle: string };

/**
 * Guard del plan (las invariantes del ADR). Devuelve la lista de problemas;
 * vacía = plan consistente. Reglas:
 *  - R1_ORFA: toda cuenta con padre tiene a ese padre declarado como SINTÉTICA.
 *  - R2_CATEGORIA: la categoría coincide con el dígito raíz del código.
 *  - R3_INVENTARIABLE_5X: ningún código bajo `5.` puede ser inventariable.
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

    if (c.codigo.startsWith("5.") && c.inventariable) {
      out.push({
        codigo: c.codigo,
        regla: "R3_INVENTARIABLE_5X",
        detalle: "una cuenta de egreso no puede ser inventariable",
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
