import { afterEach, describe, expect, it, vi } from "vitest";

// TES-02 / PR-025b — proyección read-only de la worklist de saldos por
// proveedor. Verifica el gate `VER_SALDO` como **no-call** server-side (espejo
// de test/cuenta-bancaria-worklist.test.ts): sin permiso el motor de aging NO
// se invoca y el resultado es `null` (la página omite la superficie entera);
// con permiso, el resultado es el pass-through IDÉNTICO del servicio existente
// (nunca recomputa). Mockeamos sólo `cuentas-a-pagar` (la proyección no tiene
// query propia — no hace falta mockear `db`).

const h = vi.hoisted(() => ({
  getSaldos: vi.fn(),
}));

vi.mock("@/lib/services/cuentas-a-pagar", () => ({
  getSaldosPorProveedorConAging: h.getSaldos,
}));

import { listarSaldosProveedoresWorklist } from "@/lib/services/saldos-proveedores-worklist";

const PROVEEDOR = {
  proveedorId: "p1",
  proveedorNombre: "TRP",
  cuit: null,
  pais: "AR",
  cuentaContableId: 42,
  saldoTotal: "1500.50",
  vencido: "1500.50",
  proximo: "0.00",
  alDia: "0.00",
  facturas: [],
};

afterEach(() => vi.clearAllMocks());

describe("listarSaldosProveedoresWorklist · gate VER_SALDO (no-call)", () => {
  it("sin VER_SALDO: NO llama al motor de aging y devuelve null", async () => {
    const result = await listarSaldosProveedoresWorklist(false);

    expect(h.getSaldos).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it("con VER_SALDO: llama al motor una vez y devuelve el resultado LEÍDO (pass-through)", async () => {
    const fixture = [PROVEEDOR];
    h.getSaldos.mockResolvedValue(fixture);

    const result = await listarSaldosProveedoresWorklist(true);

    expect(h.getSaldos).toHaveBeenCalledOnce();
    // Pass-through por referencia: la proyección no transforma ni recomputa.
    expect(result).toBe(fixture);
  });
});
