import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CockpitData } from "@/lib/services/comex-cockpit";
import { BRIEFING_COLUMNS, construirBriefing } from "@/lib/services/comex-cockpit-briefing";

// ── Mocks de los módulos server-only que la acción orquesta ──────────────────
vi.mock("@/lib/permisos", () => ({
  PERMISOS: {
    COMEX_COCKPIT_EXPORTAR: "comex.cockpit.exportar",
    VER_COSTO_LANDED: "costos.verLanded",
  },
  hasPermission: vi.fn(),
  requirePermission: vi.fn(),
}));
vi.mock("@/lib/services/comex-cockpit", () => ({ getCockpitData: vi.fn() }));
vi.mock("@/lib/services/auditar-exportacion", () => ({ auditarExportacion: vi.fn() }));

import { exportarCockpitDia } from "@/lib/actions/comex-cockpit-export";
import { auditarExportacion } from "@/lib/services/auditar-exportacion";
import { getCockpitData } from "@/lib/services/comex-cockpit";
import { hasPermission, requirePermission } from "@/lib/permisos";

const mGetData = vi.mocked(getCockpitData);
const mAuditar = vi.mocked(auditarExportacion);
const mHas = vi.mocked(hasPermission);
const mRequire = vi.mocked(requirePermission);

// ── Fixture de CockpitData (todos los campos financieros presentes) ──────────
function mkData(overrides: Partial<CockpitData> = {}): CockpitData {
  return {
    indicadores: {
      contenedoresEnTransito: 3,
      contenedoresTransitoFobUsd: "10000",
      fobCfrAbiertoUsd: "20000",
      cashOut30dUsd: "5000",
      alertasCriticos: 1,
    },
    operacion: {
      procesosCriticos: [
        {
          id: "e1",
          codigo: "IMP-1",
          proveedorNombre: "Prov A",
          estado: "EN_TRANSITO",
          motivo: "Documento bloqueante",
          proximaAccion: "Revisar BL",
        },
      ],
      proximosArribos: [
        {
          id: "e2",
          codigo: "IMP-2",
          proveedorNombre: "Prov B",
          estado: "EN_TRANSITO",
          fechaLlegada: "2026-07-01T00:00:00.000Z",
          etaTono: "soon",
          fobUsd: "30000",
          proximaAccion: "Coordinar arribo",
        },
      ],
      sinActualizacion: [
        {
          id: "e3",
          codigo: "IMP-3",
          proveedorNombre: "Prov C",
          estado: "EN_PUERTO",
          updatedAt: "2026-06-20T00:00:00.000Z",
          dias: 8,
          banda: "amber",
          proximaAccion: "Actualizar estado",
        },
      ],
    },
    documentos: [
      { id: "e4", codigo: "IMP-4", proveedorNombre: "Prov D", estado: "EN_ADUANA", contenedoresSinBL: 2 },
    ],
    custos: [
      { id: "e5", codigo: "IMP-5", proveedorNombre: "Prov E", estado: "DESPACHADO", statusCosto: "Provisionado" },
    ],
    financeiro: {
      pagosExteriores: [
        {
          embarqueId: "e6",
          embarqueCodigo: "IMP-6",
          proveedorNombre: "Prov F",
          saldoUsd: "15000",
          fechaVencimiento: "2026-07-05T00:00:00.000Z",
        },
      ],
      sinFechaCount: 0,
    },
    proveedorOpciones: [],
    calendario: {
      semanas: [
        {
          inicioISO: "2026-06-22",
          dias: [
            {
              diaISO: "2026-06-28",
              dia: 28,
              esHoy: true,
              eventos: [
                {
                  embarqueId: "e2",
                  codigo: "IMP-2",
                  proveedorNombre: "Prov B",
                  tipo: "arribo",
                  fechaISO: "2026-06-28T00:00:00.000Z",
                  tab: "operacion",
                },
              ],
            },
            {
              diaISO: "2026-06-29",
              dia: 29,
              esHoy: false,
              eventos: [
                {
                  embarqueId: "e7",
                  codigo: "IMP-7",
                  proveedorNombre: "Prov G",
                  tipo: "despacho",
                  fechaISO: "2026-06-29T00:00:00.000Z",
                  tab: "aduana",
                },
              ],
            },
          ],
        },
      ],
      totalEventos: 2,
      fueraDeVentana: 0,
    },
    ...overrides,
  };
}

// ── construirBriefing (puro) ─────────────────────────────────────────────────

