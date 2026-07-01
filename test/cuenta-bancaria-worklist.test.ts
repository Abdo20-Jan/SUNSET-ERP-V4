import { afterEach, describe, expect, it, vi } from "vitest";

// TES-01 / PR-025a — proyección read-only de la worklist de cuentas bancarias.
// Verifica el gate `VER_SALDO` como **narrow-select** server-side: sin permiso
// el motor de saldo NO se invoca y `saldo` viaja `null` (server omite, no "—");
// con permiso, el saldo se LEE del servicio existente y se proyecta (nunca
// recomputa). Mockeamos sólo `db` + el servicio de saldo (no hay DB acá).

const h = vi.hoisted(() => ({
  findMany: vi.fn(),
  calcularSaldos: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: { cuentaBancaria: { findMany: h.findMany } } }));
vi.mock("@/lib/services/cuenta-bancaria", () => ({
  calcularSaldosCuentasBancariasEnMonedaCuenta: h.calcularSaldos,
}));

import { Prisma } from "@/generated/prisma/client";
import { listarCuentasBancariasWorklist } from "@/lib/services/cuenta-bancaria-worklist";

const CUENTA = {
  id: "c1",
  banco: "Santander",
  tipo: "CUENTA_CORRIENTE",
  moneda: "ARS",
  numero: "123",
  cbu: null,
  alias: null,
  cuentaContable: { id: 10, codigo: "1.1.2.01", nombre: "Banco Santander ARS" },
};

afterEach(() => vi.clearAllMocks());

describe("listarCuentasBancariasWorklist · gate VER_SALDO (narrow-select)", () => {
  it("sin VER_SALDO: NO llama al motor de saldo y todas las filas llevan saldo=null", async () => {
    h.findMany.mockResolvedValue([CUENTA]);

    const rows = await listarCuentasBancariasWorklist(false);

    expect(h.calcularSaldos).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
    expect(rows[0].saldo).toBeNull();
    // Los campos no monetarios sí viajan (la worklist sigue siendo útil).
    expect(rows[0]).toMatchObject({
      banco: "Santander",
      tipo: "CUENTA_CORRIENTE",
      moneda: "ARS",
      cuentaContableCodigo: "1.1.2.01",
      cuentaContableNombre: "Banco Santander ARS",
    });
  });

  it("con VER_SALDO: llama al motor una vez y proyecta el saldo LEÍDO", async () => {
    h.findMany.mockResolvedValue([CUENTA]);
    h.calcularSaldos.mockResolvedValue(new Map([[10, new Prisma.Decimal("1500.5")]]));

    const rows = await listarCuentasBancariasWorklist(true);

    expect(h.calcularSaldos).toHaveBeenCalledOnce();
    expect(rows[0].saldo).toBe("1500.50");
  });

  it("con VER_SALDO y cuenta sin saldo en el mapa: saldo = 0.00 (no null)", async () => {
    h.findMany.mockResolvedValue([CUENTA]);
    h.calcularSaldos.mockResolvedValue(new Map());

    const rows = await listarCuentasBancariasWorklist(true);

    expect(rows[0].saldo).toBe("0.00");
  });
});
