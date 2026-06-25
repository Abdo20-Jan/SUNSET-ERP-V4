import { afterEach, describe, expect, it, vi } from "vitest";

// Admin actions de Permisos (PR-009). Verifican: gating ADMIN, protección de
// perfiles de sistema, motivo obligatorio en overrides, auditoría del camino
// feliz y la simulación read-only (preview del set efectivo vía el resolver real
// del motor PR-006). Mocks livianos: auth + db + next/*.

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  userFindUnique: vi.fn(),
  perfilFindUnique: vi.fn(),
  perfilCreate: vi.fn(),
  permisoFindUnique: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => ({ get: () => null })) }));
vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: h.userFindUnique },
    perfil: { findUnique: h.perfilFindUnique, create: h.perfilCreate },
    permiso: { findUnique: h.permisoFindUnique },
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) =>
      cb({
        perfil: { create: h.perfilCreate },
        perfilPermiso: { createMany: vi.fn(), deleteMany: vi.fn() },
        usuarioPermiso: { upsert: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
        auditLog: { create: h.auditCreate },
      }),
    ),
  },
}));

import {
  crearPerfilAction,
  guardarPermisosPerfilAction,
  previewPermisosEfectivosAction,
  setOverrideUsuarioAction,
} from "@/lib/actions/permisos-admin";

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.RBAC_ENABLED;
});

function asAdmin() {
  h.auth.mockResolvedValue({ user: { id: "admin-uuid" } });
}

describe("permisos admin — gating y protecciones", () => {
  it("rechaza crear perfil a un USER", async () => {
    h.auth.mockResolvedValue({ user: { id: "user-uuid" } });
    h.userFindUnique.mockResolvedValue({ activo: true, role: "USER" });

    const res = await crearPerfilAction({ codigo: "OPS", nombre: "Ops" });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/administrador/i);
    expect(h.perfilCreate).not.toHaveBeenCalled();
  });

  it("no deja editar permisos de un perfil de sistema", async () => {
    asAdmin();
    h.userFindUnique.mockResolvedValue({ activo: true, role: "ADMIN" });
    h.perfilFindUnique.mockResolvedValue({ esSistema: true, permisos: [] });

    const res = await guardarPermisosPerfilAction("perfil-admin", { permisoIds: ["p1"] });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/sistema/i);
  });

  it("exige motivo al setear un override", async () => {
    asAdmin();
    h.userFindUnique.mockResolvedValue({ activo: true, role: "ADMIN" });

    const res = await setOverrideUsuarioAction("user-1", {
      permisoId: "permiso-1",
      concedido: true,
      motivo: "",
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/motivo/i);
  });
});

describe("permisos admin — camino feliz", () => {
  it("crea un perfil y audita el evento CREATE en Perfil", async () => {
    asAdmin();
    h.userFindUnique.mockResolvedValue({ activo: true, role: "ADMIN" });
    h.perfilCreate.mockResolvedValue({
      id: "p1",
      codigo: "OPS",
      nombre: "Ops",
      descripcion: null,
    });

    const res = await crearPerfilAction({ codigo: "OPS", nombre: "Ops" });

    expect(res.ok).toBe(true);
    expect(h.auditCreate).toHaveBeenCalledTimes(1);
    const auditArg = h.auditCreate.mock.calls[0]?.[0] as {
      data: { tabla: string; accion: string };
    };
    expect(auditArg.data.tabla).toBe("Perfil");
    expect(auditArg.data.accion).toBe("CREATE");
  });
});

describe("permisos admin — simular (preview read-only)", () => {
  it("calcula el set efectivo del usuario sin tocar la sesión", async () => {
    asAdmin();
    // El guard consulta el usuario de sesión (ADMIN); el preview resuelve el
    // usuario objetivo (USER con un grant de perfil) vía loadUserForPermiso.
    h.userFindUnique.mockImplementation(({ where }: { where: { id: string } }) => {
      if (where.id === "admin-uuid") return Promise.resolve({ activo: true, role: "ADMIN" });
      return Promise.resolve({
        activo: true,
        role: "USER",
        perfilId: "pf",
        perfil: {
          codigo: "OPS",
          esSistema: false,
          activo: true,
          permisos: [{ permiso: { clave: "app.acceso" } }],
        },
        usuarioPermisos: [],
      });
    });

    const res = await previewPermisosEfectivosAction("target-uuid");

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.esAdminTotal).toBe(false);
      expect(res.claves).toContain("app.acceso");
    }
  });
});
