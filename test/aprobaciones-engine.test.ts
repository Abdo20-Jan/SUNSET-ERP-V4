import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// Motor de aprobaciones (PR-012) — máquina de estados contra una BD real
// (Testcontainers). Mockeamos `@/lib/db` (apunta al contenedor) y `@/lib/permisos`
// (gate controlable). `registrarAuditoria` es REAL: escribe AuditLog y lo
// aseveramos. La flag se controla por `process.env.APPROVALS_ENABLED`.

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

import {
  AuditAccion,
  AuditOrigen,
  EstadoSolicitud,
  TipoAprobacion,
  TipoDecisionAprobacion,
} from "@/generated/prisma/enums";
import { hasPermission } from "@/lib/permisos";
import {
  aprobar,
  cancelar,
  crearSolicitud,
  rechazar,
  responderInformacion,
  solicitarInformacion,
} from "@/lib/services/aprobaciones";

const mockHasPermission = vi.mocked(hasPermission);
const AHORA = new Date("2026-06-25T00:00:00.000Z");
const SOLICITANTE = "user-uuid";
const APROBADOR_1 = "aprobador-1";
const APROBADOR_2 = "aprobador-2";

describe("aprobaciones — máquina de estados", () => {
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
    mockHasPermission.mockResolvedValue(true);
    process.env.APPROVALS_ENABLED = "true";
    await db.reset(["Aprobacion", "Solicitud", "AuditLog"]);
    await db.prisma.user.createMany({
      data: [
        {
          id: APROBADOR_1,
          username: "aprob1",
          passwordHash: "x",
          nombre: "Aprobador 1",
          role: "USER",
        },
        {
          id: APROBADOR_2,
          username: "aprob2",
          passwordHash: "x",
          nombre: "Aprobador 2",
          role: "USER",
        },
      ],
      skipDuplicates: true,
    });
  });

  async function crear(tipo: TipoAprobacion = TipoAprobacion.MARGEN_BAJA_5) {
    const r = await crearSolicitud({
      tipo,
      tabla: "Venta",
      registroId: "venta-1",
      solicitanteId: SOLICITANTE,
      motivo: "margen por debajo del piso",
      ahora: AHORA,
    });
    return r.solicitud;
  }

  function estadoDe(id: string) {
    return db.prisma.solicitud.findUnique({ where: { id } });
  }

  it("crearSolicitud → PENDIENTE con venceEn = ahora + SLA y un audit MANUAL", async () => {
    const s = await crear();
    expect(s.estado).toBe(EstadoSolicitud.PENDIENTE);
    expect(s.slaHoras).toBe(48);
    expect(s.venceEn.getTime()).toBe(AHORA.getTime() + 48 * 3_600_000);
    const audits = await db.prisma.auditLog.findMany({
      where: { tabla: "Solicitud", registroId: s.id },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0].accion).toBe(AuditAccion.CAMBIO_ESTADO);
    expect(audits[0].origen).toBe(AuditOrigen.MANUAL);
    expect(audits[0].usuarioId).toBe(SOLICITANTE);
  });

  it("aprobar simple → APROBADA, resueltaEn seteado, audit APROBACION", async () => {
    const s = await crear();
    const r = await aprobar({ solicitudId: s.id, aprobadorId: APROBADOR_1, ahora: AHORA });
    expect(r.ok).toBe(true);
    const reloaded = await estadoDe(s.id);
    expect(reloaded?.estado).toBe(EstadoSolicitud.APROBADA);
    expect(reloaded?.resueltaEn).not.toBeNull();
    const audits = await db.prisma.auditLog.count({
      where: { registroId: s.id, accion: AuditAccion.APROBACION },
    });
    expect(audits).toBe(1);
  });

  it("dupla: 1ª aprobación parcial (PENDIENTE), 2ª distinta → APROBADA", async () => {
    const s = await crear(TipoAprobacion.MARGEN_BAJA_MAYOR_10);
    const r1 = await aprobar({ solicitudId: s.id, aprobadorId: APROBADOR_1, ahora: AHORA });
    expect(r1.ok).toBe(true);
    if (r1.ok) expect(r1.solicitud.estado).toBe(EstadoSolicitud.PENDIENTE);
    const r2 = await aprobar({ solicitudId: s.id, aprobadorId: APROBADOR_2, ahora: AHORA });
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.solicitud.estado).toBe(EstadoSolicitud.APROBADA);
  });

  it("dupla: la misma persona aprueba 2 veces → {ok:false}, sigue PENDIENTE", async () => {
    const s = await crear(TipoAprobacion.MARGEN_BAJA_MAYOR_10);
    await aprobar({ solicitudId: s.id, aprobadorId: APROBADOR_1, ahora: AHORA });
    const r2 = await aprobar({ solicitudId: s.id, aprobadorId: APROBADOR_1, ahora: AHORA });
    expect(r2.ok).toBe(false);
    expect((await estadoDe(s.id))?.estado).toBe(EstadoSolicitud.PENDIENTE);
    const aprobadas = await db.prisma.aprobacion.count({
      where: { solicitudId: s.id, decision: TipoDecisionAprobacion.APROBADA },
    });
    expect(aprobadas).toBe(1);
  });

  it("dupla parcial + rechazo → RECHAZADA (un rechazo veta la dupla)", async () => {
    const s = await crear(TipoAprobacion.MARGEN_BAJA_MAYOR_10);
    await aprobar({ solicitudId: s.id, aprobadorId: APROBADOR_1, ahora: AHORA });
    const r = await rechazar({
      solicitudId: s.id,
      aprobadorId: APROBADOR_2,
      motivo: "no autorizo",
      ahora: AHORA,
    });
    expect(r.ok).toBe(true);
    expect((await estadoDe(s.id))?.estado).toBe(EstadoSolicitud.RECHAZADA);
  });

  it("rechazar sin motivo → {ok:false}, sin cambio ni audit nuevo", async () => {
    const s = await crear();
    const r = await rechazar({
      solicitudId: s.id,
      aprobadorId: APROBADOR_1,
      motivo: "   ",
      ahora: AHORA,
    });
    expect(r.ok).toBe(false);
    expect((await estadoDe(s.id))?.estado).toBe(EstadoSolicitud.PENDIENTE);
    const cambios = await db.prisma.auditLog.count({
      where: { registroId: s.id, accion: AuditAccion.CAMBIO_ESTADO },
    });
    expect(cambios).toBe(1); // sólo la creación
  });

  it("solicitarInformacion → SOLICITANDO_INFO (idempotente); responder → PENDIENTE", async () => {
    const s = await crear();
    const r1 = await solicitarInformacion({
      solicitudId: s.id,
      aprobadorId: APROBADOR_1,
      comentario: "falta el comprobante",
      ahora: AHORA,
    });
    expect(r1.ok).toBe(true);
    if (r1.ok) expect(r1.solicitud.estado).toBe(EstadoSolicitud.SOLICITANDO_INFO);
    const r2 = await solicitarInformacion({
      solicitudId: s.id,
      aprobadorId: APROBADOR_1,
      comentario: "insisto",
      ahora: AHORA,
    });
    expect(r2.ok).toBe(true);
    const resp = await responderInformacion({
      solicitudId: s.id,
      usuarioId: SOLICITANTE,
      comentario: "adjunto el comprobante",
      ahora: AHORA,
    });
    expect(resp.ok).toBe(true);
    expect((await estadoDe(s.id))?.estado).toBe(EstadoSolicitud.PENDIENTE);
  });

  it("aprobar desde SOLICITANDO_INFO está permitido", async () => {
    const s = await crear();
    await solicitarInformacion({
      solicitudId: s.id,
      aprobadorId: APROBADOR_1,
      comentario: "?",
      ahora: AHORA,
    });
    const r = await aprobar({ solicitudId: s.id, aprobadorId: APROBADOR_1, ahora: AHORA });
    expect(r.ok).toBe(true);
    expect((await estadoDe(s.id))?.estado).toBe(EstadoSolicitud.APROBADA);
  });

  it("cancelar: solicitante OK; otro no-admin → {ok:false}; terminal → {ok:false}", async () => {
    const s1 = await crear();
    const ok = await cancelar({
      solicitudId: s1.id,
      usuarioId: SOLICITANTE,
      motivo: "ya no aplica",
      ahora: AHORA,
    });
    expect(ok.ok).toBe(true);
    expect((await estadoDe(s1.id))?.estado).toBe(EstadoSolicitud.CANCELADA);

    const s2 = await crear();
    const ajeno = await cancelar({
      solicitudId: s2.id,
      usuarioId: APROBADOR_1,
      motivo: "x",
      ahora: AHORA,
    });
    expect(ajeno.ok).toBe(false);

    const s3 = await crear();
    await aprobar({ solicitudId: s3.id, aprobadorId: APROBADOR_1, ahora: AHORA });
    const terminal = await cancelar({
      solicitudId: s3.id,
      usuarioId: SOLICITANTE,
      motivo: "x",
      ahora: AHORA,
    });
    expect(terminal.ok).toBe(false);
  });

  it("admin puede cancelar una solicitud ajena (esAdmin)", async () => {
    const s = await crear();
    const r = await cancelar({
      solicitudId: s.id,
      usuarioId: APROBADOR_1,
      motivo: "anulada por master",
      esAdmin: true,
      ahora: AHORA,
    });
    expect(r.ok).toBe(true);
    expect((await estadoDe(s.id))?.estado).toBe(EstadoSolicitud.CANCELADA);
  });

  it("permiso denegado: aprobar/rechazar/solicitarInfo → {ok:false}, sin filas", async () => {
    const s = await crear();
    mockHasPermission.mockResolvedValue(false);
    expect((await aprobar({ solicitudId: s.id, aprobadorId: APROBADOR_1, ahora: AHORA })).ok).toBe(
      false,
    );
    expect(
      (await rechazar({ solicitudId: s.id, aprobadorId: APROBADOR_1, motivo: "x", ahora: AHORA }))
        .ok,
    ).toBe(false);
    expect(
      (
        await solicitarInformacion({
          solicitudId: s.id,
          aprobadorId: APROBADOR_1,
          comentario: "x",
          ahora: AHORA,
        })
      ).ok,
    ).toBe(false);
    expect((await estadoDe(s.id))?.estado).toBe(EstadoSolicitud.PENDIENTE);
    expect(await db.prisma.aprobacion.count({ where: { solicitudId: s.id } })).toBe(0);
  });

  it("master override resuelve una dupla en una sola acción (audit MASTER_OVERRIDE)", async () => {
    const s = await crear(TipoAprobacion.MARGEN_BAJA_MAYOR_10);
    const r = await aprobar({
      solicitudId: s.id,
      aprobadorId: APROBADOR_1,
      esMasterOverride: true,
      ahora: AHORA,
    });
    expect(r.ok).toBe(true);
    expect((await estadoDe(s.id))?.estado).toBe(EstadoSolicitud.APROBADA);
    const overrides = await db.prisma.auditLog.count({
      where: {
        registroId: s.id,
        accion: AuditAccion.MASTER_OVERRIDE,
        origen: AuditOrigen.MASTER_OVERRIDE,
      },
    });
    expect(overrides).toBe(1);
  });

  it("APPROVALS_ENABLED off → toda función pública lanza (inerte), sin filas", async () => {
    delete process.env.APPROVALS_ENABLED;
    await expect(
      crearSolicitud({
        tipo: TipoAprobacion.MARGEN_BAJA_5,
        tabla: "Venta",
        registroId: "v",
        solicitanteId: SOLICITANTE,
        motivo: "x",
        ahora: AHORA,
      }),
    ).rejects.toThrow();
    await expect(
      aprobar({ solicitudId: "no-existe", aprobadorId: APROBADOR_1, ahora: AHORA }),
    ).rejects.toThrow();
    expect(await db.prisma.solicitud.count()).toBe(0);
  });
});
