import { afterEach, describe, expect, it, vi } from "vitest";

// Motor de permisos RBAC (PR-006). Espeja el estilo de mocks de
// `auth-guard.test.ts`: NO mockeamos `@/lib/auth-guard` ni `@/lib/features` —
// dejamos correr la delegación real a los guards legacy y manejamos la flag por
// `process.env.RBAC_ENABLED`. El mock de `@/lib/db` queda igual de chico
// (`{ user: { findUnique } }`): el camino flag-ON usa selects anidados sobre el
// mismo `user.findUnique`, así que no necesita delegados nuevos.

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  findUnique: vi.fn(),
  redirect: vi.fn((url: string): never => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/db", () => ({ db: { user: { findUnique: h.findUnique } } }));
vi.mock("next/navigation", () => ({ redirect: h.redirect }));

import { PERMISOS, hasPermission, requirePermission, requirePermissionPage } from "@/lib/permisos";

const ENV_PREVIO = process.env.RBAC_ENABLED;

function setRbac(on: boolean): void {
  if (on) process.env.RBAC_ENABLED = "true";
  else delete process.env.RBAC_ENABLED;
}

afterEach(() => {
  vi.clearAllMocks();
  if (ENV_PREVIO === undefined) delete process.env.RBAC_ENABLED;
  else process.env.RBAC_ENABLED = ENV_PREVIO;
});

// ============================================================
// A. Flag OFF — hasPermission reproduce los dos niveles de hoy
// ============================================================
describe("hasPermission (flag RBAC OFF)", () => {
  it("A1: ADMIN activo tiene una clave admin-scoped", async () => {
    setRbac(false);
    h.auth.mockResolvedValue({ user: { id: "admin-uuid" } });
    h.findUnique.mockResolvedValue({ activo: true, role: "ADMIN" });

    await expect(hasPermission(PERMISOS.ADMIN_ACCESO)).resolves.toBe(true);
    expect(h.findUnique).toHaveBeenCalledWith({
      where: { id: "admin-uuid" },
      select: { activo: true, role: true },
    });
  });

  it("A2: USER no tiene una clave admin-scoped", async () => {
    setRbac(false);
    h.auth.mockResolvedValue({ user: { id: "user-uuid" } });
    h.findUnique.mockResolvedValue({ activo: true, role: "USER" });

    await expect(hasPermission(PERMISOS.ADMIN_ACCESO)).resolves.toBe(false);
  });

  it("A3: un ADMIN inactivo es rechazado", async () => {
    setRbac(false);
    h.auth.mockResolvedValue({ user: { id: "admin-uuid" } });
    h.findUnique.mockResolvedValue({ activo: false, role: "ADMIN" });

    await expect(hasPermission(PERMISOS.ADMIN_ACCESO)).resolves.toBe(false);
  });

  it("A4: sin sesión devuelve false y no consulta la base", async () => {
    setRbac(false);
    h.auth.mockResolvedValue(null);

    await expect(hasPermission(PERMISOS.ADMIN_ACCESO)).resolves.toBe(false);
    expect(h.findUnique).not.toHaveBeenCalled();
  });

  it("A5: cualquier usuario activo tiene la clave base", async () => {
    setRbac(false);
    h.auth.mockResolvedValue({ user: { id: "user-uuid" } });
    h.findUnique.mockResolvedValue({ activo: true, role: "USER" });

    await expect(hasPermission(PERMISOS.APP_ACCESO)).resolves.toBe(true);
  });

  it("A6: usuario inexistente (reseed) es rechazado para la clave base", async () => {
    setRbac(false);
    h.auth.mockResolvedValue({ user: { id: "fantasma" } });
    h.findUnique.mockResolvedValue(null);

    await expect(hasPermission(PERMISOS.APP_ACCESO)).resolves.toBe(false);
  });
});

// ============================================================
// B. Flag OFF — requirePermission / requirePermissionPage delegan en los
//    guards legacy (mismo contrato, mismos redirects, mismas lecturas).
// ============================================================
describe("requirePermission (flag OFF → delega en requireAdmin)", () => {
  it("B1: ADMIN activo ⇒ { ok, userId }", async () => {
    setRbac(false);
    h.auth.mockResolvedValue({ user: { id: "admin-uuid" } });
    h.findUnique.mockResolvedValue({ activo: true, role: "ADMIN" });

    await expect(requirePermission(PERMISOS.ADMIN_ACCESO)).resolves.toEqual({
      ok: true,
      userId: "admin-uuid",
    });
  });

  it("B2: USER ⇒ { ok:false } con error de administrador", async () => {
    setRbac(false);
    h.auth.mockResolvedValue({ user: { id: "user-uuid" } });
    h.findUnique.mockResolvedValue({ activo: true, role: "USER" });

    const res = await requirePermission(PERMISOS.ADMIN_ACCESO);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/administrador/i);
  });

  it("B3: sin sesión ⇒ { ok:false, 'No autorizado.' } sin tocar la base", async () => {
    setRbac(false);
    h.auth.mockResolvedValue(null);

    await expect(requirePermission(PERMISOS.ADMIN_ACCESO)).resolves.toEqual({
      ok: false,
      error: "No autorizado.",
    });
    expect(h.findUnique).not.toHaveBeenCalled();
  });
});

