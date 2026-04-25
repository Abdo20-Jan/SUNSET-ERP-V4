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

const fmtDateAR = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
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
