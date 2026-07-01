import { beforeEach, describe, expect, it, vi } from "vitest";

import { type Decimal, toDecimal } from "@/lib/decimal";

// Mock de las ÚNICAS dependencias de datos:
//  · `obtenerMemoriaDespacho` (agregado read-only que envuelve el motor SIN escribir)
//  · `db.producto.findMany` (lookup de nombres) + writes (para probar "no muta")
//  · `hasPermission` (gate `VER_COSTO_LANDED`)
//  · `requireSessionUser` + `auditarExportacion` (export auditado)
// El motor `calcularCostoLandedDespacho` NUNCA se importa/mockea (la memoria lo
// consume sólo a través de `obtenerMemoriaDespacho`).
vi.mock("@/lib/services/despacho-memoria", () => ({ obtenerMemoriaDespacho: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    producto: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    despacho: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/permisos", () => ({
  hasPermission: vi.fn(),
  PERMISOS: { VER_COSTO_LANDED: "costos.verLanded" },
}));
vi.mock("@/lib/auth-guard", () => ({ requireSessionUser: vi.fn() }));
vi.mock("@/lib/services/auditar-exportacion", () => ({ auditarExportacion: vi.fn() }));

import { requireSessionUser } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/permisos";
import { auditarExportacion } from "@/lib/services/auditar-exportacion";
import { obtenerMemoriaDespacho } from "@/lib/services/despacho-memoria";
import type { CostoLandedResult } from "@/lib/services/despacho-parcial";

import {
  simularMemoriaAction,
  verMemoriaAction,
} from "@/lib/actions/comex-despacho-memoria";
import { exportarMemoriaDespacho } from "@/lib/actions/comex-despacho-memoria-export";
import {
  leerMemoriaDetalle,
  proyectarMemoria,
} from "@/lib/services/despacho-memoria-vista";

const mMemoria = vi.mocked(obtenerMemoriaDespacho);
const mProducto = vi.mocked(db.producto.findMany);
const mPerm = vi.mocked(hasPermission);
const mSesion = vi.mocked(requireSessionUser);
const mAudit = vi.mocked(auditarExportacion);

const DESPACHO_ID = "desp-1";

// ── Fixtures ──────────────────────────────────────────────────────────────

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
  return {
    nacionalizadoArs: toDecimal("100000"),
    tributosCapitalizablesArs: toDecimal("20000"),
    facturasCapitalizablesArs: toDecimal("0"),
    capitalizablesArs: toDecimal("20000"),
    costoTotalArs: toDecimal("120000"),
    porItem,
    costoUnitarioLandedPorItem: new Map<number, Decimal>([
      [1, toDecimal("84000")],
      [2, toDecimal("36000")],
    ]),
  };
}

/** 3 ítems por CANTIDAD, capitalizables 100 → ideal 33,33 c/u; Σ=99,99 → ajuste 0,01. */
function landedResiduo(): CostoLandedResult {
  const mk = (id: number, cap: string) => ({
    itemDespachoId: id,
    productoId: `P${id}`,
    cantidad: 1,
    costoFcUnitarioArs: toDecimal("0"),
    capitalizablesItemArs: toDecimal(cap),
    costoTotalArs: toDecimal(cap),
    costoUnitarioLandedArs: toDecimal(cap),
  });
  return {
    nacionalizadoArs: toDecimal("0"),
    tributosCapitalizablesArs: toDecimal("100"),
    facturasCapitalizablesArs: toDecimal("0"),
    capitalizablesArs: toDecimal("100"),
    costoTotalArs: toDecimal("100"),
    porItem: [mk(1, "33.34"), mk(2, "33.33"), mk(3, "33.33")],
    costoUnitarioLandedPorItem: new Map<number, Decimal>(),
  };
}

function memoriaCruzado(landed: CostoLandedResult, estado: "BORRADOR" | "CONTABILIZADO" | "ANULADO", base: "FOB" | "CANTIDAD" = "FOB") {
  return {
    tipo: "CRUZADO" as const,
    despachoId: DESPACHO_ID,
    codigo: "DSP-0001",
    estado,
    tipoCambioEmbarque: "1",
    tipoCambioDespacho: "1",
    baseRateio: base,
    landed,
  };
}

const NOMBRES_AB = [
  { id: "A", codigo: "COD-A", nombre: "Producto A" },
  { id: "B", codigo: "COD-B", nombre: "Producto B" },
];

