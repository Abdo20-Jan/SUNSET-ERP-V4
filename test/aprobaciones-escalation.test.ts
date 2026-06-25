import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// Régua de escalonamiento SLA (PR-012 · AUTO-01) contra BD real. El tiempo se
// inyecta como `ahora`, así que controlamos las bandas 50/75/100% con fechas.

const h = vi.hoisted(() => {
  let client: PrismaClient | undefined;
  return {
    setClient: (c: PrismaClient) => {
      client = c;
    },
    dbProxy: new Proxy(
      {},
      {
        get(_t, prop) {
          const target = client as unknown as Record<string | symbol, unknown> | undefined;
          const value = target?.[prop];
          return typeof value === "function"
            ? (value as (...args: unknown[]) => unknown).bind(client)
            : value;
        },
      },
    ),
  };
});

vi.mock("@/lib/db", () => ({ db: h.dbProxy }));
vi.mock("@/lib/permisos", () => ({ hasPermission: vi.fn(async () => true) }));

import { AuditOrigen, EstadoSolicitud, TipoAprobacion } from "@/generated/prisma/enums";
import { crearSolicitud, procesarEscalonamientos } from "@/lib/services/aprobaciones";

const T0 = new Date("2026-06-25T00:00:00.000Z");
const H = 3_600_000;
const SOLICITANTE = "user-uuid";

describe("aprobaciones — escalonamiento SLA (AUTO-01)", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    h.setClient(db.prisma);
  });

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.APPROVALS_ENABLED = "true";
    await db.reset(["Aprobacion", "Solicitud", "AuditLog"]);
  });

  // MARGEN_BAJA_5: SLA 48h, escalonamiento de 2 tiers (director, master).
  async function crear() {
    const r = await crearSolicitud({
      tipo: TipoAprobacion.MARGEN_BAJA_5,
      tabla: "Venta",
      registroId: "venta-1",
      solicitanteId: SOLICITANTE,
      motivo: "margen por debajo del piso",
      ahora: T0,
    });
    return r.solicitud;
  }

  function recargar(id: string) {
    return db.prisma.solicitud.findUnique({ where: { id } });
  }

  it("50%: emite un recordatorio; 2ª pasada en la misma banda → ninguna (idempotente)", async () => {
    const s = await crear();
    const t50 = new Date(T0.getTime() + 24 * H);
    const r1 = await procesarEscalonamientos(t50);
    expect(r1).toHaveLength(1);
    expect(r1[0].accion).toBe("recordatorio");
    expect(r1[0].banda).toBe(50);
    expect((await recargar(s.id))?.ultimoHitoSla).toBe(50);

    const r2 = await procesarEscalonamientos(t50);
    expect(r2[0].accion).toBe("ninguna");
  });

  it("75%: recordatorio + notificación al gestor (2 destinatarios)", async () => {
    await crear();
    const r = await procesarEscalonamientos(new Date(T0.getTime() + 36 * H));
    expect(r[0].accion).toBe("recordatorio");
    expect(r[0].banda).toBe(75);
    expect(r[0].destinatarios).toHaveLength(2);
  });

  it("100% en nivel base → escala un nivel; deadline a la mitad; hito reseteado; audit AUTOMACION", async () => {
    const s = await crear();
    const t100 = new Date(T0.getTime() + 48 * H);
    const r = await procesarEscalonamientos(t100);
    expect(r[0].accion).toBe("escalado");
    expect(r[0].nivel).toBe(1);
    const reloaded = await recargar(s.id);
    expect(reloaded?.nivelEscalonamiento).toBe(1);
    expect(reloaded?.ultimoHitoSla).toBe(0);
    expect(reloaded?.venceEn.getTime()).toBe(t100.getTime() + 24 * H);
    const autos = await db.prisma.auditLog.count({
      where: { registroId: s.id, origen: AuditOrigen.AUTOMACION },
    });
    expect(autos).toBeGreaterThanOrEqual(1);
  });

  it("una sola pasada avanza exactamente UN nivel, aunque esté muy vencida", async () => {
    const s = await crear();
    const tarde = new Date(T0.getTime() + 1000 * H);
    const r = await procesarEscalonamientos(tarde);
    expect(r[0].accion).toBe("escalado");
    expect((await recargar(s.id))?.nivelEscalonamiento).toBe(1);
  });

  it("tras agotar los tiers (base→director→master) → EXPIRADA", async () => {
    const s = await crear();
    // nivel 0 → 1 (vencimiento del SLA base)
    let t = new Date(T0.getTime() + 48 * H);
    await procesarEscalonamientos(t);
    // nivel 1 → 2 (vencimiento de la ventana mitad)
    t = new Date(t.getTime() + 24 * H);
    await procesarEscalonamientos(t);
    // nivel 2 (último tier) vencido → EXPIRA
    t = new Date(t.getTime() + 24 * H);
    const r = await procesarEscalonamientos(t);
    expect(r[0].accion).toBe("expirado");
    expect((await recargar(s.id))?.estado).toBe(EstadoSolicitud.EXPIRADA);
  });

  it("APPROVALS_ENABLED off → procesarEscalonamientos lanza (inerte)", async () => {
    delete process.env.APPROVALS_ENABLED;
    await expect(procesarEscalonamientos(T0)).rejects.toThrow();
  });
});
