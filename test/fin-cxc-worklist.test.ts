import { afterEach, describe, expect, it, vi } from "vitest";

// FIN-01 / PR-026 — worklist de gestión de cuentas a cobrar (per-venta).
//
// 1) Proyección read-only: gate `VER_SALDO` como **no-call** server-side
//    (espejo de test/cuentas-a-cobrar-worklist.test.ts): sin permiso el motor
//    NO se invoca y el resultado es `null`; con permiso, pass-through
//    IDÉNTICO (por referencia) del servicio existente — nunca recomputa.
// 2) Flatten-parity: `flattenVentasPendientes` conserva EXACTAMENTE las
//    filas del aging anidado (cada venta una vez, ids únicos, padre por
//    referencia) y los totales por bucket del flatten == los del anidado vía
//    los MISMOS helpers server (`sumarBucketsNativos`+`convertirBucket`) —
//    la lección #262/#263 (sumar por moneda NATIVA antes de convertir) queda
//    trabada también para la vista aplanada.
// 3) Presets `?vista=` y `?agrupar=cliente`: presentación pura — mismas
//    filas, mismos totales (mismo multiset de ids).
// 4) CTA "Cobrar": el padre viaja INTACTO en la fila, así `cobrarHref(f.cliente)`
//    es byte-idéntico al CTA de 025c/legado.

const h = vi.hoisted(() => ({
  getSaldosPorClienteConAging: vi.fn(),
}));

vi.mock("@/lib/services/cuentas-a-cobrar", () => ({
  getSaldosPorClienteConAging: h.getSaldosPorClienteConAging,
}));

import { convertirBucket, sumarBucketsNativos } from "@/lib/aging-presentacion";
import { fmtMoney } from "@/lib/format";
import { listarFinCxcWorklist } from "@/lib/services/fin-cxc-worklist";
import { cobrarHref } from "@/app/(dashboard)/tesoreria/cuentas-a-cobrar/cuentas-a-cobrar-presentacion";
import {
  filtrarPorVista,
  flattenVentasPendientes,
  ordenarPorUrgencia,
  resolverVista,
  type SaldoClienteAgingRow,
  type VentaPendienteRow,
} from "@/app/(dashboard)/finanzas/cuentas-a-cobrar/fin-cxc-presentacion";

afterEach(() => vi.clearAllMocks());