beforeEach(() => {
  vi.clearAllMocks();
  mProducto.mockResolvedValue(NOMBRES_AB as never);
  vi.mocked(db.despacho.findUnique).mockResolvedValue({ embarqueId: "emb-1" } as never);
  mSesion.mockResolvedValue("user-1" as never);
  mAudit.mockResolvedValue(undefined as never);
});

// ── proyectarMemoria (pura, sin I/O) ───────────────────────────────────────

describe("proyectarMemoria · derivación de display (no recompute)", () => {
  const nombres = new Map(NOMBRES_AB.map((p) => [p.id, { codigo: p.codigo, nombre: p.nombre }]));

  it("participación deriva de la base y suma 100%; valores monetarios == campos del motor", () => {
    const d = proyectarMemoria(memoriaCruzado(landedGoldenA(), "CONTABILIZADO"), nombres, "emb-1");
    expect(d.lineas.map((l) => l.participacionPct)).toEqual(["70.00", "30.00"]);
    const suma = d.lineas.reduce((a, l) => a + Number(l.participacionPct), 0);
    expect(suma).toBeCloseTo(100, 2);
    // Costo unit/total por SKU == salida del motor (jamás recalculado)
    expect(d.lineas.map((l) => l.costoUnitarioLanded)).toEqual(["84000.0000", "36000.0000"]);
    expect(d.lineas.map((l) => l.costoTotal)).toEqual(["84000.00", "36000.00"]);
    expect(d.lineas.map((l) => l.capitalizablesAlocado)).toEqual(["14000.00", "6000.00"]);
    expect(d.codigo).toBe("DSP-0001");
    expect(d.embarqueId).toBe("emb-1");
    expect(d.funcionBadge).toContain("FOB");
  });

  it("ajuste de redondeo reconcilia el residuo (fixture 3 ítems → 0,01)", () => {
    const d = proyectarMemoria(
      memoriaCruzado(landedResiduo(), "CONTABILIZADO", "CANTIDAD"),
      new Map(),
      "emb-1",
    );
    expect(d.ajusteRedondeo).toBe("0.01");
    expect(d.baseRateio).toBe("CANTIDAD");
    expect(d.funcionBadge).toContain("cantidad");
    // Σ capitalizables alocados (motor) == capitalizables totales (reconcilia).
    const sum = d.lineas.reduce((a, l) => a.plus(toDecimal(l.capitalizablesAlocado)), toDecimal(0));
    expect(sum.toFixed(2)).toBe(d.capitalizables);
  });

  it("contrato serializable (sin Decimal/Map): sólo strings/números", () => {
    const d = proyectarMemoria(memoriaCruzado(landedGoldenA(), "CONTABILIZADO"), nombres, "emb-1");
    const json = JSON.parse(JSON.stringify(d));
    expect(json.totalLanded).toBe("120000.00");
    expect(JSON.stringify(d)).not.toContain("cuentaCodigo");
  });
});

// ── leerMemoriaDetalle (estados + catch estrecho) ──────────────────────────

describe("leerMemoriaDetalle · estados honestos", () => {
  it("CONTABILIZADO → memoria consolidada (CRUZADO)", async () => {
    mMemoria.mockResolvedValue(memoriaCruzado(landedGoldenA(), "CONTABILIZADO"));
    const r = await leerMemoriaDetalle(DESPACHO_ID);
    expect(r.ok).toBe(true);
    if (!r.ok || r.detalle.tipo !== "CRUZADO") throw new Error("esperado CRUZADO");
    expect(r.detalle.lineas.map((l) => l.codigo)).toEqual(["COD-A", "COD-B"]);
  });

  it("null → SIN_MEMORIA", async () => {
    mMemoria.mockResolvedValue(null);
    expect(await leerMemoriaDetalle(DESPACHO_ID)).toEqual({ ok: false, reason: "SIN_MEMORIA" });
  });

  it("LEGACY → estado honesto (sin rateio)", async () => {
    mMemoria.mockResolvedValue({
      tipo: "LEGACY",
      despachoId: DESPACHO_ID,
      codigo: "DSP-0001",
      estado: "CONTABILIZADO",
    });
    const r = await leerMemoriaDetalle(DESPACHO_ID);
    expect(r).toEqual({ ok: true, detalle: { tipo: "LEGACY", codigo: "DSP-0001", estado: "CONTABILIZADO" } });
  });

  it("throw 'no tiene costo FC' → COSTOS_ABIERTOS (catch estrecho)", async () => {
    mMemoria.mockRejectedValue(new Error("Despacho DSP-0001: una línea cruzada no tiene costo FC (…)."));
    expect(await leerMemoriaDetalle(DESPACHO_ID)).toEqual({ ok: false, reason: "COSTOS_ABIERTOS" });
  });

  it("error de integridad (embarque faltante) → RE-LANZA", async () => {
    mMemoria.mockRejectedValue(new Error("No Embarque found"));
    await expect(leerMemoriaDetalle(DESPACHO_ID)).rejects.toThrow("No Embarque found");
  });
});