describe("requirePermissionPage (flag OFF → delega en requireAdminPage)", () => {
  it("B4: ADMIN activo ⇒ devuelve userId, sin redirect", async () => {
    setRbac(false);
    h.auth.mockResolvedValue({ user: { id: "admin-uuid" } });
    h.findUnique.mockResolvedValue({ id: "admin-uuid", activo: true, role: "ADMIN" });

    await expect(requirePermissionPage(PERMISOS.ADMIN_ACCESO)).resolves.toBe("admin-uuid");
    expect(h.redirect).not.toHaveBeenCalled();
  });

  it("B5: USER ⇒ redirige a /dashboard", async () => {
    setRbac(false);
    h.auth.mockResolvedValue({ user: { id: "user-uuid" } });
    h.findUnique.mockResolvedValue({ id: "user-uuid", activo: true, role: "USER" });

    await expect(requirePermissionPage(PERMISOS.ADMIN_ACCESO)).rejects.toThrow(
      "NEXT_REDIRECT:/dashboard",
    );
    expect(h.redirect).toHaveBeenCalledWith("/dashboard");
  });

  it("B6: sesión inválida ⇒ redirige a /login (vía requireSessionUser)", async () => {
    setRbac(false);
    h.auth.mockResolvedValue(null);

    await expect(requirePermissionPage(PERMISOS.ADMIN_ACCESO)).rejects.toThrow(
      "NEXT_REDIRECT:/login?motivo=sesion-expirada",
    );
  });
});

