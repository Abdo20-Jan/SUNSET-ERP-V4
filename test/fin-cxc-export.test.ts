import { beforeEach, describe, expect, it, vi } from "vitest";

// FIN-01 / PR-026 — exportación auditada de la worklist de gestión de CxC.
// Espejo de test/cuentas-a-cobrar-export.test.ts (025c). Verifica: (i) gate
// VER_SALDO re-chequeado server-side (sin permiso NIEGA y ni siquiera lee la
// proyección); (ii) re-lectura server-side con el MISMO preset `?vista=` de
// la page (per-documento); (iii) native-first por fila en el archivo
// (lección #262/#263); (iv) el evento EXPORTACION se registra ANTES de
// entregar el archivo (si falla, propaga).

vi.mock("@/lib/auth-guard", () => ({ requireSessionUser: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permisos-masking", () => ({ puedeVerSaldo: vi.fn() }));
vi.mock("@/lib/services/fin-cxc-worklist", () => ({
  listarFinCxcWorklist: vi.fn(),
}));
vi.mock("@/lib/services/auditar-exportacion", () => ({ auditarExportacion: vi.fn() }));
vi.mock("@/lib/services/cotizacion", () => ({ getCotizacionParaFecha: vi.fn() }));

import { exportarFinCxc } from "@/lib/actions/fin-cxc-export";
import { auth } from "@/lib/auth";
import { requireSessionUser } from "@/lib/auth-guard";
import { puedeVerSaldo } from "@/lib/permisos-masking";
import { auditarExportacion } from "@/lib/services/auditar-exportacion";
import { listarFinCxcWorklist } from "@/lib/services/fin-cxc-worklist";
import { getCotizacionParaFecha } from "@/lib/services/cotizacion";

const mRequire = vi.mocked(requireSessionUser);
const mAuth = vi.mocked(auth);
const mVerSaldo = vi.mocked(puedeVerSaldo);
const mListar = vi.mocked(listarFinCxcWorklist);
const mAuditar = vi.mocked(auditarExportacion);
const mCotizacion = vi.mocked(getCotizacionParaFecha);

// Cliente multimoneda (mismo fixture semántico que 025c): v1 = 100 USD
// nativos (emitida a TC 1300), v2 = 50000 ARS. TC de cierre = 1400.
const CLIENTE_VENCIDO = {
  clienteId: "c1",
  clienteNombre: "ACME SA",
  cuit: "30-11111111-1",
  cuentaContableId: 42,
  cuentaCodigo: "1.1.3.02",
  saldoTotal: "180000.00",
  vencido: "180000.00",
  proximo: "0.00",
  alDia: "0.00",
  ventas: [
    {
      id: "v1",
      numero: "FA-1",
      fecha: "2026-05-01T00:00:00.000Z",
      fechaVencimiento: "2026-06-01T00:00:00.000Z",
      diasParaVencer: -31,
      bucket: "vencida" as const,
      monto: "130000.00",
      montoNativo: "100.00",
      moneda: "USD",
    },
    {
      id: "v2",
      numero: "FA-2",
      fecha: "2026-05-10T00:00:00.000Z",
      fechaVencimiento: "2026-06-20T00:00:00.000Z",
      diasParaVencer: -12,
      bucket: "vencida" as const,
      monto: "50000.00",
      montoNativo: "50000.00",
      moneda: "ARS",
    },
  ],
};

const CLIENTE_AL_DIA = {
  clienteId: "c2",
  clienteNombre: "BETA SRL",
  cuit: null,
  cuentaContableId: 43,
  cuentaCodigo: "1.1.3.03",
  saldoTotal: "75000.00",
  vencido: "0.00",
  proximo: "0.00",
  alDia: "75000.00",
  ventas: [
    {
      id: "v3",
      numero: "FA-3",
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

const CLIENTES = [CLIENTE_VENCIDO, CLIENTE_AL_DIA];

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
  mListar.mockResolvedValue(CLIENTES as never);
});

describe("exportarFinCxc · gate VER_SALDO server-side", () => {
  it("sin VER_SALDO: niega, NO lee la proyección y NO audita", async () => {
    mVerSaldo.mockResolvedValue(false);

    const res = await exportarFinCxc({ params: {}, formato: "csv" });

    expect(res.ok).toBe(false);
    expect(mListar).not.toHaveBeenCalled();
    expect(mAuditar).not.toHaveBeenCalled();
  });
});

describe("exportarFinCxc · re-lectura server-side + auditoría", () => {
  beforeEach(() => {
    mVerSaldo.mockResolvedValue(true);
  });

  it("exporta UNA fila por venta pendiente, native-first en la moneda de la URL", async () => {
    const res = await exportarFinCxc({ params: { moneda: "USD" }, formato: "csv" });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const csv = decodeCsv(res.base64);
    const lineas = csv.trim().split(/\r?\n/);
    // Header + 3 documentos (nunca 2 filas agregadas por cliente).
    expect(lineas).toHaveLength(4);

    // v2 (50000 ARS nativos): Saldo (USD) = 50000/1400 = 35.71 — por fila,
    // jamás re-derivado del agregado ARS del cliente.
    const filaV2 = lineas.find((l) => l.includes("FA-2"));
    expect(filaV2).toBeDefined();
    const colsV2 = (filaV2 as string).split(",");
    expect(colsV2[8]).toBe("ARS"); // moneda nativa
    expect(colsV2[9]).toBe("50000.00"); // saldo nativo
    expect(colsV2[10]).toBe("35.71"); // saldo presentación USD

    // v1 (100 USD nativos): pasa 1:1 a la presentación USD.
    const colsV1 = (lineas.find((l) => l.includes("FA-1")) as string).split(",");
    expect(colsV1[9]).toBe("100.00");
    expect(colsV1[10]).toBe("100.00");
    expect(colsV1[6]).toBe("31"); // días de atraso
    expect(res.filename).toMatch(/^finanzas-cuentas-a-cobrar-\d+\.csv$/);
  });

  it("aplica el preset ?vista=vencidas server-side (mismas filas que la page)", async () => {
    const res = await exportarFinCxc({
      params: { vista: "vencidas", moneda: "USD" },
      formato: "csv",
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const csv = decodeCsv(res.base64);
    expect(csv).toContain("FA-1");
    expect(csv).toContain("FA-2");
    expect(csv).not.toContain("FA-3");
    expect(mAuditar).toHaveBeenCalledOnce();
    expect(mAuditar).toHaveBeenCalledWith(
      expect.objectContaining({
        recurso: "finanzas-cuentas-a-cobrar",
        formato: "csv",
        nFilas: 2,
        filtros: expect.objectContaining({ vista: "vencidas", moneda: "USD" }),
      }),
    );
  });

  it("si la meta-auditoría falla, propaga (no entrega archivo sin registrar)", async () => {
    mAuditar.mockRejectedValueOnce(new Error("audit down"));

    await expect(exportarFinCxc({ params: {}, formato: "csv" })).rejects.toThrow("audit down");
  });

  it("sin ?moneda usa la preferencia de la sesión (ARS)", async () => {
    mAuth.mockResolvedValue({ user: { monedaPreferida: "ARS" } } as never);

    const res = await exportarFinCxc({ params: {}, formato: "csv" });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const csv = decodeCsv(res.base64);
    expect(csv).toContain("Saldo (ARS)");
    // v1: 100 USD nativos × TC 1400 = 140000 en presentación ARS.
    const colsV1 = (csv.split(/\r?\n/).find((l) => l.includes("FA-1")) as string).split(",");
    expect(colsV1[10]).toBe("140000.00");
  });
});
