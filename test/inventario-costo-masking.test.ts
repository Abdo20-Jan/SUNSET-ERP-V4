import { afterEach, describe, expect, it, vi } from "vitest";

// PR-011: `listarMatrizInventario` debe strip-ear la valorización de costo
// (producto + por depósito) cuando falta `stock.verCosto`; las cantidades
// quedan intactas.

const h = vi.hoisted(() => ({
  puedeVerCostoStock: vi.fn(),
  prodFindMany: vi.fn(),
  depFindMany: vi.fn(),
}));

vi.mock("@/lib/permisos-masking", () => ({ puedeVerCostoStock: h.puedeVerCostoStock }));
vi.mock("@/lib/db", () => ({
  db: { producto: { findMany: h.prodFindMany }, deposito: { findMany: h.depFindMany } },
}));

import { listarMatrizInventario } from "@/lib/actions/inventario";

function prodRow() {
  return {
    id: "p1",
    codigo: "C1",
    nombre: "Producto 1",
    stockActual: 10,
    costoPromedio: "60.00",
    stockPorDeposito: [
      { depositoId: "d1", cantidadFisica: 8, cantidadReservada: 1, costoPromedio: "60.00" },
    ],
  };
}

afterEach(() => vi.clearAllMocks());

describe("listarMatrizInventario · máscara de valorización", () => {
  it("sin stock.verCosto ⇒ costoPromedio null (producto + depósito); cantidades intactas", async () => {
    h.puedeVerCostoStock.mockResolvedValue(false);
    h.prodFindMany.mockResolvedValue([prodRow()]);
    h.depFindMany.mockResolvedValue([{ id: "d1", nombre: "Central" }]);

    const { productos } = await listarMatrizInventario();
    const p = productos[0];

    expect(p.costoPromedio).toBeNull();
    expect(p.stockPorDeposito[0].costoPromedio).toBeNull();
    expect(p.stockActual).toBe(10);
    expect(p.stockPorDeposito[0].cantidadFisica).toBe(8);
  });

  it("con stock.verCosto (o RBAC OFF) ⇒ valorización intacta", async () => {
    h.puedeVerCostoStock.mockResolvedValue(true);
    h.prodFindMany.mockResolvedValue([prodRow()]);
    h.depFindMany.mockResolvedValue([{ id: "d1", nombre: "Central" }]);

    const { productos } = await listarMatrizInventario();

    expect(productos[0].costoPromedio).toBe("60.00");
    expect(productos[0].stockPorDeposito[0].costoPromedio).toBe("60.00");
  });
});
