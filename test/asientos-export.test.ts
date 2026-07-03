import { beforeEach, describe, expect, it, vi } from "vitest";

// CONT-01 / PR-028 — exportación auditada de la worklist de asientos. Espejo
// de test/fin-cxc-export.test.ts: (i) sin sesión NIEGA sin leer la proyección;
// (ii) re-lectura server-side con los MISMOS presets de la URL (vista/período/
// cuenta/fechas — mismos parsers de la page); (iii) las 9 columnas OD-07
// exactas; (iv) el evento EXPORTACION se registra ANTES de entregar (si
// falla, propaga — no se entrega archivo sin registrar).

vi.mock("@/lib/auth-guard", () => ({ requireSessionUser: vi.fn() }));
vi.mock("@/lib/services/asientos-worklist", () => ({
  listarAsientosWorklist: vi.fn(),
  periodoDefaultId: vi.fn(),
}));
vi.mock("@/lib/services/auditar-exportacion", () => ({ auditarExportacion: vi.fn() }));

import { exportarAsientos } from "@/lib/actions/asientos-export";
import { requireSessionUser } from "@/lib/auth-guard";
import { auditarExportacion } from "@/lib/services/auditar-exportacion";
import { listarAsientosWorklist, periodoDefaultId } from "@/lib/services/asientos-worklist";

const mRequire = vi.mocked(requireSessionUser);
const mListar = vi.mocked(listarAsientosWorklist);
const mAuditar = vi.mocked(auditarExportacion);
const mPeriodoDefault = vi.mocked(periodoDefaultId);

const ROW_CON_DOC = {
  id: "a1",
  numero: 7,
  fecha: "2026-06-15T00:00:00.000Z",
  periodoCodigo: "2026-06",
  periodoEstado: "ABIERTO",
  origen: "TESORERIA",
  descripcion: "Cobro venta contado",
  moneda: "ARS",
  totalDebe: "1500.50",
  totalHaber: "1500.50",
  estado: "CONTABILIZADO",
  doc: { tipo: "venta", id: "v1", href: "/ventas/v1", etiqueta: "Venta" },
};

const ROW_MANUAL = {
  ...ROW_CON_DOC,
  id: "a2",
  numero: 8,
  origen: "MANUAL",
  descripcion: "Ajuste manual",
  doc: null,
};

const RESULT = {
  rows: [ROW_CON_DOC, ROW_MANUAL],
  total: 2,
  truncado: false,
  kpis: { borradores: 0, contabilizados: 2, anulados: 0 },
};

const HEADERS_OD07 = [
  "Número",
  "Fecha",
  "Período",
  "Origen",
  "Descripción",
  "Debe",
  "Haber",
  "Estado",
  "Documento origen",
];

function decodeCsv(base64: string): string {
  return Buffer.from(base64, "base64").toString("utf8");
}

beforeEach(() => {
  vi.clearAllMocks();
  mRequire.mockResolvedValue("user-1");
  mListar.mockResolvedValue(RESULT as never);
  mPeriodoDefault.mockResolvedValue(9);
});

describe("exportarAsientos · gate de sesión", () => {
  it("sin sesión: propaga y NO lee la proyección ni audita", async () => {
    mRequire.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));

    await expect(exportarAsientos({ params: {}, formato: "csv" })).rejects.toThrow();
    expect(mListar).not.toHaveBeenCalled();
    expect(mAuditar).not.toHaveBeenCalled();
  });
});

describe("exportarAsientos · re-lectura server-side + columnas OD-07", () => {
  it("re-lee la MISMA proyección con los presets de la URL parseados", async () => {
    const res = await exportarAsientos({
      params: {
        vista: "anulados",
        periodo: "4",
        cuentaId: "42",
        desde: "2026-06-01",
        hasta: "2026-06-30",
      },
      formato: "csv",
    });

    expect(res.ok).toBe(true);
    expect(mListar).toHaveBeenCalledOnce();
    expect(mListar).toHaveBeenCalledWith({
      vista: "anulados",
      periodoId: 4,
      cuentaId: 42,
      fechaDesde: new Date("2026-06-01T00:00:00.000Z"),
      fechaHasta: new Date("2026-06-30T23:59:59.999Z"),
    });
  });

  it("`?periodo=todos` viaja como periodoId undefined (sin filtro de período)", async () => {
    await exportarAsientos({ params: { periodo: "todos" }, formato: "csv" });

    expect(mListar).toHaveBeenCalledWith(expect.objectContaining({ periodoId: undefined }));
    expect(mPeriodoDefault).not.toHaveBeenCalled();
  });

  it("URL sin `?periodo=` espeja el DEFAULT del grid (período que contiene hoy)", async () => {
    await exportarAsientos({ params: {}, formato: "csv" });

    // Hallazgo del QA visual PR-028: la page aplica el período default
    // server-side aunque no esté en la URL — el export debe espejarlo.
    expect(mPeriodoDefault).toHaveBeenCalledOnce();
    expect(mListar).toHaveBeenCalledWith(expect.objectContaining({ periodoId: 9 }));
  });

  it("el archivo lleva EXACTAMENTE las 9 columnas OD-07, doc null → celda vacía", async () => {
    const res = await exportarAsientos({ params: {}, formato: "csv" });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const csv = decodeCsv(res.base64);
    const lineas = csv.trim().split(/\r?\n/);
    expect(lineas).toHaveLength(3); // header + 2 filas
    expect(lineas[0].split(",")).toEqual(HEADERS_OD07);

    const filaVenta = (lineas.find((l) => l.includes("Cobro venta contado")) as string).split(",");
    expect(filaVenta[0]).toBe("7");
    expect(filaVenta[1]).toBe("2026-06-15");
    expect(filaVenta[2]).toBe("2026-06");
    expect(filaVenta[8]).toBe("Venta");

    const filaManual = (lineas.find((l) => l.includes("Ajuste manual")) as string).split(",");
    expect(filaManual[8]).toBe(""); // sin documento de origen
    expect(res.filename).toMatch(/^contabilidad-asientos-\d+\.csv$/);
  });

  it("registra el evento EXPORTACION con recurso/filtros/nFilas antes de entregar", async () => {
    await exportarAsientos({ params: { vista: "manuales", periodo: "4" }, formato: "csv" });

    expect(mAuditar).toHaveBeenCalledOnce();
    expect(mAuditar).toHaveBeenCalledWith(
      expect.objectContaining({
        recurso: "contabilidad-asientos",
        formato: "csv",
        nFilas: 2,
        columnas: HEADERS_OD07,
        filtros: expect.objectContaining({ vista: "manuales", periodoId: 4 }),
      }),
    );
  });

  it("si la meta-auditoría falla, propaga (no entrega archivo sin registrar)", async () => {
    mAuditar.mockRejectedValueOnce(new Error("audit down"));

    await expect(exportarAsientos({ params: {}, formato: "csv" })).rejects.toThrow("audit down");
  });
});
