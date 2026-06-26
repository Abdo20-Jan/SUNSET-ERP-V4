import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Query de la Central de Aprobaciones (PR-013) — sólo-lectura. Mockeamos la flag,
// `@/lib/db`, `@/lib/auth` y `@/lib/permisos`. El objetivo central: probar la
// GARANTÍA INERTE (flag off → vacío/0 sin tocar la DB) y el mapeo del DTO.

vi.mock("@/lib/features", () => ({ isApprovalsEnabled: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: { solicitud: { findMany: vi.fn(), findUnique: vi.fn() } },
}));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "u1", role: "ADMIN" } })),
}));
vi.mock("@/lib/permisos", () => ({ hasPermission: vi.fn(async () => true) }));

import { EstadoSolicitud, TipoAprobacion } from "@/generated/prisma/enums";
import { isApprovalsEnabled } from "@/lib/features";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/permisos";
import {
  getPendientesDashboard,
  getSolicitudParaDecision,
  listarAprobaciones,
  listarAprobacionesDeDocumento,
  tiposAprobablesPorUsuario,
} from "@/lib/services/aprobaciones-query";

const flag = vi.mocked(isApprovalsEnabled);
const findMany = vi.mocked(db.solicitud.findMany);
const findUnique = vi.mocked(db.solicitud.findUnique);
const mockHasPermission = vi.mocked(hasPermission);

function filaCruda(over: Record<string, unknown> = {}) {
  return {
    id: "sol-1",
    tipo: TipoAprobacion.MARGEN_BAJA_5,
    estado: EstadoSolicitud.PENDIENTE,
    tabla: "Venta",
    registroId: "venta-1",
    solicitanteId: "u1",
    valor: "1500.50",
    moneda: "ARS",
    slaHoras: 48,
    venceEn: new Date(Date.now() + 1000 * 3_600_000), // muy futuro → banda 0
    requiereDupla: false,
    nivelEscalonamiento: 0,
    solicitante: { nombre: "Ana" },
    aprobaciones: [],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockHasPermission.mockResolvedValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("INERTE con APPROVALS_ENABLED off", () => {
  beforeEach(() => flag.mockReturnValue(false));

  it("listarAprobaciones → [] sin tocar la DB", async () => {
    const rows = await listarAprobaciones({ vista: "pendientes", soloRiesgoSla: false });
    expect(rows).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("listarAprobacionesDeDocumento → []", async () => {
    expect(await listarAprobacionesDeDocumento("Venta", "v1")).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("getSolicitudParaDecision → null", async () => {
    expect(await getSolicitudParaDecision("x")).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("getPendientesDashboard → { count: 0, top: [] }", async () => {
    expect(await getPendientesDashboard()).toEqual({ count: 0, top: [] });
  });

  it("tiposAprobablesPorUsuario → [] (no llama hasPermission)", async () => {
    expect(await tiposAprobablesPorUsuario()).toEqual([]);
    expect(mockHasPermission).not.toHaveBeenCalled();
  });
});

describe("con APPROVALS_ENABLED on", () => {
  beforeEach(() => flag.mockReturnValue(true));

  it("mapea la fila cruda al DTO de la worklist", async () => {
    findMany.mockResolvedValue([filaCruda()] as never);
    const [row] = await listarAprobaciones({ vista: "pendientes", soloRiesgoSla: false });
    expect(row.solicitanteNombre).toBe("Ana");
    expect(row.tipoLabel).toBe("Margen bajo (hasta -5%)");
    expect(row.estadoLabel).toBe("Pendiente");
    expect(row.valor).toBe("1500.50");
    expect(row.moneda).toBe("ARS");
    expect(row.slaBanda).toBe(0); // vence muy en el futuro
    expect(row.aprobadorNombre).toBe("Sin asignar");
    expect(row.permisoAprobacion).toBe("aprobar.margenBaja5");
    expect(row.esSolicitante).toBe(true); // sesión u1 === solicitante u1
  });

  it("EXPIRADA → banda 100 (vencido)", async () => {
    findMany.mockResolvedValue([filaCruda({ estado: EstadoSolicitud.EXPIRADA })] as never);
    const [row] = await listarAprobaciones({ vista: "todos", soloRiesgoSla: false });
    expect(row.slaBanda).toBe(100);
  });

  it("soloRiesgoSla filtra las filas en plazo (banda < 50)", async () => {
    findMany.mockResolvedValue([filaCruda()] as never); // banda 0
    const rows = await listarAprobaciones({ vista: "por-vencer", soloRiesgoSla: true });
    expect(rows).toHaveLength(0);
  });

  it("tiposAprobablesPorUsuario respeta hasPermission", async () => {
    mockHasPermission.mockResolvedValue(true);
    expect((await tiposAprobablesPorUsuario()).length).toBe(Object.values(TipoAprobacion).length);
    mockHasPermission.mockResolvedValue(false);
    expect(await tiposAprobablesPorUsuario()).toEqual([]);
  });

  it("getPendientesDashboard cuenta y corta el top N", async () => {
    findMany.mockResolvedValue([filaCruda({ id: "a" }), filaCruda({ id: "b" })] as never);
    const r = await getPendientesDashboard(1);
    expect(r.count).toBe(2);
    expect(r.top).toHaveLength(1);
  });
});
