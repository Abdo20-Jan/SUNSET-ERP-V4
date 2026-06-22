import { beforeEach, describe, expect, it, vi } from "vitest";

// F0-DAT-5 — service de reconciliação razão↔subledger. PROD tem 0 asientos →
// mockamos as 3 dependências server-only e validamos por ESTRUTURA. `server-only`
// é stubbed via vitest.config.

const { getBalanceSumasYSaldos, getCuentasACobrar, getCuentasAPagar } = vi.hoisted(() => ({
  getBalanceSumasYSaldos: vi.fn(),
  getCuentasACobrar: vi.fn(),
  getCuentasAPagar: vi.fn(),
}));
vi.mock("@/lib/services/balance-sumas-saldos", () => ({ getBalanceSumasYSaldos }));
vi.mock("@/lib/services/cuentas-a-cobrar", () => ({ getCuentasACobrar }));
vi.mock("@/lib/services/cuentas-a-pagar", () => ({ getCuentasAPagar }));

import { getReconciliacionSubledger } from "@/lib/services/bi-reconciliacion";

// Helpers para montar respostas mínimas dos mocks (só os campos lidos pelo service).
// Sem anotação de retorno: a inferência tipa o literal e os mocks (`vi.fn()`) aceitam
// qualquer objeto — evita o `any` (que é ERRO no ESLint do repo, não só warning no Biome).
function balanceConNodos(nodos: Array<{ codigo: string; saldoFinal: string }>) {
  return { rango: { fechaDesde: null, fechaHasta: null }, root: nodos };
}
function row(codigo: string, saldo: string) {
  return { cuentaId: 1, cuentaCodigo: codigo, cuentaNombre: codigo, saldo };
}

beforeEach(() => {
  getBalanceSumasYSaldos.mockReset();
  getCuentasACobrar.mockReset();
  getCuentasAPagar.mockReset();
});

describe("getReconciliacionSubledger", () => {
  it("caminho feliz: razão == Σ subledger → ok em ambos os rubros", async () => {
    getBalanceSumasYSaldos.mockResolvedValue(
      balanceConNodos([
        { codigo: "1.1.3", saldoFinal: "1000.00" },
        { codigo: "2.1.1.01", saldoFinal: "500.00" },
      ]),
    );
    getCuentasACobrar.mockResolvedValue({
      clientes: [row("1.1.3.01", "600"), row("1.1.3.02", "400")],
      valoresACobrar: [],
      totalGeneral: "1000.00",
    });
    getCuentasAPagar.mockResolvedValue({
      proveedoresComerciales: [row("2.1.1.01.01", "500")],
      aduana: [],
      fiscales: [],
      totalGeneral: "500.00",
    });

    const r = await getReconciliacionSubledger();
    expect(r.clientes).toEqual({
      rubro: "clientes",
      saldoRazon: 1000,
      saldoSubledger: 1000,
      diferencia: 0,
      ok: true,
    });
    expect(r.proveedores).toEqual({
      rubro: "proveedores",
      saldoRazon: 500,
      saldoSubledger: 500,
      diferencia: 0,
      ok: true,
    });
  });

  it("mismatch forçado → ok:false e diferencia = razão − subledger", async () => {
    getBalanceSumasYSaldos.mockResolvedValue(
      balanceConNodos([
        { codigo: "1.1.3", saldoFinal: "1000.00" },
        { codigo: "2.1.1.01", saldoFinal: "500.00" },
      ]),
    );
    getCuentasACobrar.mockResolvedValue({
      clientes: [row("1.1.3.01", "850")],
      valoresACobrar: [],
      totalGeneral: "850",
    });
    getCuentasAPagar.mockResolvedValue({
      proveedoresComerciales: [row("2.1.1.01.01", "500")],
      aduana: [],
      fiscales: [],
      totalGeneral: "500",
    });

    const r = await getReconciliacionSubledger();
    expect(r.clientes.ok).toBe(false);
    expect(r.clientes.diferencia).toBe(150); // 1000 − 850
    expect(r.proveedores.ok).toBe(true);
  });

  it("usa SÓ rows `clientes` (ignora valoresACobrar) e SÓ `proveedoresComerciales` (ignora aduana/fiscales)", async () => {
    getBalanceSumasYSaldos.mockResolvedValue(
      balanceConNodos([
        { codigo: "1.1.3", saldoFinal: "1000.00" },
        { codigo: "2.1.1.01", saldoFinal: "500.00" },
      ]),
    );
    // valoresACobrar / aduana / fiscales têm saldos que NÃO devem entrar na soma.
    getCuentasACobrar.mockResolvedValue({
      clientes: [row("1.1.3.01", "1000")],
      valoresACobrar: [row("1.1.4.20", "999999")],
      totalGeneral: "1000999",
    });
    getCuentasAPagar.mockResolvedValue({
      proveedoresComerciales: [row("2.1.1.01.01", "500")],
      aduana: [row("2.1.3.4.01", "777777")],
      fiscales: [row("2.1.3.01", "888888")],
      totalGeneral: "2167165",
    });

    const r = await getReconciliacionSubledger();
    expect(r.clientes.saldoSubledger).toBe(1000); // sem os 999999 de valoresACobrar
    expect(r.clientes.ok).toBe(true);
    expect(r.proveedores.saldoSubledger).toBe(500); // sem aduana/fiscales
    expect(r.proveedores.ok).toBe(true);
  });

  it("nó de controle ausente na árvore → saldoRazon 0.00 sem lançar", async () => {
    getBalanceSumasYSaldos.mockResolvedValue(balanceConNodos([])); // pós-wipe: sem nós
    getCuentasACobrar.mockResolvedValue({
      clientes: [],
      valoresACobrar: [],
      totalGeneral: "0",
    });
    getCuentasAPagar.mockResolvedValue({
      proveedoresComerciales: [],
      aduana: [],
      fiscales: [],
      totalGeneral: "0",
    });

    const r = await getReconciliacionSubledger();
    expect(r.clientes.saldoRazon).toBe(0);
    expect(r.clientes.saldoSubledger).toBe(0);
    expect(r.clientes.ok).toBe(true);
    expect(r.proveedores.saldoRazon).toBe(0);
    expect(r.proveedores.ok).toBe(true);
  });

  it("encontra a sintética de controle aninhada na árvore", async () => {
    getBalanceSumasYSaldos.mockResolvedValue({
      rango: { fechaDesde: null, fechaHasta: null },
      root: [
        {
          codigo: "1",
          saldoFinal: "0",
          children: [{ codigo: "1.1.3", saldoFinal: "321.00" }],
        },
      ],
    });
    getCuentasACobrar.mockResolvedValue({
      clientes: [row("1.1.3.01", "321")],
      valoresACobrar: [],
      totalGeneral: "321",
    });
    getCuentasAPagar.mockResolvedValue({
      proveedoresComerciales: [],
      aduana: [],
      fiscales: [],
      totalGeneral: "0",
    });

    const r = await getReconciliacionSubledger();
    expect(r.clientes.saldoRazon).toBe(321);
    expect(r.clientes.ok).toBe(true);
  });
});
