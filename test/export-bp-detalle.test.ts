import { describe, expect, it } from "vitest";

import {
  type EmbarqueStockInput,
  type ProveedorExteriorInput,
  agruparDetalleExterior,
  mapearDetalleStockTransito,
} from "@/lib/services/reportes/export/balance-bp-detalle";

const proveedores: ProveedorExteriorInput[] = [
  {
    proveedorNombre: "QINGDAO TIRES CO",
    embarques: [
      { embarqueCodigo: "BR-250901-016CN", saldoUsd: "8000.00" },
      { embarqueCodigo: "BR-250827-015CN", saldoUsd: "12000.00" },
    ],
    facturasSueltas: [{ numero: "INV-77", saldoUsd: "500.00" }],
  },
];

describe("agruparDetalleExterior", () => {
  it("gera uma linha por embarque (USD nativo) + ARS = USD × TC", () => {
    const d = agruparDetalleExterior(proveedores, "1000");
    expect(d).toHaveLength(3);
    const e1 = d.find((l) => l.embarqueCodigo === "BR-250827-015CN");
    expect(e1?.usd).toBe("12000.00");
    expect(e1?.ars).toBe("12000000.00");
    expect(e1?.descripcion).toBe("QINGDAO TIRES CO");
  });

  it("inclui facturas sueltas com rótulo (sin embarque) e nº de factura", () => {
    const d = agruparDetalleExterior(proveedores, "1000");
    const suelta = d.find((l) => l.embarqueCodigo === "(sin embarque)");
    expect(suelta?.usd).toBe("500.00");
    expect(suelta?.descripcion).toContain("INV-77");
  });

  it("sem TC: ARS = passthrough do USD (degradação segura)", () => {
    const d = agruparDetalleExterior(proveedores, null);
    const e1 = d.find((l) => l.embarqueCodigo === "BR-250827-015CN");
    expect(e1?.usd).toBe("12000.00");
    expect(e1?.ars).toBe("12000.00");
  });
});

const embarques: EmbarqueStockInput[] = [
  {
    embarqueCodigo: "BR-250827-015CN",
    proveedorNombre: "QINGDAO TIRES CO",
    moneda: "USD",
    fob: "20000.00",
  },
  {
    embarqueCodigo: "AR-LOCAL-01",
    proveedorNombre: "PROV LOCAL",
    moneda: "ARS",
    fob: "5000000.00",
  },
];

describe("mapearDetalleStockTransito", () => {
  it("USD nativo: usd = fob, ars = fob × TC (não re-divide)", () => {
    const d = mapearDetalleStockTransito(embarques, "1000");
    const usdEmb = d.find((l) => l.embarqueCodigo === "BR-250827-015CN");
    expect(usdEmb?.usd).toBe("20000.00");
    expect(usdEmb?.ars).toBe("20000000.00");
    expect(usdEmb?.descripcion).toBe("QINGDAO TIRES CO");
  });

  it("ARS nativo: ars = fob, usd = fob ÷ TC (native-aware)", () => {
    const d = mapearDetalleStockTransito(embarques, "1000");
    const arsEmb = d.find((l) => l.embarqueCodigo === "AR-LOCAL-01");
    expect(arsEmb?.ars).toBe("5000000.00");
    expect(arsEmb?.usd).toBe("5000.00");
  });

  it("sem TC: cada lado mantém o nativo (passthrough)", () => {
    const d = mapearDetalleStockTransito(embarques, null);
    const usdEmb = d.find((l) => l.embarqueCodigo === "BR-250827-015CN");
    expect(usdEmb?.usd).toBe("20000.00");
    expect(usdEmb?.ars).toBe("20000.00");
  });
});
