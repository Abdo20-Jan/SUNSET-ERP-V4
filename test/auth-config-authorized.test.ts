import { describe, expect, it } from "vitest";

import { authConfig } from "@/lib/auth.config";

// El callback `authorized` es el gate de ruta que corre en el middleware (edge).
// Lo probamos como función pura: sin sesión → false (NextAuth redirige a /login);
// logueado en /login → rebote a /dashboard; y el gate de rol de /admin (un USER
// no entra a /admin aunque esté logueado). Construimos el argumento con el tipo
// real del callback y un único cast vía `unknown` (evita `any`, que rompe lint).

const authorized = authConfig.callbacks.authorized;
type AuthorizedArg = Parameters<typeof authorized>[0];

function call(role: "ADMIN" | "USER" | null, path: string) {
  const arg = {
    auth: role ? { user: { role } } : null,
    request: { nextUrl: new URL(`http://localhost${path}`) },
  } as unknown as AuthorizedArg;
  return authorized(arg);
}

function redirectLocation(res: boolean | Response): string | null {
  return res instanceof Response ? res.headers.get("location") : null;
}

describe("authConfig.authorized (gate de ruta del middleware)", () => {
  it("bloquea una ruta privada para el no logueado (→ NextAuth redirige a /login)", () => {
    expect(call(null, "/dashboard")).toBe(false);
    expect(call(null, "/admin/recalcular-percepcion-iibb")).toBe(false);
  });

  it("deja pasar al logueado en una ruta privada normal", () => {
    expect(call("USER", "/dashboard")).toBe(true);
    expect(call("USER", "/ventas")).toBe(true);
  });

  it("rebota al logueado que visita /login hacia /dashboard", () => {
    const res = call("USER", "/login");
    expect(redirectLocation(res)).toContain("/dashboard");
  });

  it("deja entrar al no logueado a /login", () => {
    expect(call(null, "/login")).toBe(true);
  });

  it("bloquea /admin para un USER (lo manda a /dashboard) y deja entrar al ADMIN", () => {
    const userRes = call("USER", "/admin/recalcular-percepcion-iibb");
    expect(redirectLocation(userRes)).toContain("/dashboard");

    expect(call("ADMIN", "/admin/recalcular-percepcion-iibb")).toBe(true);
  });
});