// ── verMemoriaAction / simularMemoriaAction (gate + estados) ────────────────

describe("verMemoriaAction / simularMemoriaAction · gate VER_COSTO_LANDED", () => {
  it("sin permiso → memoria NEGADA y NO se consulta la memoria (nada se serializa)", async () => {
    mPerm.mockResolvedValue(false);
    const r = await verMemoriaAction(DESPACHO_ID);
    expect(r).toEqual({ ok: false, reason: "SIN_PERMISO" });
    expect(mMemoria).not.toHaveBeenCalled();
    expect(mProducto).not.toHaveBeenCalled();
  });

  it("sin permiso → simular NEGADO", async () => {
    mPerm.mockResolvedValue(false);
    expect(await simularMemoriaAction(DESPACHO_ID)).toEqual({ ok: false, reason: "SIN_PERMISO" });
    expect(mMemoria).not.toHaveBeenCalled();
  });

  it("con permiso · CONTABILIZADO → memoria consolidada", async () => {
    mPerm.mockResolvedValue(true);
    mMemoria.mockResolvedValue(memoriaCruzado(landedGoldenA(), "CONTABILIZADO"));
    const r = await verMemoriaAction(DESPACHO_ID);
    if (!r.ok || r.detalle.tipo !== "CRUZADO") throw new Error("esperado CRUZADO");
    expect(r.detalle.estado).toBe("CONTABILIZADO");
    expect(r.detalle.lineas).toHaveLength(2);
  });

  it("con permiso · BORRADOR → preview byte-estable == CONTABILIZADO (salvo estado)", async () => {
    mPerm.mockResolvedValue(true);
    mMemoria.mockResolvedValue(memoriaCruzado(landedGoldenA(), "BORRADOR"));
    const borrador = await verMemoriaAction(DESPACHO_ID);
    mMemoria.mockResolvedValue(memoriaCruzado(landedGoldenA(), "CONTABILIZADO"));
    const contab = await verMemoriaAction(DESPACHO_ID);
    if (!borrador.ok || !contab.ok || borrador.detalle.tipo !== "CRUZADO" || contab.detalle.tipo !== "CRUZADO")
      throw new Error("esperado CRUZADO");
    expect({ ...borrador.detalle, estado: "X" }).toEqual({ ...contab.detalle, estado: "X" });
  });

  it("con permiso · LEGACY → estado honesto", async () => {
    mPerm.mockResolvedValue(true);
    mMemoria.mockResolvedValue({ tipo: "LEGACY", despachoId: DESPACHO_ID, codigo: "DSP-0001", estado: "CONTABILIZADO" });
    const r = await verMemoriaAction(DESPACHO_ID);
    if (!r.ok) throw new Error("esperado ok");
    expect(r.detalle.tipo).toBe("LEGACY");
  });

  it("con permiso · ANULADO → estado honesto read-only", async () => {
    mPerm.mockResolvedValue(true);
    mMemoria.mockResolvedValue(memoriaCruzado(landedGoldenA(), "ANULADO"));
    const r = await verMemoriaAction(DESPACHO_ID);
    if (!r.ok || r.detalle.tipo !== "CRUZADO") throw new Error("esperado CRUZADO");
    expect(r.detalle.estado).toBe("ANULADO");
  });

  it("Simular NO escribe (sólo lectura) y ≡ verMemoria sobre los datos actuales", async () => {
    mPerm.mockResolvedValue(true);
    mMemoria.mockResolvedValue(memoriaCruzado(landedGoldenA(), "CONTABILIZADO"));
    const sim = await simularMemoriaAction(DESPACHO_ID);
    const ver = await verMemoriaAction(DESPACHO_ID);
    expect(sim).toEqual(ver);
    // Ninguna mutación de DB fue invocada.
    expect(db.producto.create).not.toHaveBeenCalled();
    expect(db.producto.update).not.toHaveBeenCalled();
    expect(db.despacho.update).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

// ── exportarMemoriaDespacho (auditado, sin DOM, sin leak) ───────────────────

describe("exportarMemoriaDespacho · export auditado", () => {
  it("sin permiso → NEGADO; no lee/serializa/audita", async () => {
    mPerm.mockResolvedValue(false);
    const r = await exportarMemoriaDespacho({ despachoId: DESPACHO_ID, formato: "csv" });
    expect(r.ok).toBe(false);
    expect(mMemoria).not.toHaveBeenCalled();
    expect(mAudit).not.toHaveBeenCalled();
  });

  it("CSV usa datos server-side (base64 → CSV con headers y filas de la memoria)", async () => {
    mPerm.mockResolvedValue(true);
    mMemoria.mockResolvedValue(memoriaCruzado(landedGoldenA(), "CONTABILIZADO"));
    const r = await exportarMemoriaDespacho({ despachoId: DESPACHO_ID, formato: "csv" });
    if (!r.ok) throw new Error("esperado ok");
    const csv = Buffer.from(r.base64, "base64").toString("utf8");
    expect(csv).toContain("Participación %");
    expect(csv).toContain("COD-A");
    expect(csv).toContain("TOTAL");
    expect(r.filename).toMatch(/^memoria-despacho-DSP-0001-\d{12}\.csv$/);
  });

  it("XLSX usa datos server-side (base64 no vacío; corre en node sin DOM)", async () => {
    mPerm.mockResolvedValue(true);
    mMemoria.mockResolvedValue(memoriaCruzado(landedGoldenA(), "CONTABILIZADO"));
    const r = await exportarMemoriaDespacho({ despachoId: DESPACHO_ID, formato: "xlsx" });
    if (!r.ok) throw new Error("esperado ok");
    expect(r.base64.length).toBeGreaterThan(0);
    expect(r.mime).toContain("spreadsheetml");
  });

  it("audita ANTES de devolver (recurso comex-despacho-memoria) y devuelve base64", async () => {
    mPerm.mockResolvedValue(true);
    mMemoria.mockResolvedValue(memoriaCruzado(landedGoldenA(), "CONTABILIZADO"));
    const r = await exportarMemoriaDespacho({ despachoId: DESPACHO_ID, formato: "csv" });
    expect(mAudit).toHaveBeenCalledTimes(1);
    expect(mAudit.mock.calls[0][0]).toMatchObject({
      recurso: "comex-despacho-memoria",
      formato: "csv",
      filtros: { despachoId: DESPACHO_ID, embarqueId: "emb-1", verCosto: true },
    });
    expect(r.ok).toBe(true);
  });

  it("falla de auditoría BLOQUEA el archivo (propaga, sin base64)", async () => {
    mPerm.mockResolvedValue(true);
    mMemoria.mockResolvedValue(memoriaCruzado(landedGoldenA(), "CONTABILIZADO"));
    mAudit.mockRejectedValue(new Error("audit down"));
    await expect(exportarMemoriaDespacho({ despachoId: DESPACHO_ID, formato: "csv" })).rejects.toThrow(
      "audit down",
    );
  });

  it("no filtra ledger crudo (sin cuentaCodigo/debe en columnas ni archivo)", async () => {
    mPerm.mockResolvedValue(true);
    mMemoria.mockResolvedValue(memoriaCruzado(landedGoldenA(), "CONTABILIZADO"));
    const r = await exportarMemoriaDespacho({ despachoId: DESPACHO_ID, formato: "csv" });
    if (!r.ok) throw new Error("esperado ok");
    const csv = Buffer.from(r.base64, "base64").toString("utf8").toLowerCase();
    expect(csv).not.toContain("cuentacodigo");
    expect(csv).not.toContain("debe");
    const columnas = (mAudit.mock.calls[0][0] as { columnas: string[] }).columnas;
    expect(columnas.join(" ").toLowerCase()).not.toContain("debe");
  });

  it("COSTOS_ABIERTOS → error honesto (no audita)", async () => {
    mPerm.mockResolvedValue(true);
    mMemoria.mockRejectedValue(new Error("una línea cruzada no tiene costo FC (…)."));
    const r = await exportarMemoriaDespacho({ despachoId: DESPACHO_ID, formato: "csv" });
    expect(r.ok).toBe(false);
    expect(mAudit).not.toHaveBeenCalled();
  });
});
