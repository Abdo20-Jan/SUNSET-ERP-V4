import { describe, expect, it } from "vitest";

import {
  convertirBucket,
  montoNativoPendiente,
  sumarBucketsNativos,
  sumarSaldosNativos,
} from "@/lib/aging-presentacion";

// Helpers PUROS de presentación multimoneda del aging (CxC + saldos por
// proveedor). El motor de cobros/FIFO reconstruye los pendientes en ARS
// (total × TC de emisión − cobros); para presentar en USD nativo revertimos
// por el TC de la propia factura. La suma de buckets debe hacerse POR MONEDA
// NATIVA antes de convertir (lección #262/#263) — nunca ÷tc ciego sobre un
// agregado que mezcla ARS y USD.

describe("montoNativoPendiente", () => {
  it("ARS → passthrough (no divide aunque haya TC)", () => {
    expect(montoNativoPendiente("5000", "ARS", "1200")).toBe("5000");
  });

  it("USD → divide el pendiente ARS por el TC de emisión", () => {
    expect(montoNativoPendiente("120000", "USD", "1200")).toBe("100.00");
  });

  it("USD sin TC → passthrough (degradación segura)", () => {
    expect(montoNativoPendiente("120000", "USD", null)).toBe("120000");
  });

  it("USD con TC inválido (0) → passthrough", () => {
    expect(montoNativoPendiente("120000", "USD", "0")).toBe("120000");
  });

  it("valor no numérico → passthrough", () => {
    expect(montoNativoPendiente("abc", "USD", "1200")).toBe("abc");
  });
});

describe("sumarBucketsNativos", () => {
  it("suma por bucket Y por moneda nativa (sin mezclar)", () => {
    const r = sumarBucketsNativos([
      { bucket: "vencida", moneda: "ARS", montoNativo: "1000" },
      { bucket: "vencida", moneda: "USD", montoNativo: "100" },
      { bucket: "vencida", moneda: "ARS", montoNativo: "250.50" },
      { bucket: "proxima", moneda: "ARS", montoNativo: "500" },
      { bucket: "al_dia", moneda: "USD", montoNativo: "50" },
      { bucket: "sin_fecha", moneda: "USD", montoNativo: "7" },
    ]);
    expect(r.vencida).toEqual({ ars: "1250.50", usd: "100.00" });
    expect(r.proxima).toEqual({ ars: "500.00", usd: "0.00" });
    expect(r.al_dia).toEqual({ ars: "0.00", usd: "50.00" });
    expect(r.sin_fecha).toEqual({ ars: "0.00", usd: "7.00" });
  });

  it("lista vacía → todos los buckets en cero", () => {
    const r = sumarBucketsNativos([]);
    expect(r.vencida).toEqual({ ars: "0.00", usd: "0.00" });
    expect(r.proxima).toEqual({ ars: "0.00", usd: "0.00" });
    expect(r.al_dia).toEqual({ ars: "0.00", usd: "0.00" });
    expect(r.sin_fecha).toEqual({ ars: "0.00", usd: "0.00" });
  });

  it("ignora montos no numéricos", () => {
    const r = sumarBucketsNativos([
      { bucket: "vencida", moneda: "ARS", montoNativo: "100" },
      { bucket: "vencida", moneda: "ARS", montoNativo: "x" },
    ]);
    expect(r.vencida).toEqual({ ars: "100.00", usd: "0.00" });
  });
});

describe("convertirBucket", () => {
  const par = { ars: "1000.00", usd: "100.00" };

  it("vista USD: ARS÷tc + USD 1:1", () => {
    // 1000/1000 = 1 ; 100 (1:1) → 101
    expect(convertirBucket(par, "USD", "1000")).toBe("101.00");
  });

  it("vista ARS: ARS 1:1 + USD×tc", () => {
    // 1000 ; 100×1000 = 100000 → 101000
    expect(convertirBucket(par, "ARS", "1000")).toBe("101000.00");
  });

  it("bucket solo-ARS en vista ARS = el propio ARS", () => {
    expect(convertirBucket({ ars: "750.00", usd: "0.00" }, "ARS", "1200")).toBe("750.00");
  });

  it("bucket solo-USD en vista USD = el propio USD (1:1)", () => {
    expect(convertirBucket({ ars: "0.00", usd: "42.00" }, "USD", "1200")).toBe("42.00");
  });
});

describe("sumarSaldosNativos", () => {
  it("agrega ARS-natas y USD-natas en pernas separadas (pickSaldoNativo agregado)", () => {
    const r = sumarSaldosNativos([
      { saldoArs: "1000000.00" }, // ARS-nata
      { saldoArs: "1200000.00", saldoUsd: "1000.00" }, // USD-nata → cuenta el USD, NO el ARS
      { saldoArs: "500000.00", saldoUsd: null }, // ARS-nata (null explícito)
    ]);
    expect(r).toEqual({ ars: "1500000.00", usd: "1000.00" });
  });

  it("lista vacía → cero/cero", () => {
    expect(sumarSaldosNativos([])).toEqual({ ars: "0.00", usd: "0.00" });
  });
});
