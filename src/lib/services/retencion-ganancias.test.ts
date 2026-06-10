import { describe, expect, it } from "vitest";
import { Decimal } from "decimal.js";

import {
  calcularRetencionGanancias,
  type ParametroRetencionResuelto,
  type ProveedorParaRetencionGanancias,
} from "./retencion-ganancias";

// Parámetro típico: BIENES_DE_CAMBIO / INSCRIPTO — 2% plana, mínimo
// mensual 224.000 (RG 830, congelado).
const PARAM_BIENES: ParametroRetencionResuelto = {
  minimoNoSujeto: "224000.00",
  montoFijo: "0",
  alicuota: "2",
};

const FECHA = new Date("2026-06-09T12:00:00Z");

function proveedor(
  over: Partial<ProveedorParaRetencionGanancias> = {},
): ProveedorParaRetencionGanancias {
  return {
    sujetoRetencionGanancias: true,
    condicionGanancias: "INSCRIPTO",
    conceptoRG830: "BIENES_DE_CAMBIO",
    alicuotaRetencionGananciasOverride: null,
    certificadoExclusionGanancias: null,
    vigenciaCertExclusionGanancias: null,
    ...over,
  };
}

describe("calcularRetencionGanancias — cortocircuitos (no aplica)", () => {
  it("proveedor no sujeto → 0, neto = base", () => {
    const r = calcularRetencionGanancias({
      base: "500000",
      proveedor: proveedor({ sujetoRetencionGanancias: false }),
      parametro: PARAM_BIENES,
      fechaPago: FECHA,
    });
    expect(r.aplica).toBe(false);
    expect(r.motivoNoAplica).toBe("NO_SUJETO");
    expect(r.importeRetenido.toNumber()).toBe(0);
    expect(r.importeNetoAPagar.toFixed(2)).toBe("500000.00");
  });

  it("condición EXENTO → 0", () => {
    const r = calcularRetencionGanancias({
      base: "500000",
      proveedor: proveedor({ condicionGanancias: "EXENTO" }),
      parametro: PARAM_BIENES,
      fechaPago: FECHA,
    });
    expect(r.motivoNoAplica).toBe("EXENTO");
    expect(r.importeRetenido.toNumber()).toBe(0);
  });

  it("condición MONOTRIBUTO → 0", () => {
    const r = calcularRetencionGanancias({
      base: "500000",
      proveedor: proveedor({ condicionGanancias: "MONOTRIBUTO" }),
      parametro: PARAM_BIENES,
      fechaPago: FECHA,
    });
    expect(r.motivoNoAplica).toBe("MONOTRIBUTO");
    expect(r.importeRetenido.toNumber()).toBe(0);
  });

  it("certificado de exclusión vigente → 0", () => {
    const r = calcularRetencionGanancias({
      base: "500000",
      proveedor: proveedor({
        certificadoExclusionGanancias: "EXC-123",
        vigenciaCertExclusionGanancias: new Date("2026-12-31T00:00:00Z"),
      }),
      parametro: PARAM_BIENES,
      fechaPago: FECHA,
    });
    expect(r.motivoNoAplica).toBe("CERT_EXCLUSION_VIGENTE");
    expect(r.importeRetenido.toNumber()).toBe(0);
  });

  it("certificado de exclusión vencido → SÍ retiene", () => {
    const r = calcularRetencionGanancias({
      base: "500000",
      proveedor: proveedor({
        certificadoExclusionGanancias: "EXC-OLD",
        vigenciaCertExclusionGanancias: new Date("2026-01-01T00:00:00Z"),
      }),
      parametro: PARAM_BIENES,
      fechaPago: FECHA,
    });
    expect(r.aplica).toBe(true);
    expect(r.importeRetenido.toNumber()).toBeGreaterThan(0);
  });

  it("sin concepto RG 830 → 0", () => {
    const r = calcularRetencionGanancias({
      base: "500000",
      proveedor: proveedor({ conceptoRG830: null }),
      parametro: PARAM_BIENES,
      fechaPago: FECHA,
    });
    expect(r.motivoNoAplica).toBe("SIN_CONCEPTO");
  });

  it("sin parámetro fiscal → 0", () => {
    const r = calcularRetencionGanancias({
      base: "500000",
      proveedor: proveedor(),
      parametro: null,
      fechaPago: FECHA,
    });
    expect(r.motivoNoAplica).toBe("SIN_PARAMETRO");
  });
});

