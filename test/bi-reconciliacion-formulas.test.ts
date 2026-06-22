import { describe, expect, it } from "vitest";

import {
  buscarNodoPorCodigo,
  buscarSaldoRazon,
  compararSaldo,
  type NodoBalanceReconciliable,
  sumarSaldosSubledger,
  TOLERANCIA_RECONCILIACION,
} from "@/lib/services/bi-reconciliacion-formulas";

describe("compararSaldo", () => {
  it("razão == subledger → ok, diferencia 0", () => {
    const r = compararSaldo({ rubro: "clientes", saldoRazon: 1000, saldoSubledger: 1000 });
    expect(r).toEqual({
      rubro: "clientes",
      saldoRazon: 1000,
      saldoSubledger: 1000,
      diferencia: 0,
      ok: true,
    });
  });

  it("diferença dentro da tolerância sub-centavo → ok", () => {
    const r = compararSaldo({ rubro: "clientes", saldoRazon: 1000.004, saldoSubledger: 1000 });
    expect(r.diferencia).toBeCloseTo(0.004, 6);
    expect(r.ok).toBe(true);
  });

  it("diferença no limiar (0.005) NÃO é ok (estritamente menor)", () => {
    const r = compararSaldo({ rubro: "proveedores", saldoRazon: 1000.005, saldoSubledger: 1000 });
    expect(r.ok).toBe(false);
    expect(TOLERANCIA_RECONCILIACION).toBe(0.005);
  });

  it("mismatch forçado → ok:false e diferencia exata (razão − subledger)", () => {
    const r = compararSaldo({ rubro: "proveedores", saldoRazon: 1000, saldoSubledger: 850 });
    expect(r.ok).toBe(false);
    expect(r.diferencia).toBe(150);
  });

  it("orientação do sinal: subledger maior → diferença negativa", () => {
    const r = compararSaldo({ rubro: "clientes", saldoRazon: 850, saldoSubledger: 1000 });
    expect(r.diferencia).toBe(-150);
    expect(r.ok).toBe(false);
  });

  it("limpa ruído de ponto flutuante (0.3 − 0.1 = 0.2 exato)", () => {
    const r = compararSaldo({ rubro: "clientes", saldoRazon: 0.3, saldoSubledger: 0.1 });
    expect(r.diferencia).toBe(0.2);
  });
});

describe("sumarSaldosSubledger", () => {
  it("soma normal", () => {
    expect(sumarSaldosSubledger(["100.50", "200.25", "0.25"])).toBe(301);
  });

  it("lista vazia → 0", () => {
    expect(sumarSaldosSubledger([])).toBe(0);
  });

  it("valores não finitos (vazio / lixo) contam 0", () => {
    expect(sumarSaldosSubledger(["100", "", "abc", "50"])).toBe(150);
  });

  it("não-vácuo: mudar uma entrada muda a soma", () => {
    expect(sumarSaldosSubledger(["100", "100"])).toBe(200);
    expect(sumarSaldosSubledger(["100", "300"])).toBe(400);
  });
});

const ARBOL: NodoBalanceReconciliable[] = [
  {
    codigo: "1",
    saldoFinal: "0",
    children: [
      {
        codigo: "1.1",
        saldoFinal: "0",
        children: [
          { codigo: "1.1.3", saldoFinal: "1234.56" },
          { codigo: "1.1.4", saldoFinal: "99" },
        ],
      },
    ],
  },
  {
    codigo: "2",
    saldoFinal: "0",
    children: [
      {
        codigo: "2.1.1",
        saldoFinal: "0",
        children: [{ codigo: "2.1.1.01", saldoFinal: "500.00" }],
      },
    ],
  },
];

describe("buscarNodoPorCodigo", () => {
  it("encontra nó aninhado na árvore", () => {
    expect(buscarNodoPorCodigo(ARBOL, "1.1.3")?.saldoFinal).toBe("1234.56");
    expect(buscarNodoPorCodigo(ARBOL, "2.1.1.01")?.saldoFinal).toBe("500.00");
  });

  it("encontra nó na raiz", () => {
    expect(buscarNodoPorCodigo(ARBOL, "1")?.codigo).toBe("1");
  });

  it("código ausente → null", () => {
    expect(buscarNodoPorCodigo(ARBOL, "9.9.9")).toBeNull();
  });
});

describe("buscarSaldoRazon", () => {
  it("nó presente → saldoFinal parseado", () => {
    expect(buscarSaldoRazon(ARBOL, "1.1.3")).toBe(1234.56);
    expect(buscarSaldoRazon(ARBOL, "2.1.1.01")).toBe(500);
  });

  it("nó ausente → 0 (não lança)", () => {
    expect(buscarSaldoRazon(ARBOL, "1.1.3.99")).toBe(0);
    expect(buscarSaldoRazon([], "1.1.3")).toBe(0);
  });

  it("saldoFinal não finito → 0", () => {
    expect(buscarSaldoRazon([{ codigo: "1.1.3", saldoFinal: "" }], "1.1.3")).toBe(0);
  });
});
