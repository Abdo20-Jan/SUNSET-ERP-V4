import { describe, expect, it } from "vitest";

import { Decimal } from "@/lib/decimal";
import { naturalezaPorDefecto, saldoNatural } from "@/lib/services/cuenta-naturaleza";

describe("naturalezaPorDefecto", () => {
  it("ACTIVO y EGRESO son DEUDOR", () => {
    expect(naturalezaPorDefecto("ACTIVO")).toBe("DEUDOR");
    expect(naturalezaPorDefecto("EGRESO")).toBe("DEUDOR");
  });

  it("PASIVO, PATRIMONIO e INGRESO son ACREEDOR", () => {
    expect(naturalezaPorDefecto("PASIVO")).toBe("ACREEDOR");
    expect(naturalezaPorDefecto("PATRIMONIO")).toBe("ACREEDOR");
    expect(naturalezaPorDefecto("INGRESO")).toBe("ACREEDOR");
  });
});

describe("saldoNatural", () => {
  it("DEUDOR: saldo positivo cuando debe > haber", () => {
    expect(saldoNatural("DEUDOR", new Decimal(100), new Decimal(30)).toString()).toBe("70");
  });

  it("DEUDOR: saldo negativo cuando haber > debe", () => {
    expect(saldoNatural("DEUDOR", new Decimal(0), new Decimal(40)).toString()).toBe("-40");
  });

  it("ACREEDOR: saldo positivo cuando haber > debe", () => {
    expect(saldoNatural("ACREEDOR", new Decimal(30), new Decimal(100)).toString()).toBe("70");
  });

  // Regularizadora contra-activo: Depreciación Acumulada es ACTIVO pero su
  // naturaleza es ACREEDOR. Con saldo acreedor (haber 100, debe 0) su saldo
  // natural debe ser POSITIVO (+100). La lógica vieja basada sólo en categoría
  // (ACTIVO → debe-haber) daría -100, invirtiendo el signo.
  it("regularizadora contra-activo (ACREEDOR) con saldo acreedor da positivo", () => {
    expect(saldoNatural("ACREEDOR", new Decimal(0), new Decimal(100)).toString()).toBe("100");
  });

  // Regularizadora contra-ingreso: Devoluciones sobre Ventas es INGRESO pero
  // naturaleza DEUDOR. Con débito 50 su saldo natural es +50.
  it("regularizadora contra-ingreso (DEUDOR) con saldo deudor da positivo", () => {
    expect(saldoNatural("DEUDOR", new Decimal(50), new Decimal(0)).toString()).toBe("50");
  });
});