// ============================================================
// C. Flag ON — set efectivo desde la DB (fast-path, fallback, override, expiry)
// ============================================================
describe("hasPermission (flag RBAC ON)", () => {
  it("C1: fast-path por rol ADMIN (ignora grants vacíos)", async () => {
    setRbac(true);
    h.auth.mockResolvedValue({ user: { id: "admin" } });
    h.findUnique.mockResolvedValue({
      activo: true,
      role: "ADMIN",
      perfilId: "p",
      perfil: { codigo: "ADMIN", esSistema: true, activo: true, permisos: [] },
      usuarioPermisos: [],
    });

    await expect(hasPermission(PERMISOS.ADMIN_ACCESO)).resolves.toBe(true);
  });

  it("C2: fast-path por perfil de sistema ADMIN (aunque el rol sea USER)", async () => {
    setRbac(true);
    h.auth.mockResolvedValue({ user: { id: "u" } });
    h.findUnique.mockResolvedValue({
      activo: true,
      role: "USER",
      perfilId: "p",
      perfil: { codigo: "ADMIN", esSistema: true, activo: true, permisos: [] },
      usuarioPermisos: [],
    });

    await expect(hasPermission(PERMISOS.ADMIN_ACCESO)).resolves.toBe(true);
  });

  it("C3: perfilId null ⇒ fallback por rol USER (base sí, admin no)", async () => {
    setRbac(true);
    h.auth.mockResolvedValue({ user: { id: "u" } });
    h.findUnique.mockResolvedValue({
      activo: true,
      role: "USER",
      perfilId: null,
      perfil: null,
      usuarioPermisos: [],
    });

    await expect(hasPermission(PERMISOS.APP_ACCESO)).resolves.toBe(true);
    await expect(hasPermission(PERMISOS.ADMIN_ACCESO)).resolves.toBe(false);
  });

  it("C5: grant vía perfil concede la clave", async () => {
    setRbac(true);
    h.auth.mockResolvedValue({ user: { id: "u" } });
    h.findUnique.mockResolvedValue({
      activo: true,
      role: "USER",
      perfilId: "p",
      perfil: {
        codigo: "OPS",
        esSistema: false,
        activo: true,
        permisos: [{ permiso: { clave: "admin.acceso" } }],
      },
      usuarioPermisos: [],
    });

    await expect(hasPermission(PERMISOS.ADMIN_ACCESO)).resolves.toBe(true);
  });

  it("C6: override vencido se ignora", async () => {
    setRbac(true);
    h.auth.mockResolvedValue({ user: { id: "u" } });
    h.findUnique.mockResolvedValue({
      activo: true,
      role: "USER",
      perfilId: "p",
      perfil: { codigo: "OPS", esSistema: false, activo: true, permisos: [] },
      usuarioPermisos: [
        { concedido: true, expiraEn: new Date("2000-01-01"), permiso: { clave: "admin.acceso" } },
      ],
    });

    await expect(hasPermission(PERMISOS.ADMIN_ACCESO)).resolves.toBe(false);
  });

  it("C7: override activo (sin expiry) concede la clave", async () => {
    setRbac(true);
    h.auth.mockResolvedValue({ user: { id: "u" } });
    h.findUnique.mockResolvedValue({
      activo: true,
      role: "USER",
      perfilId: "p",
      perfil: { codigo: "OPS", esSistema: false, activo: true, permisos: [] },
      usuarioPermisos: [{ concedido: true, expiraEn: null, permiso: { clave: "admin.acceso" } }],
    });

    await expect(hasPermission(PERMISOS.ADMIN_ACCESO)).resolves.toBe(true);
  });

  it("C8: revoke (concedido=false) gana sobre el grant del perfil", async () => {
    setRbac(true);
    h.auth.mockResolvedValue({ user: { id: "u" } });
    h.findUnique.mockResolvedValue({
      activo: true,
      role: "USER",
      perfilId: "p",
      perfil: {
        codigo: "OPS",
        esSistema: false,
        activo: true,
        permisos: [{ permiso: { clave: "admin.acceso" } }],
      },
      usuarioPermisos: [{ concedido: false, expiraEn: null, permiso: { clave: "admin.acceso" } }],
    });

    await expect(hasPermission(PERMISOS.ADMIN_ACCESO)).resolves.toBe(false);
  });

  it("C9: un perfil inactivo no aporta sus grants", async () => {
    setRbac(true);
    h.auth.mockResolvedValue({ user: { id: "u" } });
    h.findUnique.mockResolvedValue({
      activo: true,
      role: "USER",
      perfilId: "p",
      perfil: {
        codigo: "OPS",
        esSistema: false,
        activo: false,
        permisos: [{ permiso: { clave: "admin.acceso" } }],
      },
      usuarioPermisos: [],
    });

    await expect(hasPermission(PERMISOS.ADMIN_ACCESO)).resolves.toBe(false);
  });

  it("C10: un usuario inactivo es rechazado pese al fast-path", async () => {
    setRbac(true);
    h.auth.mockResolvedValue({ user: { id: "admin" } });
    h.findUnique.mockResolvedValue({
      activo: false,
      role: "ADMIN",
      perfilId: "p",
      perfil: { codigo: "ADMIN", esSistema: true, activo: true, permisos: [] },
      usuarioPermisos: [],
    });

    await expect(hasPermission(PERMISOS.ADMIN_ACCESO)).resolves.toBe(false);
  });
});

