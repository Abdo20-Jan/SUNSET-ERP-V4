import { describe, expect, it } from "vitest";
import { Decimal } from "@/lib/decimal";
import { reagruparPorRubroEECC } from "@/lib/services/reportes/balance-general";
import type { CuentaTreeNode } from "@/lib/services/reportes/shared";

// Rebuild RT9 #4 — `rubroEECC` manda sobre la exposición: una cuenta con rubro
// explícito se agrupa bajo ese rubro EECC, aunque su árbol de código la ponga
// en otra rama. Sin ninguna cuenta con rubro, la operación es identidad (no
// toca el balance vigente, donde ninguna cuenta lleva rubroEECC).

function hoja(p: { codigo: string; saldo: number; rubroEECC?: string | null }): CuentaTreeNode {
  return {
    id: Number(p.codigo.replace(/\D/g, "")) || 0,
    codigo: p.codigo,
    nombre: p.codigo,
    tipo: "ANALITICA",
    categoria: "ACTIVO",
    nivel: p.codigo.split(".").length,
    rubroEECC: p.rubroEECC ?? null,
    saldoInicial: new Decimal(0),
    debe: new Decimal(0),
    haber: new Decimal(0),
    saldo: new Decimal(p.saldo),
    children: [],
  };
}

function sintetica(codigo: string, children: CuentaTreeNode[]): CuentaTreeNode {
  return {
    id: 0,
    codigo,
    nombre: codigo,
    tipo: "SINTETICA",
    categoria: "ACTIVO",
    nivel: codigo.split(".").length,
    rubroEECC: null,
    saldoInicial: new Decimal(0),
    debe: new Decimal(0),
    haber: new Decimal(0),
    saldo: children.reduce((acc, c) => acc.plus(c.saldo), new Decimal(0)),
    children,
  };
}

function totalSaldo(nodes: CuentaTreeNode[]): string {
  return nodes.reduce((acc, n) => acc.plus(n.saldo), new Decimal(0)).toFixed(2);
}

describe("reagruparPorRubroEECC", () => {
  it("sin ninguna cuenta con rubroEECC → devuelve el árbol intacto (identidad)", () => {
    const forest = [
      sintetica("1.1.7", [hoja({ codigo: "1.1.7.01", saldo: 100 })]),
      sintetica("1.1.4", [hoja({ codigo: "1.1.4.01", saldo: 50 })]),
    ];
    const out = reagruparPorRubroEECC(forest);
    expect(out).toBe(forest); // misma referencia: no se tocó nada
  });

  it("extrae las hojas con rubroEECC y las agrupa bajo el rubro, preservando el total", () => {
    const forest = [
      sintetica("1.1.7", [
        hoja({ codigo: "1.1.7.01", saldo: 100 }),
        hoja({ codigo: "1.1.7.02", saldo: 30, rubroEECC: "Bienes de Cambio en Tránsito" }),
      ]),
      sintetica("1.1.4", [hoja({ codigo: "1.1.4.01", saldo: 50 })]),
    ];
    const out = reagruparPorRubroEECC(forest);

    // El total se conserva (no se pierde ni duplica saldo).
    expect(totalSaldo(out)).toBe("180.00");

    // Apareció un grupo de rubro con la hoja extraída.
    const grupo = out.find((n) => n.nombre === "Bienes de Cambio en Tránsito");
    expect(grupo).toBeDefined();
    expect(grupo?.saldo.toFixed(2)).toBe("30.00");
    expect(grupo?.children.map((c) => c.codigo)).toEqual(["1.1.7.02"]);

    // La rama 1.1.7 quedó sólo con la hoja sin rubro.
    const rama117 = out.find((n) => n.codigo === "1.1.7");
    expect(rama117?.children.map((c) => c.codigo)).toEqual(["1.1.7.01"]);
    expect(rama117?.saldo.toFixed(2)).toBe("100.00");
  });

  it("descarta sintéticas que quedan vacías tras extraer todas sus hojas", () => {
    const forest = [
      sintetica("1.1.7", [
        hoja({ codigo: "1.1.7.02", saldo: 30, rubroEECC: "Bienes de Cambio en Tránsito" }),
      ]),
    ];
    const out = reagruparPorRubroEECC(forest);
    expect(out.some((n) => n.codigo === "1.1.7")).toBe(false);
    expect(totalSaldo(out)).toBe("30.00");
  });
});
