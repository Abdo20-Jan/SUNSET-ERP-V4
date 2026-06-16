import { describe, expect, it, vi } from "vitest";

// balance-general.ts importa `@/lib/db`; mockeamos para no instanciar el
// cliente real (la función bajo test es pura, no toca la DB).
vi.mock("@/lib/db", () => ({ db: {} }));

import { Decimal, sumMoney } from "@/lib/decimal";
import { reclasificarSaldosAFavor } from "@/lib/services/reportes/balance-general";
import type { CuentaTreeNode } from "@/lib/services/reportes/shared";

function leaf(codigo: string, saldo: number, nombre = codigo): CuentaTreeNode {
  return {
    id: Number(codigo.replace(/\D/g, "")) || 1,
    codigo,
    nombre,
    tipo: "ANALITICA",
    categoria: "ACTIVO",
    nivel: codigo.split(".").length,
    saldoInicial: new Decimal(0),
    debe: new Decimal(0),
    haber: new Decimal(0),
    saldo: new Decimal(saldo),
    children: [],
  };
}

function syn(codigo: string, children: CuentaTreeNode[]): CuentaTreeNode {
  return {
    id: -Number(codigo.replace(/\D/g, "")) || -1,
    codigo,
    nombre: `RUBRO ${codigo}`,
    tipo: "SINTETICA",
    categoria: "ACTIVO",
    nivel: codigo.split(".").length,
    saldoInicial: new Decimal(0),
    debe: new Decimal(0),
    haber: new Decimal(0),
    saldo: sumMoney(children.map((c) => c.saldo)),
    children,
  };
}

function findByNombre(nodes: CuentaTreeNode[], nombre: string): CuentaTreeNode | undefined {
  return nodes.find((n) => n.nombre === nombre);
}

function contieneCodigo(nodes: CuentaTreeNode[], codigo: string): boolean {
  for (const n of nodes) {
    if (n.codigo === codigo) return true;
    if (contieneCodigo(n.children, codigo)) return true;
  }
  return false;
}

describe("reclasificarSaldosAFavor", () => {
  // Activo: mercadería con saldo invertido (NO se mueve) + cliente con saldo
  // acreedor (anticipo → Pasivo).
  const activo = () => [
    syn("1", [
      syn("1.1", [
        syn("1.1.5", [leaf("1.1.5.03", -1000, "MERCADERÍAS A ENTREGAR")]),
        syn("1.1.3", [leaf("1.1.3.10", -300, "CLIENTE ACME")]),
      ]),
    ]),
  ];
  // Pasivo: proveedor normal (a pagar) + proveedor con saldo deudor (a favor →
  // Activo).
  const pasivo = () => [
    syn("2", [
      syn("2.1", [
        syn("2.1.1", [
          leaf("2.1.1.10", 500, "FREE CUSTOMS"),
          leaf("2.1.1.20", -82.34, "TP LOGISTICA"),
        ]),
      ]),
    ]),
  ];

  it("mueve el saldo a favor de proveedor (2.1.1.x deudor) al Activo", () => {
    const { activo: a, pasivo: p } = reclasificarSaldosAFavor(activo(), pasivo());

    const grupo = findByNombre(a, "ANTICIPOS Y SALDOS A FAVOR A PROVEEDORES");
    expect(grupo).toBeDefined();
    expect(grupo!.saldo.toFixed(2)).toBe("82.34"); // signo invertido a positivo
    expect(grupo!.children.some((c) => c.codigo === "2.1.1.20")).toBe(true);

    // ya no está en el Pasivo, pero el proveedor "a pagar" normal permanece
    expect(contieneCodigo(p, "2.1.1.20")).toBe(false);
    expect(contieneCodigo(p, "2.1.1.10")).toBe(true);
  });

  it("mueve el anticipo de cliente (1.1.3.x acreedor) al Pasivo", () => {
    const { activo: a, pasivo: p } = reclasificarSaldosAFavor(activo(), pasivo());

    const grupo = findByNombre(p, "ANTICIPOS DE CLIENTES (SALDOS A FAVOR)");
    expect(grupo).toBeDefined();
    expect(grupo!.saldo.toFixed(2)).toBe("300.00");
    expect(contieneCodigo(a, "1.1.3.10")).toBe(false);
  });

  it("NO reclasifica cuentas fuera del subledger comercial (mercaderías)", () => {
    const { activo: a } = reclasificarSaldosAFavor(activo(), pasivo());
    // 1.1.5.03 sigue en el Activo, con su saldo invertido intacto (no se mueve)
    expect(contieneCodigo(a, "1.1.5.03")).toBe(true);
  });

  it("preserva la igualdad A − P (ambos lados se agrupan por igual)", () => {
    const aIni = sumMoney(activo().map((n) => n.saldo));
    const pIni = sumMoney(pasivo().map((n) => n.saldo));
    const { activo: a, pasivo: p } = reclasificarSaldosAFavor(activo(), pasivo());
    const aFin = sumMoney(a.map((n) => n.saldo));
    const pFin = sumMoney(p.map((n) => n.saldo));
    expect(aFin.minus(pFin).toFixed(2)).toBe(aIni.minus(pIni).toFixed(2));
  });

  it("no crea grupos vacíos si no hay saldos invertidos", () => {
    const activoOk = [syn("1", [syn("1.1", [leaf("1.1.3.10", 300, "CLIENTE OK")])])];
    const pasivoOk = [syn("2", [syn("2.1", [syn("2.1.1", [leaf("2.1.1.10", 500, "PROV OK")])])])];
    const { activo: a, pasivo: p } = reclasificarSaldosAFavor(activoOk, pasivoOk);
    expect(findByNombre(a, "ANTICIPOS Y SALDOS A FAVOR A PROVEEDORES")).toBeUndefined();
    expect(findByNombre(p, "ANTICIPOS DE CLIENTES (SALDOS A FAVOR)")).toBeUndefined();
  });
});
