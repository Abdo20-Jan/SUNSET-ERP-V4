import { describe, expect, it } from "vitest";
import { Decimal } from "@/lib/decimal";
import { type MovimientoStockReplay, replayStockNacional } from "@/lib/services/stock-recalc";

// Onda D #14 — el replay del stock vendible (sólo depósitos NACIONAL) es la
// lógica que antes vivía sólo dentro de recalcularStockYCostoPromedio (stock.ts,
// no importable por 'server-only') y que prisma/fix-recalcular-stock-actual.ts
// copiaba SIN tratar TRANSFERENCIA → el script perdía el stock/costo
// nacionalizado vía Modelo Y. Ahora la función pura es compartida; este test
// fija su contrato (incluida la TRANSFERENCIA y el filtro NACIONAL).

const NAC = "NACIONAL" as const;
const ZP = "ZONA_PRIMARIA" as const;

function mov(
  tipo: MovimientoStockReplay["tipo"],
  cantidad: number,
  costoUnitario: string,
  depositoTipo: MovimientoStockReplay["depositoTipo"] = NAC,
): MovimientoStockReplay {
  return { tipo, cantidad, costoUnitario, depositoTipo };
}

describe("replayStockNacional — replay del agregado vendible (Onda D #14)", () => {
  it("INGRESO promedia el costo; EGRESO resta sin diluir", () => {
    const { stock, promedio } = replayStockNacional([
      mov("INGRESO", 10, "1000.00"),
      mov("INGRESO", 10, "2000.00"),
      mov("EGRESO", 4, "0.00"),
    ]);
    expect(stock).toBe(16);
    expect(promedio.toNumber()).toBeCloseTo(1500, 6);
  });

  it("TRANSFERENCIA de entrada al NACIONAL promedia su costo landed (el bug del script)", () => {
    // Nacionalización Modelo Y: el NACIONAL se alimenta SÓLO por una
    // TRANSFERENCIA +10 @ 1500. El script viejo (sin rama TRANSFERENCIA)
    // dejaba stock 0 / costo 0.
    const { stock, promedio } = replayStockNacional([mov("TRANSFERENCIA", 10, "1500.00")]);
    expect(stock).toBe(10);
    expect(promedio.toNumber()).toBeCloseTo(1500, 6);
  });

  it("TRANSFERENCIA de salida (cantidad < 0) resta sin alterar el promedio", () => {
    const { stock, promedio } = replayStockNacional([
      mov("TRANSFERENCIA", 10, "1500.00"),
      mov("TRANSFERENCIA", -4, "0.00"),
    ]);
    expect(stock).toBe(6);
    expect(promedio.toNumber()).toBeCloseTo(1500, 6);
  });

  it("AJUSTE suma cantidad signada manteniendo el promedio", () => {
    const { stock, promedio } = replayStockNacional([
      mov("INGRESO", 10, "1000.00"),
      mov("AJUSTE", -3, "0.00"),
    ]);
    expect(stock).toBe(7);
    expect(promedio.toNumber()).toBeCloseTo(1000, 6);
  });

  it("ignora las patas en depósitos ZONA_PRIMARIA (sólo cuenta NACIONAL)", () => {
    const { stock, promedio } = replayStockNacional([
      mov("INGRESO", 100, "999.00", ZP), // bonded: no entra al agregado vendible
      mov("TRANSFERENCIA", -100, "999.00", ZP), // salida bonded: ignorada
      mov("TRANSFERENCIA", 100, "1500.00", NAC), // entrada vendible
    ]);
    expect(stock).toBe(100);
    expect(promedio.toNumber()).toBeCloseTo(1500, 6);
  });

  it("sin movimientos NACIONAL devuelve stock 0 / promedio 0", () => {
    const { stock, promedio } = replayStockNacional([mov("INGRESO", 50, "1000.00", ZP)]);
    expect(stock).toBe(0);
    expect(promedio.eq(new Decimal(0))).toBe(true);
  });
});
