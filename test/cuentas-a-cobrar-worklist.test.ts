import { afterEach, describe, expect, it, vi } from "vitest";

// TES-03 / PR-025c — worklist de cuentas a cobrar.
//
// 1) Proyección read-only: gate `VER_SALDO` como **no-call** server-side
//    (espejo de test/saldos-proveedores-worklist.test.ts): sin permiso los
//    motores NO se invocan y el resultado es `null`; con permiso, pass-through
//    IDÉNTICO (por referencia) de los servicios existentes — nunca recomputa.
// 2) Paridad de agregación nativa: `fmtBucketPres` (transcripción client-safe
//    usada por las celdas del grid) debe producir EXACTAMENTE el mismo string
//    que la vía server de la page (`sumarBucketsNativos` + `convertirBucket` +
//    `fmtMoney`) para el mismo fixture multimoneda — la lección #262/#263
//    (sumar por moneda NATIVA antes de convertir; jamás ÷tc sobre el agregado)
//    queda trabada por test: los totales del grid == outputs de los helpers.

const h = vi.hoisted(() => ({
  getCuentasACobrar: vi.fn(),
  getSaldosPorClienteConAging: vi.fn(),
}));

vi.mock("@/lib/services/cuentas-a-cobrar", () => ({
  getCuentasACobrar: h.getCuentasACobrar,
  getSaldosPorClienteConAging: h.getSaldosPorClienteConAging,
}));

import { convertirBucket, sumarBucketsNativos } from "@/lib/aging-presentacion";
import { fmtMoney } from "@/lib/format";
import { listarCuentasACobrarWorklist } from "@/lib/services/cuentas-a-cobrar-worklist";
import {
  cobrarHref,
  fmtBucketPres,
  mayorAtrasoDias,
  type VentaPendienteRow,
} from "@/app/(dashboard)/tesoreria/cuentas-a-cobrar/cuentas-a-cobrar-presentacion";

afterEach(() => vi.clearAllMocks());

