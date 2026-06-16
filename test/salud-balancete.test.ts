import { describe, expect, it } from "vitest";

import { Decimal } from "@/lib/decimal";
import { type CuentaSaldo, detectarAnomaliasBalancete } from "@/lib/services/salud-balancete";

function cuenta(over: Partial<CuentaSaldo> & Pick<CuentaSaldo, "codigo">): CuentaSaldo {
  return {
    categoria: "ACTIVO",
    naturaleza: "DEUDOR",
    tipo: "ANALITICA",
    debe: new Decimal(0),
    haber: new Decimal(0),
    ...over,
  };
}

describe("detectarAnomaliasBalancete", () => {
  it("marca cuenta de estoque (ACTIVO/DEUDOR) con saldo acreedor como anomalía", () => {
    // 1.1.5.03 con haber 152 y debe 0 → saldo natural −152 (invertido, no comercial)
    const anomalias = detectarAnomaliasBalancete([
      cuenta({ codigo: "1.1.7.05", haber: new Decimal(152) }),
    ]);
    expect(anomalias).toHaveLength(1);
    expect(anomalias[0].codigo).toBe("1.1.7.05");
    expect(anomalias[0].saldo).toBe("-152.00");
  });

  it("NO marca una regularizadora (ACTIVO/ACREEDOR) con saldo acreedor", () => {
    // Depreciación Acumulada: su saldo natural es +100 (no invertido).
    const anomalias = detectarAnomaliasBalancete([
      cuenta({ codigo: "1.2.1.09", naturaleza: "ACREEDOR", haber: new Decimal(100) }),
    ]);
    expect(anomalias).toHaveLength(0);
  });

  it("NO marca un proveedor (2.1.1.x) con saldo deudor (saldo a favor comercial)", () => {
    // Proveedor PASIVO/ACREEDOR con debe>haber → invertido pero reclasificable.
    const anomalias = detectarAnomaliasBalancete([
      cuenta({
        codigo: "2.1.1.20",
        categoria: "PASIVO",
        naturaleza: "ACREEDOR",
        debe: new Decimal(82),
      }),
    ]);
    expect(anomalias).toHaveLength(0);
  });

  it("NO marca un cliente (1.1.3.x) con saldo acreedor (anticipo comercial)", () => {
    const anomalias = detectarAnomaliasBalancete([
      cuenta({ codigo: "1.1.4.10", haber: new Decimal(300) }),
    ]);
    expect(anomalias).toHaveLength(0);
  });

  it("marca un banco (1.1.2.x ACTIVO/DEUDOR) con saldo acreedor como anomalía", () => {
    const anomalias = detectarAnomaliasBalancete([
      cuenta({ codigo: "1.1.2.10", haber: new Decimal(1814) }),
    ]);
    expect(anomalias).toHaveLength(1);
    expect(anomalias[0].codigo).toBe("1.1.2.10");
  });

  it("NO marca cuentas con saldo en su naturaleza (positivo)", () => {
    const anomalias = detectarAnomaliasBalancete([
      cuenta({ codigo: "1.1.7.01", debe: new Decimal(40) }),
      cuenta({
        codigo: "2.1.1.01",
        categoria: "PASIVO",
        naturaleza: "ACREEDOR",
        haber: new Decimal(500),
      }),
    ]);
    expect(anomalias).toHaveLength(0);
  });

  it("ignora cuentas SINTETICAS (sólo evalúa analíticas imputables)", () => {
    const anomalias = detectarAnomaliasBalancete([
      cuenta({ codigo: "1.1.5", tipo: "SINTETICA", haber: new Decimal(999) }),
    ]);
    expect(anomalias).toHaveLength(0);
  });

  it("usa naturaleza por defecto de la categoría cuando naturaleza es null", () => {
    // Sin naturaleza explícita, una cuenta ACTIVO con saldo acreedor es anomalía.
    const anomalias = detectarAnomaliasBalancete([
      cuenta({ codigo: "1.1.7.04", naturaleza: null, haber: new Decimal(34) }),
    ]);
    expect(anomalias).toHaveLength(1);
    expect(anomalias[0].codigo).toBe("1.1.7.04");
  });
});
