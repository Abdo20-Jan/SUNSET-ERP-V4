import { describe, expect, it } from "vitest";

import { agregarSaldoPrestamos } from "@/lib/services/tesoreria-overview-helpers";

type Row = { saldoPendiente: string; saldoPendienteUsd: string | null };

describe("agregarSaldoPrestamos", () => {
  it("lista vacía → ambos buckets en 0.00", () => {
    expect(agregarSaldoPrestamos([])).toEqual({ ars: "0.00", usd: "0.00" });
  });

  it("préstamo USD-nato (saldoPendienteUsd != null) cuenta como USD", () => {
    const rows: Row[] = [{ saldoPendiente: "1500000.00", saldoPendienteUsd: "1000.00" }];
    expect(agregarSaldoPrestamos(rows)).toEqual({ ars: "0.00", usd: "1000.00" });
  });

  it("préstamo ARS (saldoPendienteUsd == null) cuenta como ARS", () => {
    const rows: Row[] = [{ saldoPendiente: "250000.50", saldoPendienteUsd: null }];
    expect(agregarSaldoPrestamos(rows)).toEqual({ ars: "250000.50", usd: "0.00" });
  });

  it("mezcla ARS + USD → suma cada moneda por separado (USD invariante a TC)", () => {
    const rows: Row[] = [
      { saldoPendiente: "1500000.00", saldoPendienteUsd: "1000.00" },
      { saldoPendiente: "750000.00", saldoPendienteUsd: "500.00" },
      { saldoPendiente: "100000.00", saldoPendienteUsd: null },
      { saldoPendiente: "50000.25", saldoPendienteUsd: null },
    ];
    expect(agregarSaldoPrestamos(rows)).toEqual({
      ars: "150000.25",
      usd: "1500.00",
    });
  });
});
