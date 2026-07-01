import { beforeEach, describe, expect, it, vi } from "vitest";

import { type Decimal, toDecimal } from "@/lib/decimal";

// Mock de los ÚNICOS dos accesos a datos de `proyectarCostos`: el agregado
// read-only `obtenerMemoriaDespacho` (envuelve el motor) y el lector de asiento
// `getAsientoDetalle`. El gate `verCosto` es PARÁMETRO → no se mockea permisos.
vi.mock("@/lib/services/despacho-memoria", () => ({ obtenerMemoriaDespacho: vi.fn() }));
vi.mock("@/lib/actions/asientos", () => ({ getAsientoDetalle: vi.fn() }));

import { getAsientoDetalle } from "@/lib/actions/asientos";
import { obtenerMemoriaDespacho } from "@/lib/services/despacho-memoria";
import type { CostoLandedResult } from "@/lib/services/despacho-parcial";

import {
  type CostosVista,
  proyectarCostos,
} from "@/app/(dashboard)/comex/embarques/[id]/despachos/[despachoId]/_components/costos-vista";
import type {
  DespachoFinanciero,
  DespachoVista,
} from "@/app/(dashboard)/comex/embarques/[id]/despachos/[despachoId]/_components/despacho-vista";

const mMemoria = vi.mocked(obtenerMemoriaDespacho);
const mAsiento = vi.mocked(getAsientoDetalle);

const DESPACHO_ID = "desp-1";

// ── Fixtures (caso golden A: 70/30, DIE 20 → A=84000 / B=36000 / total 120000) ──

function landedGoldenA(): CostoLandedResult {
  const porItem = [
    {
      itemDespachoId: 1,
      productoId: "A",
      cantidad: 1,
      costoFcUnitarioArs: toDecimal("70000"),
      capitalizablesItemArs: toDecimal("14000"),
      costoTotalArs: toDecimal("84000"),
      costoUnitarioLandedArs: toDecimal("84000"),
    },
    {
      itemDespachoId: 2,
      productoId: "B",
      cantidad: 1,
      costoFcUnitarioArs: toDecimal("30000"),
      capitalizablesItemArs: toDecimal("6000"),
      costoTotalArs: toDecimal("36000"),
      costoUnitarioLandedArs: toDecimal("36000"),
    },
  ];
  const mapa = new Map<number, Decimal>([
    [1, toDecimal("84000")],
    [2, toDecimal("36000")],
  ]);
  return {
    nacionalizadoArs: toDecimal("100000"),
    tributosCapitalizablesArs: toDecimal("20000"),
    facturasCapitalizablesArs: toDecimal("0"),
    capitalizablesArs: toDecimal("20000"),
    costoTotalArs: toDecimal("120000"),
    porItem,
    costoUnitarioLandedPorItem: mapa,
  };
}

function vistaBase(overrides: Partial<DespachoVista> = {}): DespachoVista {
  return {
    id: DESPACHO_ID,
    codigo: "DSP-0001",
    fecha: "2026-06-01",
    estado: "CONTABILIZADO",
    numeroOM: null,
    itemsCount: 2,
    facturasCount: 2,
    asiento: { id: "asi-1", numero: 5 },
    embarqueId: "emb-1",
    embarqueCodigo: "IMP-1",
    notas: null,
    items: [
      {
        id: 1,
        productoId: "A",
        productoCodigo: "COD-A",
        productoNombre: "Producto A",
        cantidad: 1,
        cantidadEmbarque: 1,
      },
      {
        id: 2,
        productoId: "B",
        productoCodigo: "COD-B",
        productoNombre: "Producto B",
        cantidad: 1,
        cantidadEmbarque: 1,
      },
    ],
    facturas: [
      { id: 10, proveedorNombre: "Prov X", facturaNumero: "F-10", momento: "DESPACHO" },
      { id: 11, proveedorNombre: "Prov Y", facturaNumero: "F-11", momento: "ZONA_PRIMARIA" },
    ],
    ...overrides,
  };
}

function financieroBase(overrides: Partial<DespachoFinanciero> = {}): DespachoFinanciero {
  return {
    tipoCambio: "1",
    die: "20000",
    tasaEstadistica: "0",
    arancelSim: "0",
    iva: "25200",
    ivaAdicional: "0",
    iibb: "0",
    ganancias: "0",
    costoUnitarioPorItem: { 1: "84000", 2: "36000" },
    totalArsPorFactura: { 10: "5000", 11: "3000" },
    landedItemsTotal: "120000",
    tributosCapitalizables: "20000",
    tributosCashOut: "25200",
    ...overrides,
  };
}

