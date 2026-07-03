import { afterEach, describe, expect, it, vi } from "vitest";

// CONT-02 / PR-028 — proyección del Plan de Cuentas con saldo + helpers puros
// del árbol. Verifica: (i) `mapSaldosPorCodigo` es PASS-THROUGH del roll-up
// del balance (jamás recomputa — el saldo de la sintética sale del nodo, no
// de sumar hijos acá); (ii) la proyección decora naturaleza EFECTIVA
// (override de regularizadora respetado; null → default por categoría) y
// saldo "0.00" para cuentas sin movimiento; (iii) búsqueda con poda
// (matches + ancestros, 3+ chars) y [Expandir hasta nivel N].

const h = vi.hoisted(() => ({
  findMany: vi.fn(),
  getBalance: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: { cuentaContable: { findMany: h.findMany } } }));
vi.mock("@/lib/services/balance-sumas-saldos", () => ({
  getBalanceSumasYSaldos: h.getBalance,
}));

import type { BalanceNode } from "@/lib/services/balance-sumas-saldos";
import { getPlanDeCuentasConSaldo, mapSaldosPorCodigo } from "@/lib/services/plan-cuentas-arbol";
import {
  expandedHastaNivel,
  expandedTodo,
  filtrarArbol,
} from "@/app/(dashboard)/contabilidad/cuentas/cuentas-arbol-presentacion";

function nodo(codigo: string, saldoFinal: string, children?: BalanceNode[]): BalanceNode {
  return {
    kind: "cuenta",
    id: 0,
    codigo,
    nombre: codigo,
    tipo: children ? "SINTETICA" : "ANALITICA",
    categoria: "ACTIVO",
    nivel: codigo.split(".").length,
    saldoInicial: "0.00",
    debe: "0.00",
    haber: "0.00",
    saldoFinal,
    saldoInicialUsd: null,
    debeUsd: null,
    haberUsd: null,
    saldoFinalUsd: null,
    children,
  };
}

const CUENTA_BASE = {
  id: 1,
  codigo: "1",
  nombre: "ACTIVO",
  tipo: "SINTETICA",
  categoria: "ACTIVO",
  nivel: 1,
  padreCodigo: null,
  activa: true,
  naturaleza: null,
};

afterEach(() => vi.clearAllMocks());

describe("mapSaldosPorCodigo · pass-through del roll-up", () => {
  it("mapea TODOS los códigos del árbol, incluidos los hijos anidados", () => {
    const root = [nodo("1", "130.00", [nodo("1.1", "130.00", [nodo("1.1.01", "130.00")])])];

    const map = mapSaldosPorCodigo(root);

    expect(map.get("1")).toBe("130.00");
    expect(map.get("1.1")).toBe("130.00");
    expect(map.get("1.1.01")).toBe("130.00");
    expect(map.size).toBe(3);
  });

  it("no recomputa: el valor de la sintética es EL DEL NODO (aunque no cierre con los hijos)", () => {
    // Fixture deliberadamente inconsistente: si alguien "ayudara" recomputando
    // la sintética desde los hijos, este test lo delata.
    const root = [nodo("1", "999.99", [nodo("1.1.01", "130.00")])];

    const map = mapSaldosPorCodigo(root);

    expect(map.get("1")).toBe("999.99");
  });
});

