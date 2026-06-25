import { afterEach, describe, expect, it, vi } from "vitest";

// Admin actions de Usuarios (PR-009). Espeja el estilo de mocks liviano del
// proyecto (periodos-admin-guard / permisos): mockeamos auth + db + next/cache +
// next/headers, y dejamos correr el gate real (requirePermission → requireAdmin
// con la flag OFF). Verificamos: gating ADMIN, lockout (último Master /
// auto-degradación / auto-desactivación) y que el camino feliz audita.

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  userFindUnique: vi.fn(),
  userCount: vi.fn(),
  userCreate: vi.fn(),
  userUpdate: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => ({ get: () => null })) }));
vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: h.userFindUnique,
      count: h.userCount,
      create: h.userCreate,
      update: h.userUpdate,
    },
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) =>
      cb({
        user: { create: h.userCreate, update: h.userUpdate },
        auditLog: { create: h.auditCreate },
      }),
    ),
  },
}));

import {
  actualizarUsuarioAction,
  crearUsuarioAction,
  desactivarUsuarioAction,
} from "@/lib/actions/usuarios";

const ENV_PREVIO = process.env.RBAC_ENABLED;
afterEach(() => {
  vi.clearAllMocks();
  if (ENV_PREVIO === undefined) delete process.env.RBAC_ENABLED;
  else process.env.RBAC_ENABLED = ENV_PREVIO;
});

function asAdmin() {
  h.auth.mockResolvedValue({ user: { id: "admin-uuid" } });
}

const ADMIN_SNAPSHOT = {
  activo: true,
  role: "ADMIN",
  username: "admin",
  nombre: "Admin",
  perfilId: null,
  monedaPreferida: "USD",
  modoRetroactivo: false,
};

describe("usuarios admin — gating", () => {
  it("rechaza crear a un USER (sin admin.acceso)", async () => {
    delete process.env.RBAC_ENABLED;
    h.auth.mockResolvedValue({ user: { id: "user-uuid" } });
    h.userFindUnique.mockResolvedValue({ activo: true, role: "USER" });

    const res = await crearUsuarioAction({
      username: "nuevo",
      nombre: "Nuevo",
      password: "secreto",
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/administrador/i);
    expect(h.userCreate).not.toHaveBeenCalled();
  });
});

describe("usuarios admin — lockout", () => {
  it("no deja degradar al último Master", async () => {
    delete process.env.RBAC_ENABLED;
    asAdmin();
    h.userFindUnique.mockResolvedValue(ADMIN_SNAPSHOT);
    h.userCount.mockResolvedValue(0); // no hay otros masters activos

    const res = await actualizarUsuarioAction("target-uuid", {
      nombre: "X",
      role: "USER",
      activo: true,
      motivo: "baja de rol",
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Master/);
    expect(h.userUpdate).not.toHaveBeenCalled();
  });

  it("no deja al Master quitarse su propio acceso", async () => {
    delete process.env.RBAC_ENABLED;
    asAdmin();
    h.userFindUnique.mockResolvedValue(ADMIN_SNAPSHOT);

    const res = await actualizarUsuarioAction("admin-uuid", {
      nombre: "X",
      role: "USER",
      activo: true,
      motivo: "test",
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/tu propio acceso/i);
    expect(h.userCount).not.toHaveBeenCalled();
  });

  it("no deja al Master desactivarse a sí mismo", async () => {
    delete process.env.RBAC_ENABLED;
    asAdmin();
    h.userFindUnique.mockResolvedValue({ activo: true, role: "ADMIN" });

    const res = await desactivarUsuarioAction("admin-uuid", "motivo válido");

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/tu propio usuario/i);
  });
});

describe("usuarios admin — happy path", () => {
  it("crea un usuario y audita el evento CREATE", async () => {
    delete process.env.RBAC_ENABLED;
    asAdmin();
    h.userFindUnique.mockResolvedValue({ activo: true, role: "ADMIN" });
    h.userCreate.mockResolvedValue({
      id: "new-uuid",
      username: "nuevo",
      nombre: "Nuevo",
      role: "USER",
      activo: true,
      perfilId: null,
      monedaPreferida: "USD",
      modoRetroactivo: false,
    });

    const res = await crearUsuarioAction({
      username: "nuevo",
      nombre: "Nuevo",
      password: "secreto",
    });

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.id).toBe("new-uuid");
    expect(h.auditCreate).toHaveBeenCalledTimes(1);
    const auditArg = h.auditCreate.mock.calls[0]?.[0] as {
      data: { tabla: string; accion: string };
    };
    expect(auditArg.data.tabla).toBe("User");
    expect(auditArg.data.accion).toBe("CREATE");
  });
});
