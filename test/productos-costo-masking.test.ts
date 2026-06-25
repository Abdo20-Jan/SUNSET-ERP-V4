import { afterEach, describe, expect, it, vi } from "vitest";

// PR-011: `obtenerProductoCosto` y `listarProductosParaExport` deben strip-ear
// el costo cuando falta `costos.ver`. El export NS-3 era un bypass del gating de
// ventas/BI (la ruta sólo chequea auth()); acá se prueba el strip a nivel action.

const h = vi.hoisted(() => ({
  puedeVerCosto: vi.fn(),
  findUnique: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("@/lib/permisos-masking", () => ({ puedeVerCosto: h.puedeVerCosto }));
vi.mock("@/lib/db", () => ({
  db: { producto: { findUnique: h.findUnique, findMany: h.findMany } },
}));
// Corta la cadena next-auth (auth-guard → @/lib/auth → next-auth) bajo Vitest.
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { listarProductosParaExport, obtenerProductoCosto } from "@/lib/actions/productos";

const fixed = (s: string) => ({ toFixed: () => s });

function exportRow() {
  return {
    id: "p1",
    codigo: "C1",
    nombre: "Producto 1",
    descripcion: null,
    marca: null,
    modelo: null,
    medida: null,
    ncm: null,
    unidad: "u",
    diePorcentaje: fixed("0.0000"),
    precioVenta: fixed("100.00"),
    costoPromedio: fixed("60.00"),
    stockActual: 5,
    stockMinimo: 1,
    activo: true,
  };
}

afterEach(() => vi.clearAllMocks());

describe("obtenerProductoCosto · máscara de costo (CRIT-10)", () => {
  it("sin costos.ver ⇒ null aunque el producto exista; NO consulta la base", async () => {
    h.puedeVerCosto.mockResolvedValue(false);

    await expect(obtenerProductoCosto("p1")).resolves.toBeNull();
    expect(h.findUnique).not.toHaveBeenCalled();
  });

  it("con costos.ver ⇒ devuelve el costo real", async () => {
    h.puedeVerCosto.mockResolvedValue(true);
    h.findUnique.mockResolvedValue({ costoPromedio: fixed("123.45") });

    await expect(obtenerProductoCosto("p1")).resolves.toBe("123.45");
  });
});

describe("listarProductosParaExport · máscara de costo (bypass NS-3)", () => {
  it("sin costos.ver ⇒ cada fila con costoPromedio null", async () => {
    h.puedeVerCosto.mockResolvedValue(false);
    h.findMany.mockResolvedValue([exportRow()]);

    const [r] = await listarProductosParaExport({});

    expect(r.costoPromedio).toBeNull();
    expect(r.precioVenta).toBe("100.00");
  });

  it("con costos.ver ⇒ costoPromedio con el valor real", async () => {
    h.puedeVerCosto.mockResolvedValue(true);
    h.findMany.mockResolvedValue([exportRow()]);

    const [r] = await listarProductosParaExport({});

    expect(r.costoPromedio).toBe("60.00");
  });
});
