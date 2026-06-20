import { describe, expect, it } from "vitest";
import { Decimal } from "@/lib/decimal";
import {
  type AsientoBalance,
  detectarAsientosDescuadrados,
} from "@/lib/services/bi-invariantes-formulas";

const asiento = (
  numero: number,
  debe: string | number,
  haber: string | number,
): AsientoBalance => ({
  numero,
  totalDebe: new Decimal(debe),
  totalHaber: new Decimal(haber),
});

describe("detectarAsientosDescuadrados", () => {
  it("array vacío → sin violaciones", () => {
    expect(detectarAsientosDescuadrados([])).toEqual([]);
  });

  it("asiento balanceado (Σdebe == Σhaber) → sin violaciones", () => {
    expect(detectarAsientosDescuadrados([asiento(1, "1500.50", "1500.50")])).toEqual([]);
  });

  it("asiento descuadrado → 1 violación con número, totales y diferencia firmada", () => {
    const v = detectarAsientosDescuadrados([asiento(7, "1000.00", "999.50")]);
    expect(v).toHaveLength(1);
    expect(v[0]).toEqual({
      numero: 7,
      totalDebe: "1000.00",
      totalHaber: "999.50",
      diferencia: "0.50",
    });
  });

  it("diferencia negativa cuando haber > debe", () => {
    const v = detectarAsientosDescuadrados([asiento(8, "100.00", "150.00")]);
    expect(v[0].diferencia).toBe("-50.00");
  });

  it("múltiplos asientos → sólo los descuadrados, en orden", () => {
    const v = detectarAsientosDescuadrados([
      asiento(1, "100.00", "100.00"),
      asiento(2, "200.00", "180.00"),
      asiento(3, "300.00", "300.00"),
      asiento(4, "50.00", "55.00"),
    ]);
    expect(v.map((x) => x.numero)).toEqual([2, 4]);
  });

  it("borde de precisión: mismo valor en escalas Decimal distintas → balanceado (no === ingenuo)", () => {
    // `1000` y `1000.00` son instancias Decimal distintas con el mismo valor:
    // un `===` ingenuo las marcaría como descuadradas; eqMoney las iguala.
    const v = detectarAsientosDescuadrados([
      { numero: 9, totalDebe: new Decimal("1000"), totalHaber: new Decimal("1000.00") },
    ]);
    expect(v).toEqual([]);
  });
});