describe("requirePermissionPage (flag RBAC ON, sin delegar)", () => {
  it("C11: USER sin la clave ⇒ redirige a /dashboard", async () => {
    setRbac(true);
    h.auth.mockResolvedValue({ user: { id: "user" } });
    h.findUnique.mockResolvedValue({
      id: "user",
      activo: true,
      role: "USER",
      perfilId: null,
      perfil: null,
      usuarioPermisos: [],
    });

    await expect(requirePermissionPage(PERMISOS.ADMIN_ACCESO)).rejects.toThrow(
      "NEXT_REDIRECT:/dashboard",
    );
  });

  it("C12: ADMIN ⇒ devuelve userId", async () => {
    setRbac(true);
    h.auth.mockResolvedValue({ user: { id: "admin" } });
    h.findUnique.mockResolvedValue({
      id: "admin",
      activo: true,
      role: "ADMIN",
      perfilId: null,
      perfil: null,
      usuarioPermisos: [],
    });

    await expect(requirePermissionPage(PERMISOS.ADMIN_ACCESO)).resolves.toBe("admin");
    expect(h.redirect).not.toHaveBeenCalled();
  });
});

// ============================================================
// D. Wiring de sesión — los callbacks toleran tokens viejos (sin permisos)
// ============================================================
import { authConfig } from "@/lib/auth.config";

describe("auth.config callbacks (tolerancia a tokens viejos)", () => {
  const sessionCb = authConfig.callbacks.session;
  const jwtCb = authConfig.callbacks.jwt;
  type SessionArg = Parameters<typeof sessionCb>[0];
  type JwtArg = Parameters<typeof jwtCb>[0];

  it("D1: un token sin permisos deja session.user.permisos/perfilCodigo en undefined", async () => {
    const token = {
      id: "u",
      username: "tester",
      nombre: "Tester",
      role: "USER",
      monedaPreferida: "USD",
      modoRetroactivo: false,
    };
    const arg = { session: { user: {} }, token } as unknown as SessionArg;

    const out = await sessionCb(arg);
    expect(out.user.permisos).toBeUndefined();
    expect(out.user.perfilCodigo).toBeUndefined();
  });

  it("D2: el jwt callback copia permisos/perfilCodigo cuando el user los trae", async () => {
    const user = {
      id: "u",
      username: "tester",
      nombre: "Tester",
      role: "ADMIN",
      monedaPreferida: "USD",
      modoRetroactivo: false,
      permisos: ["app.acceso", "admin.acceso"],
      perfilCodigo: "ADMIN",
    };
    const arg = { token: {}, user, trigger: "signIn" } as unknown as JwtArg;

    const out = await jwtCb(arg);
    expect(out.permisos).toEqual(["app.acceso", "admin.acceso"]);
    expect(out.perfilCodigo).toBe("ADMIN");
  });

  it("D2b: sin permisos en el user, el token queda sin permisos (login legacy)", async () => {
    const user = {
      id: "u",
      username: "tester",
      nombre: "Tester",
      role: "USER",
      monedaPreferida: "USD",
      modoRetroactivo: false,
    };
    const arg = { token: {}, user, trigger: "signIn" } as unknown as JwtArg;

    const out = await jwtCb(arg);
    expect(out.permisos).toBeUndefined();
    expect(out.perfilCodigo).toBeUndefined();
  });
});
