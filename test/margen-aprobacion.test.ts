import { afterEach, describe, expect, it, vi } from "vitest";

// PR-014 (COM-05): faixas de margen baja + gate de emisión. Las funciones puras
// (faixas/margen) se testean directo; el gate con mock de `@/lib/db` y
// `@/lib/features` (unit, sin Docker), espejando ventas-costo-masking.test.ts.

import Decimal from "decimal.js";
import { EstadoSolicitud, TipoAprobacion } from "@/generated/prisma/enums";

import {
  calcularMargenNetoVenta,
  resolverFaixaMargen,
  sumarCostoItems,
  tiposMargenAlMenos,
} from "@/lib/services/margen-aprobacion-faixas";

// ── Faixas (CRIT-03): el borde pertenece al tier MÁS severo ───────────────────

describe("resolverFaixaMargen · faixas y bordes (CRIT-03)", () => {
  it("sobre el piso (>= 0%) ⇒ null", () => {
    expect(resolverFaixaMargen(50)).toBeNull();
    expect(resolverFaixaMargen(0.01)).toBeNull();
    expect(resolverFaixaMargen(0)).toBeNull();
  });

  it("(-5, 0) ⇒ MARGEN_BAJA_5", () => {
    expect(resolverFaixaMargen(-0.01)?.tipo).toBe(TipoAprobacion.MARGEN_BAJA_5);
    expect(resolverFaixaMargen(-4.99)?.tipo).toBe(TipoAprobacion.MARGEN_BAJA_5);
  });

  it("borde -5.00 y (-10,-5] ⇒ MARGEN_BAJA_10", () => {
    expect(resolverFaixaMargen(-5)?.tipo).toBe(TipoAprobacion.MARGEN_BAJA_10);
    expect(resolverFaixaMargen(-9.99)?.tipo).toBe(TipoAprobacion.MARGEN_BAJA_10);
  });

  it("borde -10.00 y (-15,-10] ⇒ MARGEN_BAJA_MAYOR_10 (sin Master)", () => {
    expect(resolverFaixaMargen(-10)?.tipo).toBe(TipoAprobacion.MARGEN_BAJA_MAYOR_10);
    expect(resolverFaixaMargen(-10)?.requiereMaster).toBe(false);
    expect(resolverFaixaMargen(-14.99)?.tipo).toBe(TipoAprobacion.MARGEN_BAJA_MAYOR_10);
    expect(resolverFaixaMargen(-14.99)?.requiereMaster).toBe(false);
  });

  it("<= -15 ⇒ MARGEN_BAJA_MAYOR_10 con requiereMaster (doc-only)", () => {
    expect(resolverFaixaMargen(-15)?.tipo).toBe(TipoAprobacion.MARGEN_BAJA_MAYOR_10);
    expect(resolverFaixaMargen(-15)?.requiereMaster).toBe(true);
    expect(resolverFaixaMargen(-30)?.requiereMaster).toBe(true);
  });

  it("acepta Decimal además de number", () => {
    expect(resolverFaixaMargen(new Decimal("-7.5"))?.tipo).toBe(TipoAprobacion.MARGEN_BAJA_10);
  });
});

// ── Match por conjunto de severidad ───────────────────────────────────────────

describe("tiposMargenAlMenos · cobertura por severidad", () => {
  it("BAJA_5 ⇒ [BAJA_5, BAJA_10, MAYOR_10]", () => {
    expect(tiposMargenAlMenos(TipoAprobacion.MARGEN_BAJA_5)).toEqual([
      TipoAprobacion.MARGEN_BAJA_5,
      TipoAprobacion.MARGEN_BAJA_10,
      TipoAprobacion.MARGEN_BAJA_MAYOR_10,
    ]);
  });
  it("BAJA_10 ⇒ [BAJA_10, MAYOR_10]", () => {
    expect(tiposMargenAlMenos(TipoAprobacion.MARGEN_BAJA_10)).toEqual([
      TipoAprobacion.MARGEN_BAJA_10,
      TipoAprobacion.MARGEN_BAJA_MAYOR_10,
    ]);
  });
  it("MAYOR_10 ⇒ [MAYOR_10]", () => {
    expect(tiposMargenAlMenos(TipoAprobacion.MARGEN_BAJA_MAYOR_10)).toEqual([
      TipoAprobacion.MARGEN_BAJA_MAYOR_10,
    ]);
  });
});