describe("getPlanDeCuentasConSaldo · proyección", () => {
  it("decora naturaleza efectiva + saldo del balance; sin nodo → 0.00", async () => {
    h.findMany.mockResolvedValue([
      { ...CUENTA_BASE },
      {
        ...CUENTA_BASE,
        id: 2,
        codigo: "1.1.01",
        nombre: "Caja",
        tipo: "ANALITICA",
        nivel: 3,
        padreCodigo: "1",
      },
      {
        // Regularizadora: ACTIVO con naturaleza ACREEDOR explícita — se respeta.
        ...CUENTA_BASE,
        id: 3,
        codigo: "1.2.01",
        nombre: "Depreciación acumulada",
        tipo: "ANALITICA",
        nivel: 3,
        padreCodigo: "1",
        naturaleza: "ACREEDOR",
      },
      {
        ...CUENTA_BASE,
        id: 4,
        codigo: "4",
        nombre: "INGRESOS",
        categoria: "INGRESO",
        padreCodigo: null,
      },
    ]);
    h.getBalance.mockResolvedValue({
      rango: { fechaDesde: null, fechaHasta: new Date() },
      root: [nodo("1", "100.00", [nodo("1.1.01", "130.00"), nodo("1.2.01", "30.00")])],
    });

    const { roots, flat } = await getPlanDeCuentasConSaldo();

    // Naturaleza efectiva: null → default por categoría; override respetado.
    const porCodigo = new Map(flat.map((c) => [c.codigo, c]));
    expect(porCodigo.get("1")?.naturaleza).toBe("DEUDOR"); // ACTIVO default
    expect(porCodigo.get("4")?.naturaleza).toBe("ACREEDOR"); // INGRESO default
    expect(porCodigo.get("1.2.01")?.naturaleza).toBe("ACREEDOR"); // override

    // Saldo: del nodo del balance; cuenta sin nodo → "0.00".
    expect(porCodigo.get("1")?.saldo).toBe("100.00");
    expect(porCodigo.get("1.1.01")?.saldo).toBe("130.00");
    expect(porCodigo.get("4")?.saldo).toBe("0.00");

    // Árbol por padreCodigo (verbatim de la page legada): 2 raíces, hijos bajo "1".
    expect(roots.map((r) => r.codigo)).toEqual(["1", "4"]);
    expect(roots[0].children?.map((c) => c.codigo)).toEqual(["1.1.01", "1.2.01"]);
    expect(roots[1].children).toBeUndefined();

    // El balance se pidió SIN fechaDesde (saldo acumulado histórico) y sin TC.
    expect(h.getBalance).toHaveBeenCalledWith({ fechaHasta: expect.any(Date) });
  });
});

type NodoArbol = { codigo: string; nombre: string; children?: NodoArbol[] };

function arbol(): NodoArbol[] {
  return [
    {
      codigo: "1",
      nombre: "ACTIVO",
      children: [
        {
          codigo: "1.1",
          nombre: "Caja y bancos",
          children: [{ codigo: "1.1.01", nombre: "Caja" }],
        },
        { codigo: "1.2", nombre: "Créditos", children: [{ codigo: "1.2.01", nombre: "Clientes" }] },
      ],
    },
    { codigo: "4", nombre: "INGRESOS", children: [{ codigo: "4.1", nombre: "Ventas" }] },
  ];
}

describe("filtrarArbol · búsqueda con poda (3+ chars)", () => {
  it("con menos de 3 caracteres devuelve el árbol intacto", () => {
    const roots = arbol();
    expect(filtrarArbol(roots, "ca")).toBe(roots);
  });

  it("match en hoja conserva sus ANCESTROS y poda las ramas sin match", () => {
    const res = filtrarArbol(arbol(), "clientes");

    expect(res.map((r) => r.codigo)).toEqual(["1"]);
    expect(res[0].children?.map((c) => c.codigo)).toEqual(["1.2"]);
    expect(res[0].children?.[0].children?.map((c) => c.codigo)).toEqual(["1.2.01"]);
  });

  it("match por código funciona igual que por nombre", () => {
    const res = filtrarArbol(arbol(), "4.1");
    expect(res.map((r) => r.codigo)).toEqual(["4"]);
  });

  it("match en un nodo intermedio conserva su subárbol completo", () => {
    const res = filtrarArbol(arbol(), "caja y bancos");
    expect(res[0].children?.[0].children?.map((c) => c.codigo)).toEqual(["1.1.01"]);
  });
});

describe("expandedHastaNivel / expandedTodo", () => {
  it("nivel 1 expande sólo las raíces con hijos", () => {
    expect(expandedHastaNivel(arbol(), 1)).toEqual({ "1": true, "4": true });
  });

  it("nivel 2 expande raíces + segundo nivel con hijos", () => {
    expect(expandedHastaNivel(arbol(), 2)).toEqual({
      "1": true,
      "4": true,
      "1.1": true,
      "1.2": true,
    });
  });

  it("expandedTodo marca todos los nodos con hijos", () => {
    expect(Object.keys(expandedTodo(arbol())).sort()).toEqual(["1", "1.1", "1.2", "4"]);
  });
});
