import { afterEach, describe, expect, it, vi } from "vitest";

// COM-02 (PR-011): `listarProductosParaVenta` debe strip-ear `costoPromedio`
// del payload cuando falta `costos.ver` (CRIT-10: el servidor no devuelve el
// costo). Mock de `@/lib/db` + del wrapper de permiso (unit, sin Docker).

const h = vi.hoisted(() => ({ puedeVerCosto: vi.fn(), findMany: vi.fn() }));

vi.mock("@/lib/permisos-masking", () => ({ puedeVerCosto: h.puedeVerCosto }));
vi.mock("@/lib/db", () => ({ db: { producto: { findMany: h.findMany } } }));
// Corta la cadena next-auth (auth-guard → @/lib/auth → next-auth) bajo Vitest.
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { listarProductosParaVenta } from "@/lib/actions/ventas";

const dec = (s: string) => ({ toString: () => s });

function row() {
  return {
    id: "p1",
    codigo: "C1",
    nombre: "Producto 1",
    precioVenta: dec("100.00"),
    costoPromedio: dec("60.00"),
    stockPorDeposito: [{ cantidadFisica: 5, cantidadReservada: 2 }],
  };
}

afterEach(() => vi.clearAllMocks());

describe("listarProductosParaVenta · máscara de costo", () => {
  it("sin costos.ver ⇒ costoPromedio null; precioVenta/disponible intactos", async () => {
    h.puedeVerCosto.mockResolvedValue(false);
    h.findMany.mockResolvedValue([row()]);

    const [p] = await listarProductosParaVenta();

    expect(p.costoPromedio).toBeNull();
    expect(p.precioVenta).toBe("100.00");
    expect(p.disponible).toBe(3);
  });

  it("con costos.ver (o RBAC OFF) ⇒ costoPromedio con el valor real", async () => {
    h.puedeVerCosto.mockResolvedValue(true);
    h.findMany.mockResolvedValue([row()]);

    const [p] = await listarProductosParaVenta();

    expect(p.costoPromedio).toBe("60.00");
    expect(p.precioVenta).toBe("100.00");
  });
});
