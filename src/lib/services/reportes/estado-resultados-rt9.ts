/**
 * Estado de Resultados en el orden de exposición RT9 (rebuild #4).
 *
 * Módulo PURO (sin `server-only` ni DB): recibe las cuentas analíticas de
 * resultado ya agregadas (debe/haber del período) y arma la cascada RT9:
 *
 *   Ventas Netas
 *   (−) Costo de Mercaderías Vendidas
 *   = Resultado Bruto
 *   (−) Gastos de Comercialización
 *   (−) Gastos de Administración
 *   = Resultado Operativo
 *   (±) Resultados Financieros y por Tenencia (incl. RECPAM)
 *   (±) Otros Ingresos y Egresos
 *   = Resultado antes de Impuestos
 *   (−) Impuesto a las Ganancias
 *   = Resultado del Ejercicio
 *
 * La sección de cada cuenta se deriva del prefijo de código, salvo que la
 * cuenta declare un `rubroEECC` explícito: ahí el rubro MANDA sobre el árbol
 * de código (ver `CuentaPlan.rubroEECC`). Esto permite, p. ej., exponer el par
 * de diferencia de cambio (4.3.1.02 / 5.8.1.02) bajo un único rubro funcional.
 */

import { Decimal } from "@/lib/decimal";

export type SeccionRT9Id =
  | "VENTAS"
  | "CMV"
  | "COMERCIALIZACION"
  | "ADMINISTRACION"
  | "FINANCIEROS"
  | "OTROS"
  | "GANANCIAS";

/** Cómo se expone el monto de la sección y cómo contribuye al resultado. */
export type SeccionTipo = "ingreso" | "egreso" | "mixto";

type SeccionDef = {
  id: SeccionRT9Id;
  label: string;
  tipo: SeccionTipo;
  /** Rubro EECC canónico: si una cuenta lo declara, cae aquí (override). */
  rubroEECC: string;
  /** Prefijos de código que, sin rubro explícito, asignan la sección. */
  prefijos: string[];
};

// Orden de exposición RT9 (de arriba hacia abajo en el estado).
const SECCIONES: readonly SeccionDef[] = [
  {
    id: "VENTAS",
    label: "Ventas Netas",
    tipo: "ingreso",
    rubroEECC: "Ventas",
    prefijos: ["4.1"],
  },
  {
    id: "CMV",
    label: "Costo de Mercaderías Vendidas",
    tipo: "egreso",
    rubroEECC: "Costo de Mercaderías Vendidas",
    prefijos: ["5.1"],
  },
  {
    id: "COMERCIALIZACION",
    label: "Gastos de Comercialización",
    tipo: "egreso",
    rubroEECC: "Gastos de Comercialización",
    prefijos: ["5.2"],
  },
  {
    id: "ADMINISTRACION",
    label: "Gastos de Administración",
    tipo: "egreso",
    rubroEECC: "Gastos de Administración",
    prefijos: ["5.3"],
  },
  {
    id: "FINANCIEROS",
    label: "Resultados Financieros y por Tenencia",
    tipo: "mixto",
    rubroEECC: "Resultados Financieros y por Tenencia",
    prefijos: ["4.3", "5.8"],
  },
  {
    id: "OTROS",
    label: "Otros Ingresos y Egresos",
    tipo: "mixto",
    rubroEECC: "Otros Ingresos y Egresos",
    prefijos: ["4.2", "5.9"],
  },
  {
    id: "GANANCIAS",
    label: "Impuesto a las Ganancias",
    tipo: "egreso",
    rubroEECC: "Impuesto a las Ganancias",
    prefijos: ["5.10"],
  },
];

const POR_RUBRO = new Map(SECCIONES.map((s) => [s.rubroEECC, s.id]));

/**
 * Cuenta analítica de resultado ya agregada para el período. `rubroEECC`
 * (cuando viene) manda sobre el código a la hora de elegir la sección.
 */