describe("listarCuentasACobrarWorklist · gate VER_SALDO (no-call)", () => {
  it("sin VER_SALDO: NO llama a los motores y devuelve null", async () => {
    const result = await listarCuentasACobrarWorklist(false);

    expect(h.getCuentasACobrar).not.toHaveBeenCalled();
    expect(h.getSaldosPorClienteConAging).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it("con VER_SALDO: llama a cada motor una vez y devuelve lo LEÍDO (pass-through)", async () => {
    const cuentasFixture = { clientes: [], valoresACobrar: [], totalGeneral: "0.00" };
    const clientesFixture = [
      {
        clienteId: "c1",
        clienteNombre: "ACME",
        cuit: null,
        cuentaContableId: 7,
        cuentaCodigo: "1.1.3.01",
        saldoTotal: "1500.00",
        vencido: "1500.00",
        proximo: "0.00",
        alDia: "0.00",
        ventas: [],
      },
    ];
    h.getCuentasACobrar.mockResolvedValue(cuentasFixture);
    h.getSaldosPorClienteConAging.mockResolvedValue(clientesFixture);

    const result = await listarCuentasACobrarWorklist(true);

    expect(h.getCuentasACobrar).toHaveBeenCalledOnce();
    expect(h.getSaldosPorClienteConAging).toHaveBeenCalledOnce();
    // Pass-through por referencia: la proyección no transforma ni recomputa.
    expect(result?.cuentas).toBe(cuentasFixture);
    expect(result?.clientes).toBe(clientesFixture);
  });
});

// Fixture multimoneda: ventas ARS y USD en los tres buckets + una sin_fecha
// (que colapsa en al_dia por paridad con el servicio legado). TC distinto del
// de emisión para detectar cualquier ÷tc ciego sobre el agregado.
const VENTAS: VentaPendienteRow[] = [
  {
    id: "v1",
    numero: "FA-1",
    fecha: "2026-05-01T00:00:00.000Z",
    fechaVencimiento: "2026-06-01T00:00:00.000Z",
    diasParaVencer: -31,
    bucket: "vencida",
    monto: "130000.00",
    montoNativo: "100.00", // USD
    moneda: "USD",
  },
  {
    id: "v2",
    numero: "FA-2",
    fecha: "2026-05-10T00:00:00.000Z",
    fechaVencimiento: "2026-06-20T00:00:00.000Z",
    diasParaVencer: -12,
    bucket: "vencida",
    monto: "50000.00",
    montoNativo: "50000.00", // ARS
    moneda: "ARS",
  },
  {
    id: "v3",
    numero: "FA-3",
    fecha: "2026-06-25T00:00:00.000Z",
    fechaVencimiento: "2026-07-05T00:00:00.000Z",
    diasParaVencer: 3,
    bucket: "proxima",
    monto: "260000.00",
    montoNativo: "200.00", // USD
    moneda: "USD",
  },
  {
    id: "v4",
    numero: "FA-4",
    fecha: "2026-06-28T00:00:00.000Z",
    fechaVencimiento: "2026-08-15T00:00:00.000Z",
    diasParaVencer: 44,
    bucket: "al_dia",
    monto: "75000.00",
    montoNativo: "75000.00", // ARS
    moneda: "ARS",
  },
  {
    id: "v5",
    numero: "FA-5",
    fecha: "2026-06-29T00:00:00.000Z",
    fechaVencimiento: null,
    diasParaVencer: null,
    bucket: "sin_fecha",
    monto: "13000.00",
    montoNativo: "10.00", // USD
    moneda: "USD",
  },
];

const TC = "1400"; // TC de cierre ≠ TC de emisión (100 USD ≙ 130000 ARS ⇒ 1300)

describe("fmtBucketPres · paridad con sumarBucketsNativos + convertirBucket", () => {
  const items = VENTAS.map((v) => ({
    bucket: v.bucket,
    moneda: v.moneda,
    montoNativo: v.montoNativo,
  }));

  for (const moneda of ["ARS", "USD"] as const) {
    it(`presentación ${moneda}: cada bucket del grid == helper server de la page`, () => {
      const buckets = sumarBucketsNativos(items);
      for (const bucket of ["vencida", "proxima", "al_dia"] as const) {
        const grid = fmtBucketPres(VENTAS, bucket, moneda, TC);
        const page = fmtMoney(convertirBucket(buckets[bucket], moneda, TC));
        expect(grid).toBe(page);
      }
    });
  }

  it("sin_fecha colapsa en al_dia por ambas vías (nunca desaparece del total)", () => {
    const buckets = sumarBucketsNativos(items);
    // La perna USD de al_dia debe incluir los 10 USD de la venta sin fecha.
    expect(buckets.al_dia.usd).toBe("10.00");
    expect(fmtBucketPres(VENTAS, "al_dia", "USD", TC)).toBe(
      fmtMoney(convertirBucket(buckets.al_dia, "USD", TC)),
    );
  });

  it("suma por moneda NATIVA antes de convertir (no ÷tc ciego del agregado ARS)", () => {
    // Vencido en USD = 100 (USD nativo) + 50000/1400 (ARS convertido) = 135,71.
    // Un ÷tc ciego del agregado ARS (180000/1400 = 128,57) sería regresión.
    expect(fmtBucketPres(VENTAS, "vencida", "USD", TC)).toBe(fmtMoney("135.71"));
  });

  it("redondea POR PERNA, no por item (granularidad idéntica al KPI/legado)", () => {
    // Dos ventas ARS de 10000 en el mismo bucket, presentación USD @1400:
    // por perna: 20000/1400 = 14,29 (la vía del KPI/página legada);
    // por item: 7,14 + 7,14 = 14,28 — deriva de 1 centavo (regresión).
    const dosArs = [
      { bucket: "vencida" as const, moneda: "ARS", montoNativo: "10000.00" },
      { bucket: "vencida" as const, moneda: "ARS", montoNativo: "10000.00" },
    ];
    const esperado = fmtMoney(
      convertirBucket(sumarBucketsNativos(dosArs.map((v) => ({ ...v }))).vencida, "USD", TC),
    );
    expect(esperado).toBe(fmtMoney("14.29"));
    expect(fmtBucketPres(dosArs, "vencida", "USD", TC)).toBe(esperado);
  });
});

describe("mayorAtrasoDias · derivado de diasParaVencer (sin re-derivar aging)", () => {
  it("devuelve el atraso máximo en días positivos", () => {
    expect(mayorAtrasoDias(VENTAS)).toBe(31);
  });

  it("null cuando no hay vencidas", () => {
    expect(mayorAtrasoDias(VENTAS.filter((v) => v.bucket !== "vencida"))).toBeNull();
  });
});

describe("cobrarHref · URL idéntica al CTA legado", () => {
  it("con cuenta contable: tipo/monto/descripcion/cuentaContableId", () => {
    const href = cobrarHref({
      saldoTotal: "1500.00",
      clienteNombre: "ACME SA",
      cuentaContableId: 42,
    });
    const url = new URL(href, "http://localhost");
    expect(url.pathname).toBe("/tesoreria/movimientos/nuevo");
    expect(url.searchParams.get("tipo")).toBe("COBRO");
    expect(url.searchParams.get("monto")).toBe("1500.00");
    expect(url.searchParams.get("descripcion")).toBe("Cobro de ACME SA");
    expect(url.searchParams.get("cuentaContableId")).toBe("42");
  });

  it("sin cuenta contable: omite cuentaContableId (paridad con ClienteCard)", () => {
    const href = cobrarHref({
      saldoTotal: "10.00",
      clienteNombre: "SIN CUENTA",
      cuentaContableId: null,
    });
    expect(href).not.toContain("cuentaContableId");
  });
});