describe("listarFinCxcWorklist · gate VER_SALDO (no-call)", () => {
  it("sin VER_SALDO: NO llama al motor y devuelve null", async () => {
    const result = await listarFinCxcWorklist(false);

    expect(h.getSaldosPorClienteConAging).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it("con VER_SALDO: llama al motor una vez y devuelve lo LEÍDO (pass-through)", async () => {
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
    h.getSaldosPorClienteConAging.mockResolvedValue(clientesFixture);

    const result = await listarFinCxcWorklist(true);

    expect(h.getSaldosPorClienteConAging).toHaveBeenCalledOnce();
    // Pass-through por referencia: la proyección no transforma ni recomputa.
    expect(result).toBe(clientesFixture);
  });
});

// Fixture multimoneda espejo del de 025c (TC de cierre 1400 ≠ TC de emisión
// 1300), repartido en DOS clientes para que el flatten sea significativo.
function venta(
  over: Partial<VentaPendienteRow> & Pick<VentaPendienteRow, "id" | "bucket">,
): VentaPendienteRow {
  return {
    numero: `FA-${over.id}`,
    fecha: "2026-05-01T00:00:00.000Z",
    fechaVencimiento: "2026-06-01T00:00:00.000Z",
    diasParaVencer: -31,
    monto: "0.00",
    montoNativo: "0.00",
    moneda: "ARS",
    ...over,
  };
}

const CLIENTE_A: SaldoClienteAgingRow = {
  clienteId: "cA",
  clienteNombre: "ACME SA",
  cuit: "30-11111111-1",
  cuentaContableId: 42,
  cuentaCodigo: "1.1.3.02",
  saldoTotal: "273000.00",
  saldoTotalUsd: "310.00",
  vencido: "130000.00",
  proximo: "260000.00",
  alDia: "13000.00",
  ventas: [
    venta({
      id: "v1",
      bucket: "vencida",
      diasParaVencer: -31,
      monto: "130000.00",
      montoNativo: "100.00",
      moneda: "USD",
    }),
    venta({
      id: "v3",
      bucket: "proxima",
      diasParaVencer: 3,
      fechaVencimiento: "2026-07-05T00:00:00.000Z",
      monto: "260000.00",
      montoNativo: "200.00",
      moneda: "USD",
    }),
    venta({
      id: "v5",
      bucket: "sin_fecha",
      diasParaVencer: null,
      fechaVencimiento: null,
      monto: "13000.00",
      montoNativo: "10.00",
      moneda: "USD",
    }),
  ],
};

const CLIENTE_B: SaldoClienteAgingRow = {
  clienteId: "cB",
  clienteNombre: "BETA SRL",
  cuit: null,
  cuentaContableId: 43,
  cuentaCodigo: "1.1.3.03",
  saldoTotal: "125000.00",
  vencido: "50000.00",
  proximo: "0.00",
  alDia: "75000.00",
  ventas: [
    venta({
      id: "v2",
      bucket: "vencida",
      diasParaVencer: -12,
      monto: "50000.00",
      montoNativo: "50000.00",
      moneda: "ARS",
    }),
    venta({
      id: "v4",
      bucket: "al_dia",
      diasParaVencer: 44,
      fechaVencimiento: "2026-08-15T00:00:00.000Z",
      monto: "75000.00",
      montoNativo: "75000.00",
      moneda: "ARS",
    }),
  ],
};

const CLIENTES = [CLIENTE_A, CLIENTE_B];
const TC = "1400";

describe("flattenVentasPendientes · conservación exacta de filas", () => {
  it("una fila por venta, ids únicos, sin duplicación ni pérdida", () => {
    const flat = flattenVentasPendientes(CLIENTES);

    expect(flat).toHaveLength(CLIENTES.reduce((n, c) => n + c.ventas.length, 0));
    expect(new Set(flat.map((f) => f.id)).size).toBe(flat.length);
    expect(flat.map((f) => f.id).sort()).toEqual(["v1", "v2", "v3", "v4", "v5"]);
  });

  it("el padre viaja INTACTO (por referencia) → cobrarHref byte-idéntico a 025c", () => {
    const flat = flattenVentasPendientes(CLIENTES);
    const fila = flat.find((f) => f.id === "v2");

    expect(fila?.cliente).toBe(CLIENTE_B);
    expect(fila?.clienteNombre).toBe("BETA SRL");
    // La URL del CTA es EXACTAMENTE la que 025c/legado generan para el mismo
    // cliente (mismo objeto → misma función → mismo string).
    expect(cobrarHref(fila!.cliente)).toBe(cobrarHref(CLIENTE_B));
    const url = new URL(cobrarHref(fila!.cliente), "http://localhost");
    expect(url.pathname).toBe("/tesoreria/movimientos/nuevo");
    expect(url.searchParams.get("tipo")).toBe("COBRO");
    expect(url.searchParams.get("monto")).toBe("125000.00");
    expect(url.searchParams.get("descripcion")).toBe("Cobro de BETA SRL");
    expect(url.searchParams.get("cuentaContableId")).toBe("43");
  });

  it("orden natural = contiguo por cliente (preset ?agrupar=cliente)", () => {
    const flat = flattenVentasPendientes(CLIENTES);
    expect(flat.map((f) => f.cliente.clienteId)).toEqual(["cA", "cA", "cA", "cB", "cB"]);
  });
});

describe("flatten-parity · totales del flatten == helpers server del anidado", () => {
  const toItem = (v: Pick<VentaPendienteRow, "bucket" | "moneda" | "montoNativo">) => ({
    bucket: v.bucket,
    moneda: v.moneda,
    montoNativo: v.montoNativo,
  });

  it("cada bucket × moneda: KPI del flatten == KPI del anidado (misma vía server)", () => {
    const flat = flattenVentasPendientes(CLIENTES);
    const bucketsFlat = sumarBucketsNativos(flat.map(toItem));
    const bucketsAnidado = sumarBucketsNativos(CLIENTES.flatMap((c) => c.ventas.map(toItem)));

    expect(bucketsFlat).toEqual(bucketsAnidado);
    for (const moneda of ["ARS", "USD"] as const) {
      for (const bucket of ["vencida", "proxima", "al_dia"] as const) {
        expect(fmtMoney(convertirBucket(bucketsFlat[bucket], moneda, TC))).toBe(
          fmtMoney(convertirBucket(bucketsAnidado[bucket], moneda, TC)),
        );
      }
    }
  });

  it("suma por moneda NATIVA antes de convertir (no ÷tc ciego del agregado ARS)", () => {
    // Vencido en USD = 100 (USD nativo) + 50000/1400 (ARS convertido) = 135,71.
    // Un ÷tc ciego del agregado ARS (180000/1400 = 128,57) sería regresión.
    const flat = flattenVentasPendientes(CLIENTES);
    const buckets = sumarBucketsNativos(flat.map(toItem));
    expect(fmtMoney(convertirBucket(buckets.vencida, "USD", TC))).toBe(fmtMoney("135.71"));
  });

  it("sin_fecha colapsa en al_dia también en la vista aplanada", () => {
    const flat = flattenVentasPendientes(CLIENTES);
    const buckets = sumarBucketsNativos(flat.map(toItem));
    expect(buckets.al_dia.usd).toBe("10.00");
  });
});

describe("ordenarPorUrgencia + filtrarPorVista · presentación pura", () => {
  it("ordenar no muta, no pierde ni duplica (mismo multiset de ids)", () => {
    const flat = flattenVentasPendientes(CLIENTES);
    const antes = flat.map((f) => f.id);
    const ordenado = ordenarPorUrgencia(flat);

    expect(flat.map((f) => f.id)).toEqual(antes); // input intacto
    expect(ordenado.map((f) => f.id).sort()).toEqual([...antes].sort());
    // Urgencia: diasParaVencer asc, sin fecha al final.
    expect(ordenado.map((f) => f.id)).toEqual(["v1", "v2", "v3", "v4", "v5"]);
  });

  it("vistas: hoy = vence hoy; prox7 = bucket proxima; vencidas = bucket vencida", () => {
    const flat = flattenVentasPendientes(CLIENTES);
    const hoy = flat.map((f) => (f.id === "v3" ? { ...f, diasParaVencer: 0 } : f));

    expect(filtrarPorVista(flat, "todas")).toHaveLength(5);
    expect(filtrarPorVista(flat, "vencidas").map((f) => f.id)).toEqual(["v1", "v2"]);
    expect(filtrarPorVista(flat, "prox7").map((f) => f.id)).toEqual(["v3"]);
    expect(filtrarPorVista(flat, "hoy")).toHaveLength(0);
    expect(filtrarPorVista(hoy, "hoy").map((f) => f.id)).toEqual(["v3"]);
  });

  it("resolverVista: sólo acepta presets conocidos", () => {
    expect(resolverVista(undefined)).toBe("todas");
    expect(resolverVista("vencidas")).toBe("vencidas");
    expect(resolverVista("prox7")).toBe("prox7");
    expect(resolverVista("hoy")).toBe("hoy");
    expect(resolverVista("promesas")).toBe("todas");
  });
});
