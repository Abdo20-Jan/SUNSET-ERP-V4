import { beforeEach, describe, expect, it, vi } from "vitest";

// Server actions DELGADAS (PR-013): probamos que DELEGAN en el motor PR-012, que
// validan el motivo obligatorio ANTES de llamar al motor, y que surfacean el
// error (flag off / invariantes) como `{ ok:false }`. Todo mockeado (sin DB).

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "u1", role: "USER" } })),
}));
vi.mock("@/lib/auth-guard", () => ({ requireSessionUser: vi.fn(async () => "u1") }));
vi.mock("@/lib/permisos", () => ({
  PERMISOS: { APROBACIONES_VER: "aprobaciones.ver" },
  requirePermission: vi.fn(async () => ({ ok: true, userId: "u1" })),
}));
vi.mock("@/lib/services/admin-guard", () => ({ getRequestIp: vi.fn(async () => null) }));
vi.mock("@/lib/services/aprobaciones-query", () => ({ getSolicitudParaDecision: vi.fn() }));
vi.mock("@/lib/services/aprobaciones", () => ({
  aprobar: vi.fn(),
  rechazar: vi.fn(),
  solicitarInformacion: vi.fn(),
  cancelar: vi.fn(),
  crearSolicitud: vi.fn(),
}));

import { TipoAprobacion } from "@/generated/prisma/enums";
import { aprobar, cancelar, crearSolicitud, rechazar } from "@/lib/services/aprobaciones";
import {
  aprobarAction,
  cancelarAction,
  crearSolicitudAction,
  rechazarAction,
} from "@/lib/actions/aprobaciones";

const mAprobar = vi.mocked(aprobar);
const mRechazar = vi.mocked(rechazar);
const mCancelar = vi.mocked(cancelar);
const mCrear = vi.mocked(crearSolicitud);

beforeEach(() => vi.clearAllMocks());

describe("rechazarAction", () => {
  it("exige motivo: vacío → error SIN llamar al motor", async () => {
    const r = await rechazarAction({ solicitudId: "s1", motivo: "   " });
    expect(r).toEqual({ ok: false, error: "El motivo es obligatorio." });
    expect(mRechazar).not.toHaveBeenCalled();
  });

  it("con motivo: delega en el motor", async () => {
    mRechazar.mockResolvedValue({ ok: true } as never);
    const r = await rechazarAction({ solicitudId: "s1", motivo: "Cliente muy riesgoso" });
    expect(r).toEqual({ ok: true });
    expect(mRechazar).toHaveBeenCalledWith(
      expect.objectContaining({
        solicitudId: "s1",
        aprobadorId: "u1",
        motivo: "Cliente muy riesgoso",
      }),
    );
  });
});

describe("aprobarAction", () => {
  it("delega y devuelve ok", async () => {
    mAprobar.mockResolvedValue({ ok: true } as never);
    const r = await aprobarAction({ solicitudId: "s1" });
    expect(r).toEqual({ ok: true });
    expect(mAprobar).toHaveBeenCalledWith(
      expect.objectContaining({ solicitudId: "s1", aprobadorId: "u1", esMasterOverride: false }),
    );
  });

  it("surfacea el error del motor (p.ej. flag off) como ok:false", async () => {
    mAprobar.mockRejectedValue(
      new Error("Motor de aprobaciones deshabilitado (APPROVALS_ENABLED=off)"),
    );
    const r = await aprobarAction({ solicitudId: "s1" });
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ error: expect.stringContaining("deshabilitado") });
  });

  it("propaga el error de negocio del motor (estado no transitable)", async () => {
    mAprobar.mockResolvedValue({
      ok: false,
      error: "El estado actual no permite la transición",
    } as never);
    const r = await aprobarAction({ solicitudId: "s1" });
    expect(r).toEqual({ ok: false, error: "El estado actual no permite la transición" });
  });
});

describe("cancelarAction", () => {
  it("pasa esAdmin derivado de la sesión (USER → false)", async () => {
    mCancelar.mockResolvedValue({ ok: true } as never);
    await cancelarAction({ solicitudId: "s1", motivo: "Ya no aplica" });
    expect(mCancelar).toHaveBeenCalledWith(
      expect.objectContaining({ usuarioId: "u1", esAdmin: false }),
    );
  });
});

describe("crearSolicitudAction", () => {
  it("crea con el solicitante de la sesión", async () => {
    mCrear.mockResolvedValue({ ok: true, solicitud: {} } as never);
    const r = await crearSolicitudAction({
      tipo: TipoAprobacion.MARGEN_BAJA_5,
      tabla: "Venta",
      registroId: "v1",
      motivo: "Margen estratégico",
    });
    expect(r).toEqual({ ok: true });
    expect(mCrear).toHaveBeenCalledWith(
      expect.objectContaining({
        tipo: TipoAprobacion.MARGEN_BAJA_5,
        solicitanteId: "u1",
        tabla: "Venta",
      }),
    );
  });
});
