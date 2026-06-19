import { toDecimal } from "@/lib/decimal";
import { convertirMonto } from "@/lib/format";

// ============================================================
// Presentación multimoneda del aging (cuentas a cobrar + saldos por
// proveedor). El motor de cobros/FIFO reconstruye los pendientes en ARS
// (total × TC de emisión − cobros). Para presentar en USD nativo revertimos
// por el TC de la propia factura, y la suma de buckets se hace POR MONEDA
// NATIVA antes de convertir (lección #262/#263) — nunca ÷tc ciego sobre un
// agregado que mezcla ARS y USD.
// ============================================================

export type BucketKey = "vencida" | "proxima" | "al_dia" | "sin_fecha";

/** Par de saldos nativos de un bucket: parte ARS-nativa + parte USD-nativa. */
export type ParNativo = { ars: string; usd: string };

export type ItemBucketNativo = {
  bucket: BucketKey;
  moneda: string;
  /** Pendiente ya expresado en la moneda nativa (ver montoNativoPendiente). */
  montoNativo: string;
};

/**
 * Devuelve el pendiente en su moneda NATIVA a partir del pendiente en ARS.
 * - ARS (u otra que no sea USD) → passthrough (ya es nativo).
 * - USD → divide por el TC de emisión de la factura (revierte la conversión).
 * - Sin TC válido o valor no finito → passthrough (degradación segura; en el
 *   servicio el TC de emisión siempre existe, así que esto es defensivo).
 */
export function montoNativoPendiente(
  montoArs: string,
  moneda: string,
  tipoCambio: string | null | undefined,
): string {
  if (moneda !== "USD") return montoArs;
  const n = Number.parseFloat(montoArs);
  if (!Number.isFinite(n)) return montoArs;
  if (!tipoCambio) return montoArs;
  const tc = Number.parseFloat(tipoCambio);
  if (!Number.isFinite(tc) || tc <= 0) return montoArs;
  return (n / tc).toFixed(2);
}

const BUCKETS: BucketKey[] = ["vencida", "proxima", "al_dia", "sin_fecha"];

/**
 * Agrega una lista de pendientes por bucket Y por moneda nativa. Los montos
 * USD se acumulan aparte de los ARS — la conversión a la moneda de
 * presentación ocurre después (convertirBucket), nunca sobre la mezcla.
 */
export function sumarBucketsNativos(items: ItemBucketNativo[]): Record<BucketKey, ParNativo> {
  const acc: Record<
    BucketKey,
    { ars: ReturnType<typeof toDecimal>; usd: ReturnType<typeof toDecimal> }
  > = {
    vencida: { ars: toDecimal(0), usd: toDecimal(0) },
    proxima: { ars: toDecimal(0), usd: toDecimal(0) },
    al_dia: { ars: toDecimal(0), usd: toDecimal(0) },
    sin_fecha: { ars: toDecimal(0), usd: toDecimal(0) },
  };

  for (const it of items) {
    // El servicio legado agrupa las facturas sin fecha de vencimiento en
    // "al día" (rama else); espelhamos para que el total presentado coincida
    // con los campos legados vencido/proximo/alDia.
    const bucket = it.bucket === "sin_fecha" ? "al_dia" : it.bucket;
    const par = acc[bucket];
    if (!par) continue;
    const n = Number.parseFloat(it.montoNativo);
    if (!Number.isFinite(n)) continue;
    if (it.moneda === "USD") par.usd = par.usd.plus(n);
    else par.ars = par.ars.plus(n);
  }

  const out = {} as Record<BucketKey, ParNativo>;
  for (const b of BUCKETS) {
    out[b] = { ars: acc[b].ars.toFixed(2), usd: acc[b].usd.toFixed(2) };
  }
  return out;
}

/**
 * Suma una lista de saldos por contraparte/cuenta en su par nativo {ars, usd}.
 * Cada item aporta a la perna de su moneda nativa (USD si saldoUsd está
 * presente — pickSaldoNativo agregado; si no, ARS). Pensado para el KPI
 * "Saldo contable total" native-aware, que después se convierte con
 * convertirBucket — nunca sumando ARS+USD antes de convertir.
 */
export function sumarSaldosNativos(
  items: Array<{ saldoArs: string; saldoUsd?: string | null }>,
): ParNativo {
  let ars = toDecimal(0);
  let usd = toDecimal(0);
  for (const it of items) {
    if (it.saldoUsd != null) {
      const n = Number.parseFloat(it.saldoUsd);
      if (Number.isFinite(n)) usd = usd.plus(n);
    } else {
      const n = Number.parseFloat(it.saldoArs);
      if (Number.isFinite(n)) ars = ars.plus(n);
    }
  }
  return { ars: ars.toFixed(2), usd: usd.toFixed(2) };
}

/**
 * Convierte un par nativo {ars, usd} a la moneda de presentación y devuelve el
 * total (string). Cada perna se convierte por separado vía convertirMonto
 * (native-aware) antes de sumar — así un saldo USD nativo no se re-divide.
 */
export function convertirBucket(
  par: ParNativo,
  monedaPres: "ARS" | "USD",
  tc: string | null | undefined,
): string {
  const arsConv = convertirMonto(par.ars, "ARS", monedaPres, tc);
  const usdConv = convertirMonto(par.usd, "USD", monedaPres, tc);
  return toDecimal(arsConv).plus(toDecimal(usdConv)).toFixed(2);
}