export type LeafResultado = {
  codigo: string;
  categoria: "INGRESO" | "EGRESO";
  rubroEECC: string | null;
  debe: Decimal;
  haber: Decimal;
};

/**
 * Determina la sección RT9 de una cuenta. `rubroEECC` manda; si no, se deriva
 * del prefijo de código. Devuelve null si nada matchea (el caller decide qué
 * hacer — el guard del plan exige que no haya cuentas sin sección).
 */
export function clasificarSeccionRT9(
  codigo: string,
  rubroEECC?: string | null,
): SeccionRT9Id | null {
  if (rubroEECC) {
    const porRubro = POR_RUBRO.get(rubroEECC);
    if (porRubro) return porRubro;
  }
  for (const s of SECCIONES) {
    if (s.prefijos.some((p) => codigo === p || codigo.startsWith(`${p}.`))) {
      return s.id;
    }
  }
  return null;
}

export type SeccionRT9 = {
  id: SeccionRT9Id;
  label: string;
  tipo: SeccionTipo;
  /** Contribución al resultado (con signo: + aumenta la ganancia). */
  total: Decimal;
  /**
   * Magnitud para exhibición. Ingreso/mixto: igual a `total` (con signo).
   * Egreso: el opuesto de `total`, así se muestra positivo y se entiende
   * como una resta.
   */
  montoExpuesto: Decimal;
};

export type EstadoResultadosRT9 = {
  secciones: SeccionRT9[];
  resultadoBruto: Decimal;
  resultadoOperativo: Decimal;
  resultadoAntesImpuestos: Decimal;
  resultadoEjercicio: Decimal;
};

/**
 * Arma la cascada RT9 desde las cuentas de resultado agregadas. La contribución
 * de cada cuenta al resultado es `haber − debe` (positivo = aumenta ganancia),
 * lo que netea correctamente las regularizadoras (devoluciones, RECPAM) sin
 * mirar su naturaleza explícita.
 */
export function construirEstadoResultadosRT9(leaves: LeafResultado[]): EstadoResultadosRT9 {
  const totalPorSeccion = new Map<SeccionRT9Id, Decimal>();
  for (const s of SECCIONES) totalPorSeccion.set(s.id, new Decimal(0));

  for (const l of leaves) {
    const id = clasificarSeccionRT9(l.codigo, l.rubroEECC);
    if (!id) continue;
    const contribucion = l.haber.minus(l.debe);
    totalPorSeccion.set(id, (totalPorSeccion.get(id) ?? new Decimal(0)).plus(contribucion));
  }

  const secciones: SeccionRT9[] = SECCIONES.map((s) => {
    const total = (totalPorSeccion.get(s.id) ?? new Decimal(0)).toDecimalPlaces(2);
    const montoExpuesto = s.tipo === "egreso" ? total.negated() : total;
    return { id: s.id, label: s.label, tipo: s.tipo, total, montoExpuesto };
  });

  const por = (id: SeccionRT9Id): Decimal =>
    secciones.find((s) => s.id === id)?.total ?? new Decimal(0);

  const resultadoBruto = por("VENTAS").plus(por("CMV"));
  const resultadoOperativo = resultadoBruto
    .plus(por("COMERCIALIZACION"))
    .plus(por("ADMINISTRACION"));
  const resultadoAntesImpuestos = resultadoOperativo.plus(por("FINANCIEROS")).plus(por("OTROS"));
  const resultadoEjercicio = resultadoAntesImpuestos.plus(por("GANANCIAS"));

  return {
    secciones,
    resultadoBruto: resultadoBruto.toDecimalPlaces(2),
    resultadoOperativo: resultadoOperativo.toDecimalPlaces(2),
    resultadoAntesImpuestos: resultadoAntesImpuestos.toDecimalPlaces(2),
    resultadoEjercicio: resultadoEjercicio.toDecimalPlaces(2),
  };
}
