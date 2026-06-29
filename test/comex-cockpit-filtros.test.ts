import { describe, expect, it } from "vitest";

import type { EmbarqueEstado } from "@/generated/prisma/client";
import {
  aplicarFiltrosEnriched,
  cockpitFiltrosToQuery,
  type EnrichedParaFiltro,
  parseCockpitFiltros,
  parseCockpitVista,
  presetToFiltros,
} from "@/lib/services/comex-cockpit-filtros";
import type { EtaTono } from "@/lib/services/comex-worklist-derivaciones";

// `now` inyectado (nunca Date.now() interno) → determinista. Referencia fija.
const NOW = new Date("2026-06-28T00:00:00.000Z");
const MS_DIA = 86_400_000;
const diasAtras = (d: number) => new Date(NOW.getTime() - d * MS_DIA);

// ── parseCockpitVista ─────────────────────────────────────────────────────────

describe("parseCockpitVista", () => {
  it("ids válidos se preservan", () => {
    for (const v of ["todos", "criticos", "proximos", "transito", "sin-actualizar", "pagos"]) {
      expect(parseCockpitVista(v)).toBe(v);
    }
  });
  it("desconocido / undefined → todos", () => {
    expect(parseCockpitVista("inventada")).toBe("todos");
    expect(parseCockpitVista(undefined)).toBe("todos");
  });
});

// ── presetToFiltros ───────────────────────────────────────────────────────────

describe("presetToFiltros", () => {
  it("todos → sin filtros", () => {
    expect(presetToFiltros("todos", NOW)).toEqual({});
  });
  it("criticos / sin-actualizar / pagos → foco respectivo", () => {
    expect(presetToFiltros("criticos", NOW)).toEqual({ foco: "criticos" });
    expect(presetToFiltros("sin-actualizar", NOW)).toEqual({ foco: "sin-actualizar" });
    expect(presetToFiltros("pagos", NOW)).toEqual({ foco: "pagos" });
  });
  it("proximos → etaHasta = now + 15d (reusa resolverVistaFiltro)", () => {
    const f = presetToFiltros("proximos", NOW);
    expect(f.etaHasta?.getTime()).toBe(NOW.getTime() + 15 * MS_DIA);
    expect(f.estado).toBeUndefined();
  });
  it("transito → estado EN_TRANSITO", () => {
    expect(presetToFiltros("transito", NOW)).toEqual({ estado: ["EN_TRANSITO"] });
  });
});

// ── parseCockpitFiltros ───────────────────────────────────────────────────────