describe("construirBriefing", () => {
  it("aplana todas las secciones del briefing en filas", () => {
    const rows = construirBriefing(mkData());
    const secciones = new Set(rows.map((r) => r.seccion));
    expect(secciones).toEqual(
      new Set(["Indicador", "Crítico", "Arribo", "Sin actualizar", "Documento", "Costo", "Pago", "Agenda"]),
    );
    // Indicadores: 4 filas fijas (containers/FOB-CFR/cash-out/alertas).
    expect(rows.filter((r) => r.seccion === "Indicador")).toHaveLength(4);
  });

  it("con permiso: los valores USD viajan (FOB/CFR, cash-out, FOB arribo, saldo pago)", () => {
    const rows = construirBriefing(mkData());
    const fobCfr = rows.find((r) => r.codigo === "FOB/CFR abierto");
    expect(fobCfr?.valor).toBe("20000");
    expect(rows.find((r) => r.seccion === "Arribo")?.valor).toBe("30000");
    expect(rows.find((r) => r.seccion === "Pago")?.valor).toBe("15000");
  });

  it("agenda = SÓLO eventos del día de hoy (celda esHoy)", () => {
    const agenda = construirBriefing(mkData()).filter((r) => r.seccion === "Agenda");
    expect(agenda).toHaveLength(1);
    expect(agenda[0]?.codigo).toBe("IMP-2"); // evento de hoy; el de mañana (IMP-7) NO entra
  });

  it("sin permiso (datos enmascarados): NINGÚN valor de costo en el briefing", () => {
    const masked = mkData({
      indicadores: {
        contenedoresEnTransito: 3,
        contenedoresTransitoFobUsd: null,
        fobCfrAbiertoUsd: null,
        cashOut30dUsd: null,
        alertasCriticos: 1,
      },
      financeiro: null, // sección Financeiro OMITIDA server-side
      operacion: {
        procesosCriticos: [],
        proximosArribos: [
          {
            id: "e2",
            codigo: "IMP-2",
            proveedorNombre: "Prov B",
            estado: "EN_TRANSITO",
            fechaLlegada: "2026-07-01T00:00:00.000Z",
            etaTono: "soon",
            fobUsd: null, // arribo "sin valores"
            proximaAccion: "Coordinar",
          },
        ],
        sinActualizacion: [],
      },
    });
    const rows = construirBriefing(masked);
    // Sin filas de Pago (Financeiro omitido) y ningún `valor` no vacío.
    expect(rows.some((r) => r.seccion === "Pago")).toBe(false);
    expect(rows.every((r) => r.valor === "")).toBe(true);
  });
});

// ── exportarCockpitDia (orquestación auditada) ───────────────────────────────

describe("exportarCockpitDia", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mRequire.mockResolvedValue({ ok: true, userId: "u1" });
    mHas.mockResolvedValue(true);
    mGetData.mockResolvedValue(mkData());
    mAuditar.mockResolvedValue(undefined);
  });

  it("gate negado: no exporta, no re-lee, no audita", async () => {
    mRequire.mockResolvedValue({ ok: false, error: "Requiere permisos de administrador." });
    const res = await exportarCockpitDia({ params: {}, formato: "csv" });
    expect(res.ok).toBe(false);
    expect(mGetData).not.toHaveBeenCalled();
    expect(mAuditar).not.toHaveBeenCalled();
  });

  it("happy path: entrega CSV en base64 y AUDITA el evento EXPORTACION", async () => {
    const res = await exportarCockpitDia({ params: {}, formato: "csv" });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    const csv = Buffer.from(res.base64, "base64").toString("utf8");
    expect(csv).toContain("Sección");
    expect(csv).toContain("IMP-1");
    expect(res.filename).toMatch(/^comex-cockpit-dia-\d{12}\.csv$/);

    expect(mAuditar).toHaveBeenCalledTimes(1);
    const arg = mAuditar.mock.calls[0]?.[0];
    expect(arg?.recurso).toBe("comex-cockpit");
    expect(arg?.formato).toBe("csv");
    expect(arg?.columnas).toEqual(BRIEFING_COLUMNS.map((c) => c.header));
    expect(arg?.nFilas).toBeGreaterThan(0);
  });

  it("strip de costo: sin VER_COSTO_LANDED, re-lee con verCosto=false y lo registra", async () => {
    mHas.mockResolvedValue(false); // VER_COSTO_LANDED denegado
    await exportarCockpitDia({ params: {}, formato: "csv" });
    expect(mGetData).toHaveBeenCalledWith(expect.objectContaining({ verCosto: false }));
    const arg = mAuditar.mock.calls[0]?.[0];
    expect((arg?.filtros as { verCosto: boolean }).verCosto).toBe(false);
  });

  it("reproduce los filtros de SERVIDOR (vista/proveedor), no la búsqueda rápida", async () => {
    await exportarCockpitDia({
      params: { vista: "transito", proveedor: "P1" },
      formato: "csv",
    });
    const call = mGetData.mock.calls[0]?.[0];
    expect(call?.filtros).toEqual(
      expect.objectContaining({ proveedorId: "P1", estado: ["EN_TRANSITO"] }),
    );
    const arg = mAuditar.mock.calls[0]?.[0];
    expect((arg?.filtros as { proveedorId: string; vista: string }).proveedorId).toBe("P1");
    expect((arg?.filtros as { vista: string }).vista).toBe("transito");
  });

  it("si la auditoría falla, propaga → NO se entrega el archivo", async () => {
    mAuditar.mockRejectedValue(new Error("audit down"));
    await expect(exportarCockpitDia({ params: {}, formato: "csv" })).rejects.toThrow("audit down");
  });
});
