import { describe, expect, it } from "vitest";

import { Decimal, sumMoney } from "@/lib/decimal";
import { construirModeloBP } from "@/lib/services/reportes/export/balance-bp-modelo";
import type { CuentaTreeNode } from "@/lib/services/reportes/shared";

function leaf(
  codigo: string,
  saldo: number,
  rubroEECC: string | null,
  nombre = codigo,
): CuentaTreeNode {
  return {
    id: Number(codigo.replace(/\D/g, "")) || 1,
    codigo,
    nombre,
    tipo: "ANALITICA",
    categoria: "ACTIVO",
    nivel: codigo.split(".").length,
    rubroEECC,
    saldoInicial: new Decimal(0),
    debe: new Decimal(0),
    haber: new Decimal(0),
    saldo: new Decimal(saldo),
    children: [],
  };
}

function syn(codigo: string, nombre: string, children: CuentaTreeNode[]): CuentaTreeNode {
  return {
    id: -(Number(codigo.replace(/\D/g, "")) || 1),
    codigo,
    nombre,
    tipo: "SINTETICA",
    categoria: "ACTIVO",
    nivel: codigo.split(".").length,
    rubroEECC: null,
    saldoInicial: new Decimal(0),
    debe: new Decimal(0),
    haber: new Decimal(0),
    saldo: sumMoney(children.map((c) => c.saldo)),
    children,
  };
}

// Balance pequeno e balanceado:
//   ATIVO 6000 = DISPONIBILIDADE 1000 + STOCK 5000
//   PASIVO 3500 = PROVEDORES_EXTERIOR 3000 + PROVISIONAMENTOS 500
//   PL 2500 = Capital 2000 + Resultado 500
function bgFixture() {
  const activo = [
    // agrupado por rubro (espelha reagruparPorRubroEECC): grupo sintético com
    // a hoja real dentro.
    syn("—", "Caja y bancos", [leaf("1.1.1.01.01", 1000, "Caja y bancos", "CAJA GENERAL")]),
    leaf("1.1.7.01", 5000, "Bienes de cambio", "MERCADERÍAS"),
  ];
  const pasivo = [
    leaf("2.1.1.02.01", 3000, "Cuentas por pagar comerciales", "PROVEEDOR EXTERIOR"),
    leaf("2.1.3.01", 500, "Cargas fiscales", "IVA DÉBITO"),
  ];
  const patrimonio = [leaf("3.1.01", 2000, "Aportes de los propietarios", "CAPITAL SOCIAL")];
  return {
    activo,
    pasivo,
    patrimonio,
    totalActivo: new Decimal(6000),
    totalPasivo: new Decimal(3500),
    totalPatrimonioAjustado: new Decimal(2500),
    resultadoEjercicio: new Decimal(500),
    diferencia: new Decimal(0),
    cuadra: true,
  };
}

describe("construirModeloBP", () => {
  it("achata as árvores em blocos artesanais com subtotais corretos (USD = ARS ÷ TC)", () => {
    const m = construirModeloBP(bgFixture(), { tc: "10", fecha: "2025-12-31" });

    const disp = m.ativo.find((b) => b.key === "DISPONIBILIDADE");
    expect(disp?.subtotalArs).toBe("1000.00");
    expect(disp?.subtotalUsd).toBe("100.00");
    expect(disp?.lineas[0]?.codigo).toBe("1.1.1.01.01");
    expect(disp?.lineas[0]?.usd).toBe("100.00");

    const stock = m.ativo.find((b) => b.key === "STOCK");
    expect(stock?.subtotalArs).toBe("5000.00");

    expect(m.totalAtivoArs).toBe("6000.00");
    expect(m.totalAtivoUsd).toBe("600.00");
  });

  it("divide proveedores e mapeia provisionamentos no PASIVO", () => {
    const m = construirModeloBP(bgFixture(), { tc: "10", fecha: "2025-12-31" });

    expect(m.pasivo.find((b) => b.key === "PROVEDORES_EXTERIOR")?.subtotalArs).toBe("3000.00");
    expect(m.pasivo.find((b) => b.key === "PROVISIONAMENTOS")?.subtotalArs).toBe("500.00");
    expect(m.totalPasivoArs).toBe("3500.00");
  });

  it("inclui RESULTADO DEL EJERCICIO no PL e o total bate com o ajustado", () => {
    const m = construirModeloBP(bgFixture(), { tc: "10", fecha: "2025-12-31" });

    const pl = m.pl.find((b) => b.key === "PATRIMONIO_LIQUIDO");
    expect(pl?.lineas.some((l) => l.descripcion === "RESULTADO DEL EJERCICIO")).toBe(true);
    expect(pl?.subtotalArs).toBe("2500.00");
    expect(m.totalPlArs).toBe("2500.00");
  });

  it("confere o balanço (▲ = 0) e propaga cuadra", () => {
    const m = construirModeloBP(bgFixture(), { tc: "10", fecha: "2025-12-31" });
    expect(m.checkArs).toBe("0.00");
    expect(m.cuadra).toBe(true);
  });

  it("mantém a ordem por liquidez (DISPONIBILIDADE antes de STOCK)", () => {
    const m = construirModeloBP(bgFixture(), { tc: "10", fecha: "2025-12-31" });
    const keys = m.ativo.map((b) => b.key);
    expect(keys.indexOf("DISPONIBILIDADE")).toBeLessThan(keys.indexOf("STOCK"));
  });

  it("sem TC: coluna USD = passthrough do ARS", () => {
    const m = construirModeloBP(bgFixture(), { tc: null, fecha: "2025-12-31" });
    const disp = m.ativo.find((b) => b.key === "DISPONIBILIDADE");
    expect(disp?.subtotalUsd).toBe("1000.00");
    expect(m.totalAtivoUsd).toBe("6000.00");
  });

  it("omite blocos sem linhas (saldo zero)", () => {
    const m = construirModeloBP(bgFixture(), { tc: "10", fecha: "2025-12-31" });
    expect(m.ativo.some((b) => b.key === "IMOBILIZADO")).toBe(false);
  });
});