// ── Margen neto (espelha venta-form) ──────────────────────────────────────────

describe("calcularMargenNetoVenta · espelha venta-form", () => {
  it("ganancia con provisión 35% aplicada (bruta > 0)", () => {
    // bruta = 1000 - 500 - 50 - 50 = 400; provisión = 140; neta = 260; pct = 26.00
    const pct = calcularMargenNetoVenta({
      subtotal: 1000,
      costoTotal: 500,
      flete: 50,
      percepcionIIBB: 50,
    });
    expect(pct.toFixed(2)).toBe("26.00");
    expect(resolverFaixaMargen(pct)).toBeNull();
  });

  it("pérdida exacta -10% ⇒ MAYOR_10 (sin provisión si bruta <= 0)", () => {
    const pct = calcularMargenNetoVenta({
      subtotal: 1000,
      costoTotal: 1100,
      flete: 0,
      percepcionIIBB: 0,
    });
    expect(pct.toFixed(2)).toBe("-10.00");
    expect(resolverFaixaMargen(pct)?.tipo).toBe(TipoAprobacion.MARGEN_BAJA_MAYOR_10);
  });

  it("flete/percepción empujan a pérdida -5% ⇒ BAJA_10", () => {
    // bruta = 1000 - 1000 - 50 - 0 = -50; neta = -50; pct = -5.00
    const pct = calcularMargenNetoVenta({
      subtotal: 1000,
      costoTotal: 1000,
      flete: 50,
      percepcionIIBB: 0,
    });
    expect(pct.toFixed(2)).toBe("-5.00");
    expect(resolverFaixaMargen(pct)?.tipo).toBe(TipoAprobacion.MARGEN_BAJA_10);
  });

  it("subtotal 0 ⇒ 0%", () => {
    expect(
      calcularMargenNetoVenta({ subtotal: 0, costoTotal: 0, flete: 0, percepcionIIBB: 0 }).toFixed(
        2,
      ),
    ).toBe("0.00");
  });
});

describe("sumarCostoItems · sin redondeo intermedio", () => {
  it("acumula costo crudo (no redondea a 2dp)", () => {
    expect(sumarCostoItems([{ cantidad: 3, costoPromedio: "33.335" }]).toString()).toBe("100.005");
  });
  it("costoPromedio 0 ⇒ aporta 0", () => {
    expect(sumarCostoItems([{ cantidad: 5, costoPromedio: "0" }]).toString()).toBe("0");
  });
});

// ── Gate de emisión (mock db + features) ──────────────────────────────────────

const h = vi.hoisted(() => ({
  isApprovalsEnabled: vi.fn(),
  ventaFindUnique: vi.fn(),
  solicitudFindFirst: vi.fn(),
}));

vi.mock("@/lib/features", () => ({ isApprovalsEnabled: h.isApprovalsEnabled }));
vi.mock("@/lib/db", () => ({
  db: {
    venta: { findUnique: h.ventaFindUnique },
    solicitud: { findFirst: h.solicitudFindFirst },
  },
}));

import { verificarAprobacionMargenVenta } from "@/lib/services/margen-aprobacion";

const dec = (s: string) => ({ toString: () => s });

// Venta con cantidad 1 ⇒ costoTotal == costoPromedio (simplifica los escenarios).
function ventaRow(args: { subtotal: string; costoTotal: string; flete?: string; percep?: string }) {
  return {
    subtotal: dec(args.subtotal),
    flete: dec(args.flete ?? "0"),
    percepcionIIBB: dec(args.percep ?? "0"),
    items: [{ cantidad: 1, producto: { costoPromedio: dec(args.costoTotal) } }],
  };
}

afterEach(() => vi.clearAllMocks());