function memoriaCruzado(landed: CostoLandedResult, estado: DespachoVista["estado"]) {
  return {
    tipo: "CRUZADO" as const,
    despachoId: DESPACHO_ID,
    codigo: "DSP-0001",
    estado,
    tipoCambioEmbarque: "1",
    tipoCambioDespacho: "1",
    baseRateio: "FOB" as const,
    landed,
  };
}

function asientoOk(debeMercaderia: string) {
  return {
    ok: true as const,
    detalle: {
      id: "asi-1",
      numero: 5,
      fecha: new Date("2026-06-01"),
      descripcion: "Despacho",
      estado: "CONTABILIZADO" as const,
      origen: "COMEX" as const,
      moneda: "ARS" as const,
      tipoCambio: "1",
      totalDebe: debeMercaderia,
      totalHaber: debeMercaderia,
      periodoCodigo: "2026-06",
      lineas: [
        {
          id: 1,
          cuentaCodigo: "1.1.7.01",
          cuentaNombre: "MERCADERÍAS",
          debe: debeMercaderia,
          haber: "0.00",
          descripcion: null,
          monedaOrigen: null,
          montoOrigen: null,
          tipoCambioOrigen: null,
        },
        {
          id: 2,
          cuentaCodigo: "1.1.7.05",
          cuentaNombre: "EN TRÁNSITO",
          debe: "0.00",
          haber: debeMercaderia,
          descripcion: null,
          monedaOrigen: null,
          montoOrigen: null,
          tipoCambioOrigen: null,
        },
      ],
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mAsiento.mockResolvedValue(asientoOk("120000.00"));
});

describe("proyectarCostos · gate VER_COSTO_LANDED (anti-leak)", () => {
  it("verCosto=false → null y NO consulta la memoria (ningún valor cruza)", async () => {
    const r = await proyectarCostos(DESPACHO_ID, vistaBase(), financieroBase(), false);
    expect(r).toBeNull();
    expect(mMemoria).not.toHaveBeenCalled();
    expect(mAsiento).not.toHaveBeenCalled();
  });

  it("financiero=null → null y NO consulta la memoria", async () => {
    const r = await proyectarCostos(DESPACHO_ID, vistaBase(), null, true);
    expect(r).toBeNull();
    expect(mMemoria).not.toHaveBeenCalled();
  });
});

describe("proyectarCostos · CRUZADO (no recompute, agregados == memoria)", () => {
  it("componentes y per-SKU IGUALAN la memoria (sin recálculo)", async () => {
    const landed = landedGoldenA();
    mMemoria.mockResolvedValue(memoriaCruzado(landed, "CONTABILIZADO"));
    const r = await proyectarCostos(DESPACHO_ID, vistaBase(), financieroBase(), true);
    expect(r?.kind).toBe("CRUZADO");
    if (r?.kind !== "CRUZADO") throw new Error("esperado CRUZADO");

    expect(r.componentes.nacionalizado).toBe(landed.nacionalizadoArs.toFixed(2));
    expect(r.componentes.tributosCapitalizables).toBe(landed.tributosCapitalizablesArs.toFixed(2));
    expect(r.componentes.facturasCapitalizables).toBe(landed.facturasCapitalizablesArs.toFixed(2));
    expect(r.componentes.capitalizables).toBe(landed.capitalizablesArs.toFixed(2));
    expect(r.componentes.total).toBe(landed.costoTotalArs.toFixed(2));

    expect(r.items.map((i) => i.costoTotal)).toEqual(["84000.00", "36000.00"]);
    expect(r.items.map((i) => i.codigo)).toEqual(["COD-A", "COD-B"]);
  });

  it("reconciliación: nacionalizado + capitalizables == total; tributos + facturas == capitalizables", async () => {
    mMemoria.mockResolvedValue(memoriaCruzado(landedGoldenA(), "CONTABILIZADO"));
    const r = await proyectarCostos(DESPACHO_ID, vistaBase(), financieroBase(), true);
    if (r?.kind !== "CRUZADO") throw new Error("esperado CRUZADO");
    const c = r.componentes;
    expect(toDecimal(c.nacionalizado).plus(toDecimal(c.capitalizables)).toFixed(2)).toBe(c.total);
    expect(
      toDecimal(c.tributosCapitalizables).plus(toDecimal(c.facturasCapitalizables)).toFixed(2),
    ).toBe(c.capitalizables);
  });
});

describe("proyectarCostos · catch estrecho (costos abiertos vs integridad)", () => {
  it("throw de costos sin cerrar → sentinel COSTOS_ABIERTOS", async () => {
    mMemoria.mockRejectedValue(
      new Error("Despacho DSP-0001: una línea cruzada no tiene costo FC (cerrá costos…)."),
    );
    const r = await proyectarCostos(DESPACHO_ID, vistaBase(), financieroBase(), true);
    expect(r).toEqual({ kind: "COSTOS_ABIERTOS" });
  });

  it("error de integridad (embarque faltante) → SE RE-LANZA (no se enmascara)", async () => {
    mMemoria.mockRejectedValue(new Error("No Embarque found"));
    await expect(proyectarCostos(DESPACHO_ID, vistaBase(), financieroBase(), true)).rejects.toThrow(
      "No Embarque found",
    );
  });
});

describe("proyectarCostos · LEGACY", () => {
  it("tipo LEGACY → fallback resumen STORED, sin per-SKU", async () => {
    mMemoria.mockResolvedValue({
      tipo: "LEGACY",
      despachoId: DESPACHO_ID,
      codigo: "DSP-0001",
      estado: "CONTABILIZADO",
    });
    const r = await proyectarCostos(DESPACHO_ID, vistaBase(), financieroBase(), true);
    expect(r?.kind).toBe("LEGACY");
    if (r?.kind !== "LEGACY") throw new Error("esperado LEGACY");
    expect(r.resumen.landedItemsTotal).toBe("120000");
    expect(r.resumen.tributosCashOut).toBe("25200");
    expect(r.tributos).toHaveLength(7);
    expect(r.facturas).toHaveLength(2);
    expect((r as { items?: unknown }).items).toBeUndefined();
  });
});

describe("proyectarCostos · consistencia A (memoria ≡ persistido)", () => {
  it("BORRADOR (costoUnitario STORED = 0) → PREVIEW, NO discrepancia", async () => {
    mMemoria.mockResolvedValue(memoriaCruzado(landedGoldenA(), "BORRADOR"));
    const fin = financieroBase({ costoUnitarioPorItem: { 1: "0", 2: "0" }, landedItemsTotal: "0" });
    const r = await proyectarCostos(DESPACHO_ID, vistaBase({ estado: "BORRADOR" }), fin, true);
    if (r?.kind !== "CRUZADO") throw new Error("esperado CRUZADO");
    expect(r.consistencia.persistido).toEqual({ kind: "PREVIEW" });
  });

  it("CONTABILIZADO con match exacto → CONSISTENTE Δ 0.00", async () => {
    mMemoria.mockResolvedValue(memoriaCruzado(landedGoldenA(), "CONTABILIZADO"));
    const r = await proyectarCostos(DESPACHO_ID, vistaBase(), financieroBase(), true);
    if (r?.kind !== "CRUZADO") throw new Error("esperado CRUZADO");
    expect(r.consistencia.persistido).toEqual({ kind: "CONSISTENTE", delta: "0.00" });
  });

  it("CONTABILIZADO con desvío persistido > 0.01 → DISCREPANCIA", async () => {
    mMemoria.mockResolvedValue(memoriaCruzado(landedGoldenA(), "CONTABILIZADO"));
    const fin = financieroBase({ costoUnitarioPorItem: { 1: "83990", 2: "36000" } });
    const r = await proyectarCostos(DESPACHO_ID, vistaBase(), fin, true);
    if (r?.kind !== "CRUZADO") throw new Error("esperado CRUZADO");
    expect(r.consistencia.persistido.kind).toBe("DISCREPANCIA");
  });
});

describe("proyectarCostos · consistencia B (memoria ≡ asiento) + anti-leak", () => {
  it("DEBE mercadería = total → CONSISTENTE", async () => {
    mMemoria.mockResolvedValue(memoriaCruzado(landedGoldenA(), "CONTABILIZADO"));
    mAsiento.mockResolvedValue(asientoOk("120000.00"));
    const r = await proyectarCostos(DESPACHO_ID, vistaBase(), financieroBase(), true);
    if (r?.kind !== "CRUZADO") throw new Error("esperado CRUZADO");
    expect(r.consistencia.asiento).toEqual({ kind: "CONSISTENTE", delta: "0.00" });
  });

  it("DEBE mercadería desviado → DISCREPANCIA", async () => {
    mMemoria.mockResolvedValue(memoriaCruzado(landedGoldenA(), "CONTABILIZADO"));
    mAsiento.mockResolvedValue(asientoOk("119000.00"));
    const r = await proyectarCostos(DESPACHO_ID, vistaBase(), financieroBase(), true);
    if (r?.kind !== "CRUZADO") throw new Error("esperado CRUZADO");
    expect(r.consistencia.asiento.kind).toBe("DISCREPANCIA");
  });

  it("getAsientoDetalle {ok:false} → NO_APLICA (sin crash)", async () => {
    mMemoria.mockResolvedValue(memoriaCruzado(landedGoldenA(), "CONTABILIZADO"));
    mAsiento.mockResolvedValue({ ok: false, error: "Asiento inexistente." });
    const r = await proyectarCostos(DESPACHO_ID, vistaBase(), financieroBase(), true);
    if (r?.kind !== "CRUZADO") throw new Error("esperado CRUZADO");
    expect(r.consistencia.asiento).toEqual({ kind: "NO_APLICA" });
  });

  it("anti-leak: el veredicto NO contiene líneas/`debe` crudos del asiento", async () => {
    mMemoria.mockResolvedValue(memoriaCruzado(landedGoldenA(), "CONTABILIZADO"));
    const r = await proyectarCostos(DESPACHO_ID, vistaBase(), financieroBase(), true);
    if (r?.kind !== "CRUZADO") throw new Error("esperado CRUZADO");
    expect(Object.keys(r.consistencia.asiento).sort()).toEqual(["delta", "kind"]);
    expect(JSON.stringify(r.consistencia)).not.toContain("cuentaCodigo");
  });
});

describe("proyectarCostos · facturas DESPACHO vs ZONA_PRIMARIA", () => {
  it("sólo la DESPACHO capitaliza; la ZONA_PRIMARIA queda marcada como no capitalizable", async () => {
    mMemoria.mockResolvedValue(memoriaCruzado(landedGoldenA(), "CONTABILIZADO"));
    const r = await proyectarCostos(DESPACHO_ID, vistaBase(), financieroBase(), true);
    if (r?.kind !== "CRUZADO") throw new Error("esperado CRUZADO");
    const despacho = r.facturas.find((f) => f.momento === "DESPACHO");
    const zp = r.facturas.find((f) => f.momento === "ZONA_PRIMARIA");
    expect(despacho?.capitalizable).toBe(true);
    expect(zp?.capitalizable).toBe(false);
    expect(despacho?.totalArs).toBe("5000");
  });
});

describe("proyectarCostos · join defensivo por ítem", () => {
  it("porItem sin match en vista.items → usa productoId de fallback (sin crash)", async () => {
    const landed = landedGoldenA();
    landed.porItem[1] = { ...landed.porItem[1], itemDespachoId: 999, productoId: "B" };
    mMemoria.mockResolvedValue(memoriaCruzado(landed, "CONTABILIZADO"));
    const r = await proyectarCostos(DESPACHO_ID, vistaBase(), financieroBase(), true);
    if (r?.kind !== "CRUZADO") throw new Error("esperado CRUZADO");
    const fila = r.items.find((i) => i.itemDespachoId === 999);
    expect(fila?.codigo).toBe("B");
    expect(fila?.nombre).toBe("—");
  });
});

describe("proyectarCostos · ANULADO", () => {
  it("estado ANULADO → consistencia omitida (NO_APLICA en ambos)", async () => {
    mMemoria.mockResolvedValue(memoriaCruzado(landedGoldenA(), "ANULADO"));
    const r = await proyectarCostos(DESPACHO_ID, vistaBase({ estado: "ANULADO" }), financieroBase(), true);
    if (r?.kind !== "CRUZADO") throw new Error("esperado CRUZADO");
    expect(r.consistencia.persistido).toEqual({ kind: "NO_APLICA" });
    expect(r.consistencia.asiento).toEqual({ kind: "NO_APLICA" });
  });
});

// Asegura que el tipo de unión sigue siendo serializable (sin Decimal/Map).
describe("CostosVista · contrato serializable", () => {
  it("CRUZADO sólo contiene strings/números/booleanos en valores de costo", async () => {
    mMemoria.mockResolvedValue(memoriaCruzado(landedGoldenA(), "CONTABILIZADO"));
    const r = (await proyectarCostos(DESPACHO_ID, vistaBase(), financieroBase(), true)) as CostosVista;
    const json = JSON.parse(JSON.stringify(r));
    expect(json.componentes.total).toBe("120000.00");
  });
});
