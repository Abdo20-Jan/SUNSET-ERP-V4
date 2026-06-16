import { afterEach, describe, expect, it, vi } from "vitest";

// Guard de sesión: el id del JWT puede apuntar a un User inexistente tras un
// reseed. Verificamos que devuelva el userId en el camino feliz y que redirija
// con un motivo legible en cada caso de sesión inválida — en vez de dejar que
// la escritura de la FK explote con P2003 ("Error inesperado").

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  findUnique: vi.fn(),
  // Imita el contrato real de next/navigation.redirect(): nunca retorna, lanza.
  redirect: vi.fn((url: string): never => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/db", () => ({ db: { user: { findUnique: h.findUnique } } }));
vi.mock("next/navigation", () => ({ redirect: h.redirect }));

import { requireSessionUser } from "@/lib/auth-guard";

describe("requireSessionUser", () => {
  afterEach(() => vi.clearAllMocks());

  it("devuelve el userId cuando el usuario existe y está activo", async () => {
    h.auth.mockResolvedValue({ user: { id: "user-uuid" } });
    h.findUnique.mockResolvedValue({ id: "user-uuid", activo: true });

    await expect(requireSessionUser()).resolves.toBe("user-uuid");
    expect(h.redirect).not.toHaveBeenCalled();
  });

  it("redirige a sesion-invalida cuando el user del JWT ya no existe (reseed)", async () => {
    h.auth.mockResolvedValue({ user: { id: "fantasma" } });
    h.findUnique.mockResolvedValue(null);

    await expect(requireSessionUser()).rejects.toThrow("NEXT_REDIRECT:/login?motivo=sesion-invalida");
    expect(h.redirect).toHaveBeenCalledWith("/login?motivo=sesion-invalida");
  });

  it("redirige a usuario-inactivo cuando el user existe pero está inactivo", async () => {
    h.auth.mockResolvedValue({ user: { id: "user-uuid" } });
    h.findUnique.mockResolvedValue({ id: "user-uuid", activo: false });

    await expect(requireSessionUser()).rejects.toThrow("NEXT_REDIRECT:/login?motivo=usuario-inactivo");
  });

  it("redirige a sesion-expirada cuando no hay sesión y no consulta la base", async () => {
    h.auth.mockResolvedValue(null);

    await expect(requireSessionUser()).rejects.toThrow("NEXT_REDIRECT:/login?motivo=sesion-expirada");
    expect(h.findUnique).not.toHaveBeenCalled();
  });
});