describe("parseCockpitFiltros", () => {
  it("vacío → vista=todos, filtros vacíos (no-op = PR-022a)", () => {
    expect(parseCockpitFiltros({}, NOW)).toEqual({ vista: "todos", filtros: {} });
  });

  it("proveedor explícito se captura", () => {
    const { filtros } = parseCockpitFiltros({ proveedor: "prov-1" }, NOW);
    expect(filtros.proveedorId).toBe("prov-1");
  });

  it("estado válido → [estado]; CERRADO e inválido se descartan", () => {
    expect(parseCockpitFiltros({ estado: "EN_PUERTO" }, NOW).filtros.estado).toEqual(["EN_PUERTO"]);
    expect(parseCockpitFiltros({ estado: "CERRADO" }, NOW).filtros.estado).toBeUndefined();
    expect(parseCockpitFiltros({ estado: "FOO" }, NOW).filtros.estado).toBeUndefined();
  });

  it("estado explícito sobrescribe el del preset transito", () => {
    const { vista, filtros } = parseCockpitFiltros({ vista: "transito", estado: "EN_PUERTO" }, NOW);
    expect(vista).toBe("transito");
    expect(filtros.estado).toEqual(["EN_PUERTO"]);
  });

  it("ETA: ISO válido parsea; formato inválido se descarta", () => {
    const { filtros } = parseCockpitFiltros({ eta_desde: "2026-07-01", eta_hasta: "2026-07-31" }, NOW);
    expect(filtros.etaDesde?.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(filtros.etaHasta?.toISOString()).toBe("2026-07-31T23:59:59.999Z");
    expect(parseCockpitFiltros({ eta_desde: "2026/07/01" }, NOW).filtros.etaDesde).toBeUndefined();
  });

  it("desde > hasta → descarta hasta (preserva desde)", () => {
    const { filtros } = parseCockpitFiltros({ eta_desde: "2026-07-10", eta_hasta: "2026-07-01" }, NOW);
    expect(filtros.etaDesde?.toISOString()).toBe("2026-07-10T00:00:00.000Z");
    expect(filtros.etaHasta).toBeUndefined();
  });

  it("eta_hasta explícito sobrescribe el etaHasta del preset proximos", () => {
    const { filtros } = parseCockpitFiltros({ vista: "proximos", eta_hasta: "2026-07-05" }, NOW);
    expect(filtros.etaHasta?.toISOString()).toBe("2026-07-05T23:59:59.999Z");
  });
});

// ── cockpitFiltrosToQuery ─────────────────────────────────────────────────────

describe("cockpitFiltrosToQuery", () => {
  it("descarta vacíos / null / undefined", () => {
    expect(cockpitFiltrosToQuery({ vista: "proximos", moneda: "USD" })).toBe("vista=proximos&moneda=USD");
    expect(cockpitFiltrosToQuery({ vista: "proximos", moneda: null, x: undefined, y: "" })).toBe(
      "vista=proximos",
    );
    expect(cockpitFiltrosToQuery({})).toBe("");
  });
});

// ── aplicarFiltrosEnriched ────────────────────────────────────────────────────

function mk(
  id: string,
  opts: Partial<{
    estado: EmbarqueEstado;
    proveedorId: string;
    fechaLlegada: Date | null;
    updatedAt: Date;
    bloqueo: string | null;
    etaTono: EtaTono;
  }> = {},
): EnrichedParaFiltro {
  return {
    ref: { id, estado: opts.estado ?? "EN_TRANSITO" },
    proveedorId: opts.proveedorId ?? "p1",
    fechaLlegada: opts.fechaLlegada ?? null,
    updatedAt: opts.updatedAt ?? NOW,
    bloqueo: opts.bloqueo ?? null,
    etaTono: opts.etaTono ?? "none",
  };
}

const CTX_VACIO = { now: NOW, pagosEmbarqueIds: new Set<string>() };
const ids = (xs: EnrichedParaFiltro[]) => xs.map((e) => e.ref.id);

describe("aplicarFiltrosEnriched", () => {
  it("filtros vacíos → no-op (lista intacta, mismo orden)", () => {
    const items = [mk("e1"), mk("e2"), mk("e3")];
    expect(aplicarFiltrosEnriched(items, {}, CTX_VACIO)).toEqual(items);
  });

  it("proveedorId narra", () => {
    const items = [mk("e1", { proveedorId: "pa" }), mk("e2", { proveedorId: "pb" })];
    expect(ids(aplicarFiltrosEnriched(items, { proveedorId: "pa" }, CTX_VACIO))).toEqual(["e1"]);
  });

  it("estado (membership) narra", () => {
    const items = [mk("e1", { estado: "EN_TRANSITO" }), mk("e2", { estado: "EN_PUERTO" })];
    expect(ids(aplicarFiltrosEnriched(items, { estado: ["EN_PUERTO"] }, CTX_VACIO))).toEqual(["e2"]);
  });

  it("ETA range narra; ETA nula se excluye cuando hay filtro de ETA", () => {
    const items = [
      mk("dentro", { fechaLlegada: new Date("2026-07-05T00:00:00.000Z") }),
      mk("nula", { fechaLlegada: null }),
      mk("fuera", { fechaLlegada: new Date("2026-08-10T00:00:00.000Z") }),
    ];
    const f = {
      etaDesde: new Date("2026-07-01T00:00:00.000Z"),
      etaHasta: new Date("2026-07-31T23:59:59.999Z"),
    };
    expect(ids(aplicarFiltrosEnriched(items, f, CTX_VACIO))).toEqual(["dentro"]);
  });

  it("foco=criticos usa clasificarSeveridad (bloqueo / ETA overdue)", () => {
    const items = [
      mk("bloq", { bloqueo: "Pago local vencido" }),
      mk("overdue", { etaTono: "overdue" }),
      mk("ok", { etaTono: "soon" }),
    ];
    expect(ids(aplicarFiltrosEnriched(items, { foco: "criticos" }, CTX_VACIO))).toEqual([
      "bloq",
      "overdue",
    ]);
  });

  it("foco=sin-actualizar usa bandDiasSinActualizacion (>5d)", () => {
    const items = [
      mk("viejo", { updatedAt: diasAtras(10) }),
      mk("fresco", { updatedAt: diasAtras(1) }),
    ];
    expect(ids(aplicarFiltrosEnriched(items, { foco: "sin-actualizar" }, CTX_VACIO))).toEqual([
      "viejo",
    ]);
  });

  it("foco=pagos narra por membership de pagosEmbarqueIds", () => {
    const items = [mk("e1"), mk("e2"), mk("e3")];
    const ctx = { now: NOW, pagosEmbarqueIds: new Set(["e2"]) };
    expect(ids(aplicarFiltrosEnriched(items, { foco: "pagos" }, ctx))).toEqual(["e2"]);
  });

  it("dimensiones componen en AND", () => {
    const items = [
      mk("match", { proveedorId: "pa", estado: "EN_PUERTO" }),
      mk("otroProv", { proveedorId: "pb", estado: "EN_PUERTO" }),
      mk("otroEstado", { proveedorId: "pa", estado: "EN_TRANSITO" }),
    ];
    const out = aplicarFiltrosEnriched(items, { proveedorId: "pa", estado: ["EN_PUERTO"] }, CTX_VACIO);
    expect(ids(out)).toEqual(["match"]);
  });
});