describe("calcularRetencionGanancias — mínimo mensual acumulado", () => {
  it("base bajo el mínimo, sin acumulado previo → 0", () => {
    const r = calcularRetencionGanancias({
      base: "100000",
      baseAcumuladaMesPrevio: "0",
      proveedor: proveedor(),
      parametro: PARAM_BIENES,
      fechaPago: FECHA,
    });
    expect(r.aplica).toBe(false);
    expect(r.motivoNoAplica).toBe("BAJO_MINIMO_MENSUAL");
    expect(r.importeRetenido.toNumber()).toBe(0);
  });

  it("primer pago que cruza el mínimo → retiene sólo sobre el excedente", () => {
    // base 300.000, mínimo 224.000 → excedente 76.000 × 2% = 1.520
    const r = calcularRetencionGanancias({
      base: "300000",
      baseAcumuladaMesPrevio: "0",
      proveedor: proveedor(),
      parametro: PARAM_BIENES,
      fechaPago: FECHA,
    });
    expect(r.aplica).toBe(true);
    expect(r.baseExcedente.toFixed(2)).toBe("76000.00");
    expect(r.importeRetenido.toFixed(2)).toBe("1520.00");
    expect(r.importeNetoAPagar.toFixed(2)).toBe("298480.00");
  });

  it("segundo pago del mes (mínimo ya consumido) → retiene sobre la base completa", () => {
    // acumulado previo 300.000 (> mínimo) → este pago de 50.000 retiene
    // sobre 50.000 × 2% = 1.000
    const r = calcularRetencionGanancias({
      base: "50000",
      baseAcumuladaMesPrevio: "300000",
      proveedor: proveedor(),
      parametro: PARAM_BIENES,
      fechaPago: FECHA,
    });
    expect(r.aplica).toBe(true);
    expect(r.baseExcedente.toFixed(2)).toBe("50000.00");
    expect(r.importeRetenido.toFixed(2)).toBe("1000.00");
  });

  it("pago que cruza el mínimo teniendo acumulado previo parcial", () => {
    // previo 200.000 (< mínimo), base 100.000 → acumulado 300.000
    // excedente = 300.000 - 224.000 = 76.000 × 2% = 1.520
    const r = calcularRetencionGanancias({
      base: "100000",
      baseAcumuladaMesPrevio: "200000",
      proveedor: proveedor(),
      parametro: PARAM_BIENES,
      fechaPago: FECHA,
    });
    expect(r.aplica).toBe(true);
    expect(r.baseExcedente.toFixed(2)).toBe("76000.00");
    expect(r.importeRetenido.toFixed(2)).toBe("1520.00");
  });

  it("acumulado exactamente igual al mínimo → 0 (no supera)", () => {
    const r = calcularRetencionGanancias({
      base: "224000",
      baseAcumuladaMesPrevio: "0",
      proveedor: proveedor(),
      parametro: PARAM_BIENES,
      fechaPago: FECHA,
    });
    expect(r.aplica).toBe(false);
    expect(r.motivoNoAplica).toBe("BAJO_MINIMO_MENSUAL");
  });
});

describe("calcularRetencionGanancias — alícuota / escala / redondeo", () => {
  it("override de alícuota del proveedor prevalece sobre el parámetro", () => {
    // 300.000 - 224.000 = 76.000 × 1% (override) = 760
    const r = calcularRetencionGanancias({
      base: "300000",
      proveedor: proveedor({ alicuotaRetencionGananciasOverride: "1" }),
      parametro: PARAM_BIENES,
      fechaPago: FECHA,
    });
    expect(r.alicuota.toString()).toBe("1");
    expect(r.importeRetenido.toFixed(2)).toBe("760.00");
  });

  it("escala con monto fijo: se aplica sólo en el pago que cruza el umbral", () => {
    const paramEscala: ParametroRetencionResuelto = {
      minimoNoSujeto: "100000",
      montoFijo: "5000",
      alicuota: "10",
    };
    // cruza: previo 0, base 150.000 → excedente 50.000 × 10% + 5.000 = 10.000
    const cruza = calcularRetencionGanancias({
      base: "150000",
      baseAcumuladaMesPrevio: "0",
      proveedor: proveedor({ conceptoRG830: "HONORARIOS" }),
      parametro: paramEscala,
      fechaPago: FECHA,
    });
    expect(cruza.importeRetenido.toFixed(2)).toBe("10000.00");
    expect(cruza.montoFijo.toFixed(2)).toBe("5000.00");

    // posterior: previo 150.000 (> mínimo), base 20.000 → 20.000 × 10% (sin fijo) = 2.000
    const posterior = calcularRetencionGanancias({
      base: "20000",
      baseAcumuladaMesPrevio: "150000",
      proveedor: proveedor({ conceptoRG830: "HONORARIOS" }),
      parametro: paramEscala,
      fechaPago: FECHA,
    });
    expect(posterior.importeRetenido.toFixed(2)).toBe("2000.00");
    expect(posterior.montoFijo.toFixed(2)).toBe("0.00");
  });

  it("redondea ROUND_HALF_UP a 2 decimales", () => {
    // excedente 1 con alícuota 2,555% → 0.02555 → 0.03
    const r = calcularRetencionGanancias({
      base: "224001",
      baseAcumuladaMesPrevio: "0",
      proveedor: proveedor(),
      parametro: { minimoNoSujeto: "224000", montoFijo: "0", alicuota: "2.555" },
      fechaPago: FECHA,
    });
    expect(r.baseExcedente.toFixed(2)).toBe("1.00");
    expect(r.importeRetenido.toFixed(2)).toBe("0.03");
  });

  it("invariante: retenido + neto = base", () => {
    const r = calcularRetencionGanancias({
      base: "987654.32",
      baseAcumuladaMesPrevio: "0",
      proveedor: proveedor(),
      parametro: PARAM_BIENES,
      fechaPago: FECHA,
    });
    const suma = r.importeRetenido.plus(r.importeNetoAPagar);
    expect(suma.toFixed(2)).toBe(new Decimal("987654.32").toFixed(2));
  });
});
