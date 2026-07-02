import { beforeEach, describe, expect, it, vi } from "vitest";

// TES-03 / PR-025c — exportación auditada de la worklist de cuentas a cobrar.
// Verifica: (i) gate VER_SALDO re-chequeado server-side (sin permiso NIEGA y
// ni siquiera lee la proyección); (ii) re-lectura server-side con el MISMO
// preset `?filtro=vencidas` de la page; (iii) conversión native-first en el
// archivo (mismos helpers de la page — lección #262/#263); (iv) el evento
// EXPORTACION se registra ANTES de entregar el archivo (si falla, propaga).

vi.mock("@/lib/auth-guard", () => ({ requireSessionUser: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permisos-masking", () => ({ puedeVerSaldo: vi.fn() }));
vi.mock("@/lib/services/cuentas-a-cobrar-worklist", () => ({
  listarCuentasACobrarWorklist: vi.fn(),
}));
vi.mock("@/lib/services/auditar-exportacion", () => ({ auditarExportacion: vi.fn() }));
vi.mock("@/lib/services/cotizacion", () => ({ getCotizacionParaFecha: vi.fn() }));

import { exportarCuentasACobrar } from "@/lib/actions/cuentas-a-cobrar-export";
import { auth } from "@/lib/auth";
import { requireSessionUser } from "@/lib/auth-guard";
import { puedeVerSaldo } from "@/lib/permisos-masking";
import { auditarExportacion } from "@/lib/services/auditar-exportacion";
import { listarCuentasACobrarWorklist } from "@/lib/services/cuentas-a-cobrar-worklist";
import { getCotizacionParaFecha } from "@/lib/services/cotizacion";

const mRequire = vi.mocked(requireSessionUser);
const mAuth = vi.mocked(auth);
const mVerSaldo = vi.mocked(puedeVerSaldo);
const mListar = vi.mocked(listarCuentasACobrarWorklist);
const mAuditar = vi.mocked(auditarExportacion);
const mCotizacion = vi.mocked(getCotizacionParaFecha);

// Cliente multimoneda: vencido = 100 USD nativos + 50000 ARS. Con TC 1400,
// vencido en USD = 100 + 50000/1400 = 135,71 (un ÷tc ciego daría 128,57).
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

const DATA = {
  clientes: [CLIENTE_VENCIDO, CLIENTE_AL_DIA],
  cuentas: { clientes: [], valoresACobrar: [], totalGeneral: "0.00" },
};

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
  mListar.mockResolvedValue(DATA as never);
});

describe("exportarCuentasACobrar · gate VER_SALDO server-side", () => {
  it("sin VER_SALDO: niega, NO lee la proyección y NO audita", async () => {
    mVerSaldo.mockResolvedValue(false);

    const res = await exportarCuentasACobrar({ params: {}, formato: "csv" });

    expect(res.ok).toBe(false);
    expect(mListar).not.toHaveBeenCalled();
    expect(mAuditar).not.toHaveBeenCalled();
  });
});

describe("exportarCuentasACobrar · re-lectura server-side + auditoría", () => {
  beforeEach(() => {
    mVerSaldo.mockResolvedValue(true);
  });

  it("exporta la vista completa en la moneda de la URL (native-first)", async () => {
    const res = await exportarCuentasACobrar({ params: { moneda: "USD" }, formato: "csv" });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const csv = decodeCsv(res.base64);
    expect(csv).toContain("BETA SRL");
    const acme = csv.split(/\r?\n/).find((l) => l.includes("ACME SA"));
    expect(acme).toBeDefined();
    const cols = (acme as string).split(",");
    // Vencido (USD) es NATIVE-FIRST: 100 USD + 50000/1400 ARS = 135.71 —
    // jamás el ÷tc ciego del agregado ARS (180000/1400 = 128.57).
    expect(cols[3]).toBe("135.71");
    // Saldo contable (USD) es OTRA semántica (idéntica a la page): valuación
    // ARS del ledger convertida al TC de cierre (la cuenta no es USD-nata —
    // sin saldoTotalUsd, pickSaldoNativo cae en la perna ARS): 180000/1400.
    expect(cols[8]).toBe("128.57");
    expect(res.filename).toMatch(/^cuentas-a-cobrar-\d+\.csv$/);
  });

  it("aplica el preset ?filtro=vencidas server-side (mismas filas que la page)", async () => {
    const res = await exportarCuentasACobrar({
      params: { filtro: "vencidas", moneda: "USD" },
      formato: "csv",
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const csv = decodeCsv(res.base64);
    expect(csv).toContain("ACME SA");
    expect(csv).not.toContain("BETA SRL");
    expect(mAuditar).toHaveBeenCalledOnce();
    expect(mAuditar).toHaveBeenCalledWith(
      expect.objectContaining({
        recurso: "cuentas-a-cobrar",
        formato: "csv",
        nFilas: 1,
        filtros: expect.objectContaining({ filtro: "vencidas", moneda: "USD" }),
      }),
    );
  });

  it("si la meta-auditoría falla, propaga (no entrega archivo sin registrar)", async () => {
    mAuditar.mockRejectedValueOnce(new Error("audit down"));

    await expect(exportarCuentasACobrar({ params: {}, formato: "csv" })).rejects.toThrow(
      "audit down",
    );
  });

  it("sin ?moneda usa la preferencia de la sesión (ARS)", async () => {
    mAuth.mockResolvedValue({ user: { monedaPreferida: "ARS" } } as never);

    const res = await exportarCuentasACobrar({ params: {}, formato: "csv" });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const csv = decodeCsv(res.base64);
    expect(csv).toContain("Vencido (ARS)");
    // Vencido ARS = 100 USD × 1400 + 50000 = 190000.
    expect(csv).toContain("190000.00");
  });
});
