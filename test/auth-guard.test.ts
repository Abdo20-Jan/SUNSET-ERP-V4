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

import { requireAdmin, requireAdminPage, requireSessionUser } from "@/lib/auth-guard";

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

// requireAdmin: gate de autorización (no de sesión). Devuelve un resultado
// discriminado en vez de redirigir, porque las actions-alvo ya usan el contrato
// { ok, error } y un redirect dentro de su try/catch se tragaría como "Error
// inesperado". Revalida el rol contra la DB porque la estrategia jwt congela el
// rol en la cookie y no lo refresca tras un cambio de permisos o un reseed.
describe("requireAdmin", () => {
  afterEach(() => vi.clearAllMocks());

  it("devuelve { ok, userId } cuando el usuario es ADMIN activo", async () => {
    h.auth.mockResolvedValue({ user: { id: "admin-uuid" } });
    h.findUnique.mockResolvedValue({ activo: true, role: "ADMIN" });

    await expect(requireAdmin()).resolves.toEqual({ ok: true, userId: "admin-uuid" });
  });

  it("rechaza con error de permisos cuando el usuario es USER (rol viaja en JWT pero se revalida)", async () => {
    h.auth.mockResolvedValue({ user: { id: "user-uuid" } });
    h.findUnique.mockResolvedValue({ activo: true, role: "USER" });

    const res = await requireAdmin();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/administrador/i);
  });

  it("rechaza cuando el user del JWT ya no existe en la base (reseed) — sin escribir nada", async () => {
    h.auth.mockResolvedValue({ user: { id: "fantasma" } });
    h.findUnique.mockResolvedValue(null);

    await expect(requireAdmin()).resolves.toEqual({ ok: false, error: "No autorizado." });
  });

  it("rechaza cuando el ADMIN está inactivo", async () => {
    h.auth.mockResolvedValue({ user: { id: "admin-uuid" } });
    h.findUnique.mockResolvedValue({ activo: false, role: "ADMIN" });

    await expect(requireAdmin()).resolves.toEqual({ ok: false, error: "No autorizado." });
  });

  it("rechaza cuando no hay sesión y no consulta la base", async () => {
    h.auth.mockResolvedValue(null);

    await expect(requireAdmin()).resolves.toEqual({ ok: false, error: "No autorizado." });
    expect(h.findUnique).not.toHaveBeenCalled();
  });
});

// requireAdminPage: variante redirect-based para Server Components bajo /admin.
// Reusa requireSessionUser (→ /login si la sesión es inválida) y manda al USER
// a /dashboard, igual que el gate del proxy.
describe("requireAdminPage", () => {
  afterEach(() => vi.clearAllMocks());

  it("devuelve el userId cuando es ADMIN activo", async () => {
    h.auth.mockResolvedValue({ user: { id: "admin-uuid" } });
    h.findUnique.mockResolvedValue({ id: "admin-uuid", activo: true, role: "ADMIN" });

    await expect(requireAdminPage()).resolves.toBe("admin-uuid");
    expect(h.redirect).not.toHaveBeenCalled();
  });

  it("redirige a /dashboard cuando el usuario logueado es USER", async () => {
    h.auth.mockResolvedValue({ user: { id: "user-uuid" } });
    h.findUnique.mockResolvedValue({ id: "user-uuid", activo: true, role: "USER" });

    await expect(requireAdminPage()).rejects.toThrow("NEXT_REDIRECT:/dashboard");
    expect(h.redirect).toHaveBeenCalledWith("/dashboard");
  });

  it("redirige a /login (vía requireSessionUser) cuando la sesión expiró", async () => {
    h.auth.mockResolvedValue(null);

    await expect(requireAdminPage()).rejects.toThrow("NEXT_REDIRECT:/login?motivo=sesion-expirada");
  });
});