describe("verificarAprobacionMargenVenta · gate de emisión", () => {
  it("flag OFF ⇒ ok sin tocar la DB (INERTE)", async () => {
    h.isApprovalsEnabled.mockReturnValue(false);

    const r = await verificarAprobacionMargenVenta("v1");

    expect(r).toEqual({ ok: true });
    expect(h.ventaFindUnique).not.toHaveBeenCalled();
    expect(h.solicitudFindFirst).not.toHaveBeenCalled();
  });

  it("flag ON, sobre el piso ⇒ ok sin consultar solicitudes", async () => {
    h.isApprovalsEnabled.mockReturnValue(true);
    h.ventaFindUnique.mockResolvedValue(ventaRow({ subtotal: "1000", costoTotal: "500" }));

    const r = await verificarAprobacionMargenVenta("v1");

    expect(r).toEqual({ ok: true });
    expect(h.solicitudFindFirst).not.toHaveBeenCalled();
  });

  it("venta inexistente ⇒ ok (lo maneja el guard propio del emit)", async () => {
    h.isApprovalsEnabled.mockReturnValue(true);
    h.ventaFindUnique.mockResolvedValue(null);

    const r = await verificarAprobacionMargenVenta("v1");

    expect(r).toEqual({ ok: true });
    expect(h.solicitudFindFirst).not.toHaveBeenCalled();
  });

  it("bajo el piso sin solicitud APROBADA ⇒ bloquea", async () => {
    h.isApprovalsEnabled.mockReturnValue(true);
    h.ventaFindUnique.mockResolvedValue(ventaRow({ subtotal: "1000", costoTotal: "1070" })); // -7% ⇒ BAJA_10
    h.solicitudFindFirst.mockResolvedValue(null);

    const r = await verificarAprobacionMargenVenta("v1");

    expect(r.ok).toBe(false);
    // sólo busca estado APROBADA, y por el conjunto [BAJA_10, MAYOR_10]
    const where = h.solicitudFindFirst.mock.calls[0][0].where;
    expect(where.estado).toBe(EstadoSolicitud.APROBADA);
    expect(where.tipo.in).toEqual([
      TipoAprobacion.MARGEN_BAJA_10,
      TipoAprobacion.MARGEN_BAJA_MAYOR_10,
    ]);
  });

  it("bajo el piso con APROBADA del tipo exacto ⇒ permite", async () => {
    h.isApprovalsEnabled.mockReturnValue(true);
    h.ventaFindUnique.mockResolvedValue(ventaRow({ subtotal: "1000", costoTotal: "1070" })); // -7% ⇒ BAJA_10
    h.solicitudFindFirst.mockResolvedValue({ id: "s1" });

    const r = await verificarAprobacionMargenVenta("v1");

    expect(r).toEqual({ ok: true });
  });

  it("APROBADA de un tier MÁS severo cubre (sobre-aprobación)", async () => {
    h.isApprovalsEnabled.mockReturnValue(true);
    h.ventaFindUnique.mockResolvedValue(ventaRow({ subtotal: "1000", costoTotal: "1030" })); // -3% ⇒ BAJA_5
    h.solicitudFindFirst.mockResolvedValue({ id: "s1" }); // simula una APROBADA MAYOR_10 matcheada por el `in`

    const r = await verificarAprobacionMargenVenta("v1");

    expect(r).toEqual({ ok: true });
    expect(h.solicitudFindFirst.mock.calls[0][0].where.tipo.in).toEqual([
      TipoAprobacion.MARGEN_BAJA_5,
      TipoAprobacion.MARGEN_BAJA_10,
      TipoAprobacion.MARGEN_BAJA_MAYOR_10,
    ]);
  });

  it("sub-aprobación (margen peor que lo aprobado) ⇒ bloquea", async () => {
    h.isApprovalsEnabled.mockReturnValue(true);
    h.ventaFindUnique.mockResolvedValue(ventaRow({ subtotal: "1000", costoTotal: "1120" })); // -12% ⇒ MAYOR_10
    h.solicitudFindFirst.mockResolvedValue(null); // una APROBADA BAJA_5 no entra en [MAYOR_10]

    const r = await verificarAprobacionMargenVenta("v1");

    expect(r.ok).toBe(false);
    expect(h.solicitudFindFirst.mock.calls[0][0].where.tipo.in).toEqual([
      TipoAprobacion.MARGEN_BAJA_MAYOR_10,
    ]);
  });
});
