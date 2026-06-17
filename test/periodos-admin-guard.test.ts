import { afterEach, describe, expect, it, vi } from "vitest";

// Wiring: cerrar/reabrir un período exige ADMIN. Un USER logueado es rechazado
// ANTES de tocar el período (no muta nada); un ADMIN pasa el guard y sigue el
// flujo normal. Mockeamos auth + db con el mismo patrón liviano del proyecto.

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  userFindUnique: vi.fn(),
  periodoFindUnique: vi.fn(),
  periodoUpdate: vi.fn(),
  asientoCount: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: h.userFindUnique },
    periodoContable: { findUnique: h.periodoFindUnique, update: h.periodoUpdate },
    asiento: { count: h.asientoCount },
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { cerrarPeriodo, reabrirPeriodo } from "@/lib/actions/periodos";

describe("periodos — gate ADMIN", () => {
  afterEach(() => vi.clearAllMocks());

  it("cerrarPeriodo rechaza a un USER sin tocar el período", async () => {
    h.auth.mockResolvedValue({ user: { id: "user-uuid" } });
    h.userFindUnique.mockResolvedValue({ activo: true, role: "USER" });

    const res = await cerrarPeriodo(1);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/administrador/i);
    expect(h.periodoFindUnique).not.toHaveBeenCalled();
    expect(h.periodoUpdate).not.toHaveBeenCalled();
  });

  it("reabrirPeriodo rechaza a un USER sin tocar el período", async () => {
    h.auth.mockResolvedValue({ user: { id: "user-uuid" } });
    h.userFindUnique.mockResolvedValue({ activo: true, role: "USER" });

    const res = await reabrirPeriodo(1);

    expect(res.ok).toBe(false);
    expect(h.periodoUpdate).not.toHaveBeenCalled();
  });

  it("cerrarPeriodo deja pasar al ADMIN (sigue el flujo y consulta el período)", async () => {
    h.auth.mockResolvedValue({ user: { id: "admin-uuid" } });
    h.userFindUnique.mockResolvedValue({ activo: true, role: "ADMIN" });
    h.periodoFindUnique.mockResolvedValue(null); // corta en "Período inexistente"

    const res = await cerrarPeriodo(1);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("Período inexistente.");
    expect(h.periodoFindUnique).toHaveBeenCalledOnce();
  });
});
