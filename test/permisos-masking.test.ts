import { afterEach, describe, expect, it, vi } from "vitest";

// Máscara de costo/margen (PR-011). Los wrappers `puedeVer*` son delegaciones
// finas sobre `hasPermission`; mockeamos sólo ese punto para verificar que cada
// uno consulta la clave correcta. `maskField` y el invariante de
// `USER_BASE_CLAVES` son puros (sin mock).

const h = vi.hoisted(() => ({ hasPermission: vi.fn() }));

vi.mock("@/lib/permisos", () => ({ hasPermission: h.hasPermission }));

import { PERMISOS } from "@/lib/permisos-catalog";
import {
  maskField,
  puedeVerCosto,
  puedeVerCostoLanded,
  puedeVerCostoStock,
  puedeVerMargen,
} from "@/lib/permisos-masking";
import { USER_BASE_CLAVES } from "@/lib/permisos-catalog";
import { isAdminScopedKey } from "@/lib/permisos-resolver";

afterEach(() => vi.clearAllMocks());

describe("permisos-masking · wrappers delegan en hasPermission con la clave correcta", () => {
  const casos: [string, () => Promise<boolean>, string][] = [
    ["puedeVerCosto", puedeVerCosto, PERMISOS.VER_COSTO],
    ["puedeVerMargen", puedeVerMargen, PERMISOS.VER_MARGEN],
    ["puedeVerCostoStock", puedeVerCostoStock, PERMISOS.VER_COSTO_STOCK],
    ["puedeVerCostoLanded", puedeVerCostoLanded, PERMISOS.VER_COSTO_LANDED],
  ];

  for (const [nombre, fn, clave] of casos) {
    it(`${nombre} → hasPermission("${clave}") y propaga el resultado`, async () => {
      h.hasPermission.mockResolvedValue(false);
      await expect(fn()).resolves.toBe(false);
      expect(h.hasPermission).toHaveBeenCalledWith(clave);

      h.hasPermission.mockResolvedValue(true);
      await expect(fn()).resolves.toBe(true);
    });
  }
});

describe("maskField", () => {
  it("allowed=true devuelve el valor intacto", () => {
    expect(maskField(true, "123.45")).toBe("123.45");
    expect(maskField(true, 0)).toBe(0);
  });
  it("allowed=false devuelve null", () => {
    expect(maskField(false, "123.45")).toBeNull();
    expect(maskField(false, 0)).toBeNull();
  });
});

describe("invariante zero-regresión: las 5 claves de costo/margen son BASE", () => {
  const claves = [
    PERMISOS.VER_COSTO,
    PERMISOS.VER_MARGEN,
    PERMISOS.VER_COSTO_LANDED,
    PERMISOS.VER_PRECIO_MINIMO,
    PERMISOS.VER_COSTO_STOCK,
  ];

  for (const clave of claves) {
    it(`${clave} está en USER_BASE_CLAVES (RBAC OFF ⇒ visible para todo activo)`, () => {
      expect(USER_BASE_CLAVES).toContain(clave);
    });
    it(`${clave} NO es admin-scoped (no exige ADMIN con la flag OFF)`, () => {
      expect(isAdminScopedKey(clave)).toBe(false);
    });
  }
});
