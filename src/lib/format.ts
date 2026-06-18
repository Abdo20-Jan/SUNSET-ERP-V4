const fmtAR = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const fmtAR6 = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 6,
  maximumFractionDigits: 6,
});

const fmtIntAR = new Intl.NumberFormat("es-AR", {
  maximumFractionDigits: 0,
});

// Renderiza la fecha en UTC para que SSR (server en UTC) y hydration
// (cliente en Argentina UTC-3) produzcan exactamente el mismo string y
// evitar React #418 (hydration mismatch) en cualquier celda con fecha.
// Las fechas-solo (PeriodoContable.fechaInicio/Fin, Compra.fechaVencimiento,
// Venta.fecha) son persistidas como midnight UTC; el componente lógico
// (DD/MM/YYYY) es invariante al timezone.
const fmtDateAR = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});

export function fmtMoney(value: string): string {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? fmtAR.format(n) : value;
}

export function fmtMoneyOrDash(value: string): string {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n) || n === 0) return "—";
  return fmtAR.format(n);
}

export function fmtCredito(value: string): string {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n) || n === 0) return fmtAR.format(0);
  return `(${fmtAR.format(n)})`;
}

/**
 * Convierte un monto en ARS (string serializado) a USD usando un TC dado.
 * Si tc es null/0/undefined, devuelve el valor original sin tocar.
 */
export function convertirAUsd(valueArs: string, tc: string | null | undefined): string {
  if (!tc) return valueArs;
  const tcN = Number.parseFloat(tc);
  if (!Number.isFinite(tcN) || tcN <= 0) return valueArs;
  const n = Number.parseFloat(valueArs);
  if (!Number.isFinite(n)) return valueArs;
  return (n / tcN).toFixed(2);
}

/**
 * Convierte un monto desde su moneda NATIVA a la moneda de presentación, usando
 * el TC de cierre ("ARS por USD"). A diferencia de `convertirAUsd`, es
 * native-aware: preserva lo que ya está en la moneda destino ("1 a 1") y sólo
 * convierte lo que está en otra moneda. Pensado para el dashboard, donde cada
 * saldo bancario / préstamo viene en su moneda nativa (mixta).
 * Si no hay TC válido (null/0/NaN) o el valor no es finito, devuelve el valor
 * original sin tocar (degradación segura).
 */
export function convertirMonto(
  valorNativo: string,
  monedaNativa: "ARS" | "USD",
  monedaDestino: "ARS" | "USD",
  tc: string | null | undefined,
): string {
  if (monedaNativa === monedaDestino) return valorNativo;
  const n = Number.parseFloat(valorNativo);
  if (!Number.isFinite(n)) return valorNativo;
  if (!tc) return valorNativo;
  const tcN = Number.parseFloat(tc);
  if (!Number.isFinite(tcN) || tcN <= 0) return valorNativo;
  // monedaNativa ≠ monedaDestino: o bien USD→ARS (×TC) o ARS→USD (÷TC).
  const convertido = monedaNativa === "USD" ? n * tcN : n / tcN;
  return convertido.toFixed(2);
}

export function fmtSigno(value: string): "positive" | "negative" | "zero" {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n) || n === 0) return "zero";
  return n > 0 ? "positive" : "negative";
}

export function fmtTipoCambio(value: string): string {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? fmtAR6.format(n) : value;
}

export function fmtInt(value: number): string {
  return fmtIntAR.format(value);
}

export function fmtDate(value: Date): string {
  return fmtDateAR.format(value);
}

/** Acepta `Date | string | null | undefined` y devuelve "DD/MM/YYYY" o "—". */
export function fmtDateOrDash(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return fmtDateAR.format(d);
}

const DAY_MS = 86_400_000;

export type VencimientoStatus = "overdue" | "soon" | "ok" | "none";

/**
 * Clasifica una fecha de vencimiento relativa a hoy:
 * - "overdue": ya pasó.
 * - "soon": vence en los próximos 7 días (o hoy).
 * - "ok": vence en más de 7 días.
 * - "none": fecha inválida o nula.
 */
export function vencimientoStatus(
  fechaVencimiento: Date | string | null | undefined,
  reference: Date = new Date(),
): VencimientoStatus {
  if (!fechaVencimiento) return "none";
  const d = typeof fechaVencimiento === "string" ? new Date(fechaVencimiento) : fechaVencimiento;
  if (Number.isNaN(d.getTime())) return "none";

  // Normalizar a inicio del día en UTC para que SSR y hydration calculen
  // el mismo diffDays. setHours() usa TZ local y diverge entre Vercel (UTC)
  // y el cliente Argentino (UTC-3), causando React #418.
  const today = new Date(reference);
  today.setUTCHours(0, 0, 0, 0);
  const due = new Date(d);
  due.setUTCHours(0, 0, 0, 0);

  const diffDays = Math.round((due.getTime() - today.getTime()) / DAY_MS);
  if (diffDays < 0) return "overdue";
  if (diffDays <= 7) return "soon";
  return "ok";
}

/** "Vence hoy", "Vence en 5 días", "Vencida hace 3 días". */
export function vencimientoLabel(
  fechaVencimiento: Date | string | null | undefined,
  reference: Date = new Date(),
): string {
  if (!fechaVencimiento) return "—";
  const d = typeof fechaVencimiento === "string" ? new Date(fechaVencimiento) : fechaVencimiento;
  if (Number.isNaN(d.getTime())) return "—";

  // setUTCHours para evitar hydration mismatch (server UTC vs client UTC-3).
  const today = new Date(reference);
  today.setUTCHours(0, 0, 0, 0);
  const due = new Date(d);
  due.setUTCHours(0, 0, 0, 0);
  const diffDays = Math.round((due.getTime() - today.getTime()) / DAY_MS);

  if (diffDays === 0) return "Vence hoy";
  if (diffDays === 1) return "Vence mañana";
  if (diffDays === -1) return "Vencida hace 1 día";
  if (diffDays > 0) return `Vence en ${diffDays} días`;
  return `Vencida hace ${Math.abs(diffDays)} días`;
}
