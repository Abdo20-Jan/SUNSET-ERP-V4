import { beforeEach, describe, expect, it, vi } from "vitest";

// FIN-02 / PR-026 — exportación auditada de la worklist de gestión de CxP.
// Espejo de test/cuentas-a-cobrar-export.test.ts (025c). Verifica: (i) gate
// VER_SALDO re-chequeado server-side (sin permiso NIEGA y ni siquiera lee la
// proyección REUSADA de 025b); (ii) re-lectura server-side con el MISMO
// preset `?vista=` de la page (per-documento); (iii) native-first por fila
// (lección #262/#263); (iv) el evento EXPORTACION se registra ANTES de
// entregar el archivo (si falla, propaga).

vi.mock("@/lib/auth-guard", () => ({ requireSessionUser: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permisos-masking", () => ({ puedeVerSaldo: vi.fn() }));
vi.mock("@/lib/services/saldos-proveedores-worklist", () => ({
  listarSaldosProveedoresWorklist: vi.fn(),
}));
vi.mock("@/lib/services/auditar-exportacion", () => ({ auditarExportacion: vi.fn() }));
vi.mock("@/lib/services/cotizacion", () => ({ getCotizacionParaFecha: vi.fn() }));

import { exportarFinCxp } from "@/lib/actions/fin-cxp-export";
import { auth } from "@/lib/auth";
import { requireSessionUser } from "@/lib/auth-guard";
import { puedeVerSaldo } from "@/lib/permisos-masking";
import { auditarExportacion } from "@/lib/services/auditar-exportacion";
import { listarSaldosProveedoresWorklist } from "@/lib/services/saldos-proveedores-worklist";
import { getCotizacionParaFecha } from "@/lib/services/cotizacion";

const mRequire = vi.mocked(requireSessionUser);
const mAuth = vi.mocked(auth);
const mVerSaldo = vi.mocked(puedeVerSaldo);
const mListar = vi.mocked(listarSaldosProveedoresWorklist);
const mAuditar = vi.mocked(auditarExportacion);
const mCotizacion = vi.mocked(getCotizacionParaFecha);

// Proveedor multimoneda: f1 = 100 USD nativos (compra, emitida a TC 1300),
// f2 = 50000 ARS (costo de embarque). TC de cierre = 1400.
const PROVEEDOR_VENCIDO = {
  proveedorId: "p1",
  proveedorNombre: "GLOBAL TIRE CO",
  cuit: null,
  pais: "CN",
  cuentaContableId: 7,
  saldoTotal: "180000.00",
  saldoTotalUsd: "135.71",
  vencido: "130000.00",
  proximo: "50000.00",
  alDia: "0.00",
  facturas: [
    {
      origen: "compra" as const,
      id: "uuid-c1",
      numero: "FC-1",
      referencia: null,
      fecha: "2026-05-01T00:00:00.000Z",
      fechaVencimiento: "2026-06-01T00:00:00.000Z",
      diasParaVencer: -31,
      bucket: "vencida" as const,
      monto: "130000.00",
      montoNativo: "100.00",
      moneda: "USD",
    },
    {
      origen: "embarque" as const,
      id: "5",
      numero: "FC-2",
      referencia: "EMB-2026-01",
      fecha: "2026-05-10T00:00:00.000Z",
      fechaVencimiento: "2026-07-05T00:00:00.000Z",
      diasParaVencer: 3,
      bucket: "proxima" as const,
      monto: "50000.00",
      montoNativo: "50000.00",
      moneda: "ARS",
    },
  ],
};

const PROVEEDOR_AL_DIA = {
  proveedorId: "p2",
  proveedorNombre: "SERVICIOS SUR",
  cuit: "30-22222222-2",
  pais: "AR",
  cuentaContableId: 9,
  saldoTotal: "75000.00",
  vencido: "0.00",
  proximo: "0.00",
  alDia: "75000.00",
  facturas: [
    {
      origen: "gasto" as const,
      id: "uuid-g1",
      numero: "FC-3",
      referencia: null,
      fecha: "2026-06-28T00:00:00.000Z",
      fechaVencimiento: "2026-08-15T00:00:00.000Z",
      diasParaVencer: 44,
      bucket: "al_dia" as const,
      monto: "75000.00",
      montoNativo: "75000.00",
      moneda: "ARS",
    },
  ],
};

const PROVEEDORES = [PROVEEDOR_VENCIDO, PROVEEDOR_AL_DIA];

function decodeCsv(base64: string): string {
  return Buffer.from(base64, "base64").toString("utf8");
}

beforeEach(() => {
  vi.clearAllMocks();
  mRequire.mockResolvedValue("user-1");
  mAuth.mockResolvedValue(null as never);
  mCotizacion.mockResolvedValue({
    valor: { toString: () => "1400" },
    fecha: new Date(0),
    fuente: "TEST",
  } as never);
  mListar.mockResolvedValue(PROVEEDORES as never);
});

describe("exportarFinCxp · gate VER_SALDO server-side", () => {
  it("sin VER_SALDO: niega, NO lee la proyección y NO audita", async () => {
    mVerSaldo.mockResolvedValue(false);

    const res = await exportarFinCxp({ params: {}, formato: "csv" });

    expect(res.ok).toBe(false);
    expect(mListar).not.toHaveBeenCalled();
    expect(mAuditar).not.toHaveBeenCalled();
  });
});

describe("exportarFinCxp · re-lectura server-side + auditoría", () => {
  beforeEach(() => {
    mVerSaldo.mockResolvedValue(true);
  });

  it("exporta UNA fila por documento pendiente, native-first en la moneda de la URL", async () => {
    const res = await exportarFinCxp({ params: { moneda: "USD" }, formato: "csv" });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const csv = decodeCsv(res.base64);
    const lineas = csv.trim().split(/\r?\n/);
    // Header + 3 documentos (nunca 2 filas agregadas por proveedor).
    expect(lineas).toHaveLength(4);

    // f2 (50000 ARS nativos): Saldo (USD) = 50000/1400 = 35.71 — por fila,
    // jamás re-derivado del agregado ARS del proveedor.
    const filaF2 = lineas.find((l) => l.includes("FC-2"));
    expect(filaF2).toBeDefined();
    const colsF2 = (filaF2 as string).split(",");
    expect(colsF2[4]).toBe("EMB-2026-01"); // referencia textual (sin embarqueId no hay link)
    expect(colsF2[9]).toBe("ARS"); // moneda nativa
    expect(colsF2[10]).toBe("50000.00"); // saldo nativo
    expect(colsF2[11]).toBe("35.71"); // saldo presentación USD

    // f1 (100 USD nativos): pasa 1:1 a la presentación USD.
    const colsF1 = (lineas.find((l) => l.includes("FC-1")) as string).split(",");
    expect(colsF1[10]).toBe("100.00");
    expect(colsF1[11]).toBe("100.00");
    expect(colsF1[7]).toBe("31"); // días de atraso
    expect(res.filename).toMatch(/^finanzas-cuentas-a-pagar-\d+\.csv$/);
  });

  it("aplica el preset ?vista=vencidas server-side (mismas filas que la page)", async () => {
    const res = await exportarFinCxp({
      params: { vista: "vencidas", moneda: "USD" },
      formato: "csv",
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const csv = decodeCsv(res.base64);
    expect(csv).toContain("FC-1");
    expect(csv).not.toContain("FC-2");
    expect(csv).not.toContain("FC-3");
    expect(mAuditar).toHaveBeenCalledOnce();
    expect(mAuditar).toHaveBeenCalledWith(
      expect.objectContaining({
        recurso: "finanzas-cuentas-a-pagar",
        formato: "csv",
        nFilas: 1,
        filtros: expect.objectContaining({ vista: "vencidas", moneda: "USD" }),
      }),
    );
  });

  it("si la meta-auditoría falla, propaga (no entrega archivo sin registrar)", async () => {
    mAuditar.mockRejectedValueOnce(new Error("audit down"));

    await expect(exportarFinCxp({ params: {}, formato: "csv" })).rejects.toThrow("audit down");
  });

  it("sin ?moneda usa la preferencia de la sesión (ARS)", async () => {
    mAuth.mockResolvedValue({ user: { monedaPreferida: "ARS" } } as never);

    const res = await exportarFinCxp({ params: {}, formato: "csv" });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const csv = decodeCsv(res.base64);
    expect(csv).toContain("Saldo (ARS)");
    // f1: 100 USD nativos × TC 1400 = 140000 en presentación ARS.
    const colsF1 = (csv.split(/\r?\n/).find((l) => l.includes("FC-1")) as string).split(",");
    expect(colsF1[11]).toBe("140000.00");
  });
});
