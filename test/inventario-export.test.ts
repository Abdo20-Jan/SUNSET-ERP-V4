import { beforeEach, describe, expect, it, vi } from "vitest";

// INV-01 / PR-027 — exportación auditada de la worklist de inventario.
// Espejo de test/fin-cxc-export.test.ts (PR-026). Verifica: (i) re-check
// server-side de VER_COSTO_STOCK — sin la clave la columna "Costo promedio"
// NO EXISTE en el archivo (consume-or-omit, jamás "—") y la proyección se
// pide SIN costo; (ii) re-lectura server-side con los MISMOS presets
// (`?vista=`/`?dias=`/`?agrupar=`) que la page; (iii) el evento EXPORTACION
// se registra ANTES de entregar (si falla, propaga).

vi.mock("@/lib/auth-guard", () => ({ requireSessionUser: vi.fn() }));
vi.mock("@/lib/permisos-masking", () => ({ puedeVerCostoStock: vi.fn() }));
vi.mock("@/lib/services/auditar-exportacion", () => ({ auditarExportacion: vi.fn() }));
// Seguridad: ni el db real ni las queries viejas se cargan en este test.
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/actions/inventario", () => ({
  listarEnTransito: vi.fn(),
  listarEnProduccion: vi.fn(),
}));
// Mock PARCIAL del servicio: la proyección se mockea, pero los helpers de
// presets (resolverVista/filtrarPorVista/ordenarPorDeposito) son los REALES —
// el test traba que el archivo espeja exactamente la vista de la page.
vi.mock("@/lib/services/inventario-worklist", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/inventario-worklist")>();
  return { ...actual, listarInventarioWorklist: vi.fn() };
});

import { exportarInventarioWorklist } from "@/lib/actions/inventario-export";
import { requireSessionUser } from "@/lib/auth-guard";
import { puedeVerCostoStock } from "@/lib/permisos-masking";
import { auditarExportacion } from "@/lib/services/auditar-exportacion";
import {
  type InventarioWorklistRow,
  listarInventarioWorklist,
} from "@/lib/services/inventario-worklist";

const mRequire = vi.mocked(requireSessionUser);
const mVerCosto = vi.mocked(puedeVerCostoStock);
const mListar = vi.mocked(listarInventarioWorklist);
const mAuditar = vi.mocked(auditarExportacion);

function fila(overrides: Partial<InventarioWorklistRow>): InventarioWorklistRow {
  return {
    id: "p1:d1",
    productoId: "p1",
    codigo: "1001",
    nombre: "Neumático 205/55R16",
    marca: "Sunset",
    medida: "205/55R16",
    stockMinimo: 0,
    depositoId: "d1",
    depositoNombre: "Central",
    depositoFiscal: false,
    fisico: 100,
    reservado: 20,
    disponible: 80,
    costoPromedio: null,
    ultimoMovimiento: "2026-06-30T00:00:00.000Z",
    sinMovimientoDias: 2,
    enFiscal: 0,
    fiscalBreakdown: [],
    futuroComex: {
      total: 0,
      enProduccion: 0,
      enTransito: 0,
      enTransitoTotal: 0,
      enProduccionTotal: 0,
    },
    despachosActivos: 0,
    totalFisicoNacional: 100,
    bajoMinimo: false,
    alerta: null,
    ...overrides,
  };
}

// Orden producto-céntrico del servicio; "Alfa Fiscal" queda primera SOLO con
// `?agrupar=deposito` (orden por depósito).
const ROWS: InventarioWorklistRow[] = [
  fila({ costoPromedio: "123.45" }),
  fila({
    id: "p1:d2",
    depositoId: "d2",
    depositoNombre: "Alfa Fiscal",
    depositoFiscal: true,
    fisico: 300,
    reservado: 0,
    disponible: 300,
    costoPromedio: "119.00",
  }),
  fila({
    id: "p2:d1",
    productoId: "p2",
    codigo: "1002",
    nombre: "Neumático 175/70R13",
    fisico: -5,
    reservado: 0,
    disponible: -5,
    alerta: "negativo",
  }),
];

function decodeCsv(base64: string): string {
  return Buffer.from(base64, "base64").toString("utf8");
}

beforeEach(() => {
  vi.clearAllMocks();
  mRequire.mockResolvedValue("user-1");
  mListar.mockResolvedValue({ rows: ROWS });
});

describe("exportarInventarioWorklist · gate VER_COSTO_STOCK (consume-or-omit)", () => {
  it("sin la clave: la columna 'Costo promedio' NO EXISTE y la proyección se pide sin costo", async () => {
    mVerCosto.mockResolvedValue(false);

    const res = await exportarInventarioWorklist({ params: {}, formato: "csv" });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const csv = decodeCsv(res.base64);
    const header = csv.split(/\r?\n/)[0] ?? "";
    expect(header).not.toContain("Costo promedio");
    expect(mListar).toHaveBeenCalledWith(false);
    // El evento queda registrado con las columnas efectivamente exportadas.
    const columnas = mAuditar.mock.calls[0]?.[0]?.columnas ?? [];
    expect(columnas).not.toContain("Costo promedio");
  });

  it("con la clave: la columna existe y lleva el valor ALMACENADO", async () => {
    mVerCosto.mockResolvedValue(true);

    const res = await exportarInventarioWorklist({ params: {}, formato: "csv" });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const csv = decodeCsv(res.base64);
    const lineas = csv.trim().split(/\r?\n/);
    expect(lineas[0]).toContain("Costo promedio");
    expect(mListar).toHaveBeenCalledWith(true);
    const fila1001 = lineas.find((l) => l.startsWith("1001,")) ?? "";
    expect(fila1001.endsWith(",123.45")).toBe(true);
  });
});

describe("exportarInventarioWorklist · presets server-side + auditoría", () => {
  beforeEach(() => {
    mVerCosto.mockResolvedValue(false);
  });

  it("aplica ?vista=negativos server-side (mismas filas que la page) y audita ANTES de entregar", async () => {
    const res = await exportarInventarioWorklist({
      params: { vista: "negativos" },
      formato: "csv",
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const csv = decodeCsv(res.base64);
    expect(csv).toContain("1002");
    expect(csv).not.toContain("1001,");
    expect(mAuditar).toHaveBeenCalledOnce();
    expect(mAuditar).toHaveBeenCalledWith(
      expect.objectContaining({
        recurso: "inventario",
        formato: "csv",
        nFilas: 1,
        filtros: { vista: "negativos", dias: 90, agrupar: false },
      }),
    );
    expect(res.filename).toMatch(/^inventario-stock-general-\d+\.csv$/);
  });

  it("?agrupar=deposito reordena el archivo (contiguo por depósito)", async () => {
    const res = await exportarInventarioWorklist({
      params: { agrupar: "deposito" },
      formato: "csv",
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const lineas = decodeCsv(res.base64).trim().split(/\r?\n/);
    // Primera fila de datos = depósito alfabéticamente primero ("Alfa Fiscal").
    expect(lineas[1]).toContain("Alfa Fiscal");
    expect(mAuditar).toHaveBeenCalledWith(
      expect.objectContaining({ nFilas: 3, filtros: expect.objectContaining({ agrupar: true }) }),
    );
  });

  it("si la meta-auditoría falla, propaga (no entrega archivo sin registrar)", async () => {
    mAuditar.mockRejectedValueOnce(new Error("audit down"));

    await expect(exportarInventarioWorklist({ params: {}, formato: "csv" })).rejects.toThrow(
      "audit down",
    );
  });
});
