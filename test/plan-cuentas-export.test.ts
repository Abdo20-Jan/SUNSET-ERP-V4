import { beforeEach, describe, expect, it, vi } from "vitest";

// CONT-02 / PR-028 — exportación auditada del Plan de Cuentas. Verifica:
// (i) gate de sesión (sin sesión propaga, sin leer la proyección); (ii) el
// archivo re-lee la MISMA proyección de la page (pass-through, 1 llamada —
// el saldo jamás se re-deriva acá); (iii) columnas canónicas; (iv) evento
// EXPORTACION registrado ANTES de entregar (falla → propaga).

vi.mock("@/lib/auth-guard", () => ({ requireSessionUser: vi.fn() }));
vi.mock("@/lib/services/plan-cuentas-arbol", () => ({ getPlanDeCuentasConSaldo: vi.fn() }));
vi.mock("@/lib/services/auditar-exportacion", () => ({ auditarExportacion: vi.fn() }));

import { exportarPlanDeCuentas } from "@/lib/actions/plan-cuentas-export";
import { requireSessionUser } from "@/lib/auth-guard";
import { auditarExportacion } from "@/lib/services/auditar-exportacion";
import { getPlanDeCuentasConSaldo } from "@/lib/services/plan-cuentas-arbol";

const mRequire = vi.mocked(requireSessionUser);
const mProyeccion = vi.mocked(getPlanDeCuentasConSaldo);
const mAuditar = vi.mocked(auditarExportacion);

const FLAT = [
  {
    id: 1,
    codigo: "1",
    nombre: "ACTIVO",
    categoria: "ACTIVO",
    tipo: "SINTETICA",
    nivel: 1,
    padreCodigo: null,
    activa: true,
    naturaleza: "DEUDOR",
    saldo: "130.00",
  },
  {
    id: 2,
    codigo: "1.1.01",
    nombre: "Caja",
    categoria: "ACTIVO",
    tipo: "ANALITICA",
    nivel: 3,
    padreCodigo: "1",
    activa: false,
    naturaleza: "DEUDOR",
    saldo: "130.00",
  },
];

const HEADERS = [
  "Código",
  "Nombre",
  "Tipo",
  "Naturaleza",
  "Categoría",
  "Nivel",
  "Padre",
  "Estado",
  "Saldo",
];

function decodeCsv(base64: string): string {
  return Buffer.from(base64, "base64").toString("utf8");
}

beforeEach(() => {
  vi.clearAllMocks();
  mRequire.mockResolvedValue("user-1");
  mProyeccion.mockResolvedValue({
    roots: [],
    flat: FLAT,
    fechaCorte: "2026-07-03T00:00:00.000Z",
  } as never);
});

describe("exportarPlanDeCuentas", () => {
  it("sin sesión: propaga y NO lee la proyección ni audita", async () => {
    mRequire.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));

    await expect(exportarPlanDeCuentas({ formato: "csv" })).rejects.toThrow();
    expect(mProyeccion).not.toHaveBeenCalled();
    expect(mAuditar).not.toHaveBeenCalled();
  });

  it("re-lee la MISMA proyección (1 llamada) y exporta las columnas canónicas", async () => {
    const res = await exportarPlanDeCuentas({ formato: "csv" });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(mProyeccion).toHaveBeenCalledOnce();

    const csv = decodeCsv(res.base64);
    const lineas = csv.trim().split(/\r?\n/);
    expect(lineas).toHaveLength(3); // header + 2 cuentas
    expect(lineas[0].split(",")).toEqual(HEADERS);

    const filaCaja = (lineas.find((l) => l.includes("Caja")) as string).split(",");
    expect(filaCaja[0]).toBe("1.1.01");
    expect(filaCaja[4]).toBe("ANALITICA");
    expect(filaCaja[6]).toBe("1"); // padre
    expect(filaCaja[7]).toBe("INACTIVA");
    expect(filaCaja[8]).toBe("130.00");
    expect(res.filename).toMatch(/^contabilidad-plan-de-cuentas-\d+\.csv$/);
  });

  it("registra el evento EXPORTACION con recurso/fechaCorte/nFilas", async () => {
    await exportarPlanDeCuentas({ formato: "csv" });

    expect(mAuditar).toHaveBeenCalledOnce();
    expect(mAuditar).toHaveBeenCalledWith(
      expect.objectContaining({
        recurso: "contabilidad-plan-de-cuentas",
        formato: "csv",
        nFilas: 2,
        columnas: HEADERS,
        filtros: { fechaCorte: "2026-07-03T00:00:00.000Z" },
      }),
    );
  });

  it("si la meta-auditoría falla, propaga (no entrega archivo sin registrar)", async () => {
    mAuditar.mockRejectedValueOnce(new Error("audit down"));

    await expect(exportarPlanDeCuentas({ formato: "csv" })).rejects.toThrow("audit down");
  });
});
