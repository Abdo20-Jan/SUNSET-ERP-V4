import { beforeEach, describe, expect, it, vi } from "vitest";

// CONT-02 / PR-028 — wrapper CALL-only del Libro Mayor embebido. Verifica:
// (i) gate auth(); (ii) validación zod (fechas/cuentaId); (iii) mapeo de
// `LibroMayorError` a {ok:false} (el motor se LLAMA, jamás se toca); (iv) cap
// de display 500 + truncado/totalLineas honestos + docs SÓLO de las líneas
// visibles; (v) serialización Decimal→string y historial pass-through.

const h = vi.hoisted(() => {
  class LibroMayorError extends Error {
    constructor(
      public code: string,
      message: string,
    ) {
      super(message);
      this.name = "LibroMayorError";
    }
  }
  return {
    auth: vi.fn(),
    getLibroMayor: vi.fn(),
    LibroMayorError,
    docs: vi.fn(),
    auditLog: vi.fn(),
  };
});

vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/services/reportes", () => ({
  getLibroMayor: h.getLibroMayor,
  LibroMayorError: h.LibroMayorError,
}));
vi.mock("@/lib/services/bi-drill-down", () => ({ documentosOrigenPorAsiento: h.docs }));
vi.mock("@/lib/services/auditoria", () => ({ getAuditLog: h.auditLog }));

import { Prisma } from "@/generated/prisma/client";
import { getLibroMayorDetalle } from "@/lib/actions/libro-mayor-detalle";

function linea(n: number) {
  return {
    lineaId: n,
    fecha: new Date("2026-06-15T00:00:00.000Z"),
    asientoId: `as-${n}`,
    asientoNumero: n,
    asientoDescripcion: `Asiento ${n}`,
    descripcion: null,
    debe: new Prisma.Decimal("100.00"),
    haber: new Prisma.Decimal("0"),
    saldoAcumulado: new Prisma.Decimal(String(100 * n)),
    monedaOrigen: null,
    montoOrigen: null,
    tipoCambioOrigen: null,
  };
}

function mayorFixture(nLineas: number) {
  return {
    cuenta: { id: 42, codigo: "1.1.01", nombre: "Caja", tipo: "ANALITICA", categoria: "ACTIVO" },
    rango: { fechaDesde: null, fechaHasta: null },
    saldoInicial: new Prisma.Decimal("50.00"),
    lineas: Array.from({ length: nLineas }, (_, i) => linea(i + 1)),
    totalDebe: new Prisma.Decimal(String(100 * nLineas)),
    totalHaber: new Prisma.Decimal("0"),
    saldoFinal: new Prisma.Decimal(String(50 + 100 * nLineas)),
    saldoUsdFinal: null,
    totalUsdDebe: null,
    totalUsdHaber: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { id: "user-1" } });
  h.docs.mockResolvedValue(new Map());
  h.auditLog.mockResolvedValue([]);
});

describe("getLibroMayorDetalle · gates", () => {
  it("sin sesión niega sin llamar al motor", async () => {
    h.auth.mockResolvedValue(null);

    const res = await getLibroMayorDetalle({ cuentaId: 42 });

    expect(res.ok).toBe(false);
    expect(h.getLibroMayor).not.toHaveBeenCalled();
  });

  it("fechas inválidas → Datos inválidos (zod, sin llamar al motor)", async () => {
    const res = await getLibroMayorDetalle({ cuentaId: 42, desde: "2026-6-1" });

    expect(res).toEqual({ ok: false, error: "Datos inválidos." });
    expect(h.getLibroMayor).not.toHaveBeenCalled();
  });

  it("LibroMayorError (cuenta sintética) → {ok:false} con el mensaje del motor", async () => {
    h.getLibroMayor.mockRejectedValue(
      new h.LibroMayorError("CUENTA_NO_ANALITICA", "La cuenta 1.1 es sintética"),
    );

    const res = await getLibroMayorDetalle({ cuentaId: 42 });

    expect(res).toEqual({ ok: false, error: "La cuenta 1.1 es sintética" });
  });
});

describe("getLibroMayorDetalle · serialización + cap", () => {
  it("serializa Decimals/fechas, mergea docs y pasa el historial", async () => {
    h.getLibroMayor.mockResolvedValue(mayorFixture(2));
    h.docs.mockResolvedValue(
      new Map([["as-1", { tipo: "venta", id: "v1", href: "/ventas/v1", etiqueta: "Venta" }]]),
    );
    const entry = { id: 1, accion: "UPDATE", fecha: new Date(0), usuario: "Tester" };
    h.auditLog.mockResolvedValue([entry]);

    const res = await getLibroMayorDetalle({
      cuentaId: 42,
      desde: "2026-06-01",
      hasta: "2026-06-30",
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(h.getLibroMayor).toHaveBeenCalledWith(42, {
      fechaDesde: new Date("2026-06-01T00:00:00.000Z"),
      fechaHasta: new Date("2026-06-30T23:59:59.999Z"),
    });
    expect(res.detalle.saldoInicial).toBe("50.00");
    expect(res.detalle.totalDebe).toBe("200.00");
    expect(res.detalle.saldoFinal).toBe("250.00");
    expect(res.detalle.lineas[0]).toMatchObject({
      fecha: "2026-06-15",
      debe: "100.00",
      haber: "0.00",
      saldoAcumulado: "100.00",
      doc: { etiqueta: "Venta" },
    });
    expect(res.detalle.lineas[1].doc).toBeNull();
    expect(res.detalle.truncado).toBe(false);
    expect(res.detalle.totalLineas).toBe(2);
    expect(res.detalle.historial).toEqual([entry]);
    expect(h.auditLog).toHaveBeenCalledWith("CuentaContable", "42");
  });

  it("cap 500: trunca honesto y pide docs SÓLO de las líneas visibles", async () => {
    h.getLibroMayor.mockResolvedValue(mayorFixture(502));

    const res = await getLibroMayorDetalle({ cuentaId: 42 });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.detalle.lineas).toHaveLength(500);
    expect(res.detalle.truncado).toBe(true);
    expect(res.detalle.totalLineas).toBe(502);
    // Los totales NO se truncan — son los del motor (rango completo).
    expect(res.detalle.totalDebe).toBe("50200.00");
    const idsPedidos = h.docs.mock.calls[0][0] as string[];
    expect(idsPedidos).toHaveLength(500);
  });
});
