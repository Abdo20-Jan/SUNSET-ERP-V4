import { afterEach, describe, expect, it, vi } from "vitest";

// CONT-01 / PR-028 — proyección read-only de la worklist de asientos.
// Verifica: (i) mapeo EXACTO vista→where (traba `automaticos`=TESORERIA+GASTO,
// partición limpia — cambiarlo es 1 línea + este test); (ii) composición del
// where (período + fechas + cuenta via lineas.some); (iii) cap/truncado +
// serialización + merge del doc de origen (bi-drill-down reusado, jamás
// re-derivado); (iv) KPIs por estado sobre el where SIN vista (canon fin-cxc);
// (v) helpers puros de presentación (vista default, período default,
// predicados de acción — espejo de la RowActions legada).

const h = vi.hoisted(() => ({
  findMany: vi.fn(),
  count: vi.fn(),
  groupBy: vi.fn(),
  docsPorAsiento: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: { asiento: { findMany: h.findMany, count: h.count, groupBy: h.groupBy } },
}));
vi.mock("@/lib/services/bi-drill-down", () => ({
  documentosOrigenPorAsiento: h.docsPorAsiento,
}));

import { Prisma } from "@/generated/prisma/client";
import {
  ASIENTOS_WORKLIST_MAX,
  buildWhereAsientos,
  listarAsientosWorklist,
  whereDeVista,
} from "@/lib/services/asientos-worklist";
import {
  periodoQueContiene,
  puedeAnular,
  puedeContabilizar,
  resolverAsientosVista,
  resolverPeriodoDefault,
} from "@/app/(dashboard)/contabilidad/asientos/asientos-presentacion";

const ASIENTO_DB = {
  id: "a1",
  numero: 7,
  fecha: new Date("2026-06-15T00:00:00.000Z"),
  descripcion: "Venta contado",
  estado: "CONTABILIZADO",
  origen: "TESORERIA",
  moneda: "ARS",
  totalDebe: new Prisma.Decimal("1500.5"),
  totalHaber: new Prisma.Decimal("1500.5"),
  periodo: { codigo: "2026-06", estado: "ABIERTO" },
};

const DOC_VENTA = { tipo: "venta", id: "v1", href: "/ventas/v1", etiqueta: "Venta" };

afterEach(() => vi.clearAllMocks());

describe("asientos-presentacion · helpers puros", () => {
  it("resolverAsientosVista: default/inválido → todos; tokens válidos pasan", () => {
    expect(resolverAsientosVista(undefined)).toBe("todos");
    expect(resolverAsientosVista("cualquiera")).toBe("todos");
    expect(resolverAsientosVista("manuales")).toBe("manuales");
    expect(resolverAsientosVista("anulados")).toBe("anulados");
  });

  it("predicados de acción espejan la RowActions legada", () => {
    expect(puedeContabilizar("BORRADOR")).toBe(true);
    expect(puedeContabilizar("CONTABILIZADO")).toBe(false);
    expect(puedeAnular("CONTABILIZADO")).toBe(true);
    expect(puedeAnular("ANULADO")).toBe(false);
  });

  const PERIODOS = [
    {
      id: 2,
      codigo: "2026-06",
      nombre: "Junio",
      estado: "ABIERTO" as const,
      fechaInicio: "2026-06-01T00:00:00.000Z",
      fechaFin: "2026-06-30T23:59:59.999Z",
    },
    {
      id: 1,
      codigo: "2026-05",
      nombre: "Mayo",
      estado: "CERRADO" as const,
      fechaInicio: "2026-05-01T00:00:00.000Z",
      fechaFin: "2026-05-31T23:59:59.999Z",
    },
  ];

  it("periodoQueContiene / resolverPeriodoDefault: el período que contiene hoy", () => {
    expect(periodoQueContiene(PERIODOS, "2026-06-15")?.id).toBe(2);
    expect(resolverPeriodoDefault(PERIODOS, "2026-06-15")?.id).toBe(2);
  });

  it("resolverPeriodoDefault: sin período que contenga hoy → el más reciente", () => {
    expect(resolverPeriodoDefault(PERIODOS, "2026-09-01")?.id).toBe(2);
  });

  it("resolverPeriodoDefault: lista vacía → null", () => {
    expect(resolverPeriodoDefault([], "2026-06-15")).toBeNull();
  });
});

describe("whereDeVista · mapeo exacto (partición limpia por origen)", () => {
  it("todos → {}", () => {
    expect(whereDeVista("todos")).toEqual({});
  });
  it("manuales → origen MANUAL", () => {
    expect(whereDeVista("manuales")).toEqual({ origen: "MANUAL" });
  });
  it("automaticos → TESORERIA+GASTO (disjunto de comex/ajustes)", () => {
    expect(whereDeVista("automaticos")).toEqual({ origen: { in: ["TESORERIA", "GASTO"] } });
  });
  it("comex → origen COMEX", () => {
    expect(whereDeVista("comex")).toEqual({ origen: "COMEX" });
  });
  it("ajustes → origen AJUSTE", () => {
    expect(whereDeVista("ajustes")).toEqual({ origen: "AJUSTE" });
  });
  it("anulados → estado ANULADO (corte ortogonal, no filtra origen)", () => {
    expect(whereDeVista("anulados")).toEqual({ estado: "ANULADO" });
  });
});

describe("buildWhereAsientos · composición", () => {
  it("compone vista + período + rango de fechas + cuenta (lineas.some)", () => {
    const where = buildWhereAsientos({
      vista: "anulados",
      periodoId: 4,
      fechaDesde: new Date("2026-06-01T00:00:00.000Z"),
      fechaHasta: new Date("2026-06-30T23:59:59.999Z"),
      cuentaId: 42,
    });
    expect(where).toEqual({
      estado: "ANULADO",
      periodoId: 4,
      fecha: {
        gte: new Date("2026-06-01T00:00:00.000Z"),
        lte: new Date("2026-06-30T23:59:59.999Z"),
      },
      lineas: { some: { cuentaId: 42 } },
    });
  });

  it("sin filtros opcionales: sólo el fragmento de la vista", () => {
    expect(buildWhereAsientos({ vista: "todos" })).toEqual({});
  });
});

describe("listarAsientosWorklist · proyección", () => {
  function armarMocks(overrides?: { total?: number }) {
    h.findMany.mockResolvedValue([ASIENTO_DB]);
    h.count.mockResolvedValue(overrides?.total ?? 1);
    h.groupBy.mockResolvedValue([
      { estado: "BORRADOR", _count: { _all: 2 } },
      { estado: "CONTABILIZADO", _count: { _all: 5 } },
    ]);
    h.docsPorAsiento.mockResolvedValue(new Map([["a1", DOC_VENTA]]));
  }

  it("serializa la fila (ISO, toFixed) y mergea el doc de origen del batch", async () => {
    armarMocks();

    const res = await listarAsientosWorklist({ vista: "todos", periodoId: 4 });

    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({
      id: "a1",
      numero: 7,
      fecha: "2026-06-15T00:00:00.000Z",
      periodoCodigo: "2026-06",
      periodoEstado: "ABIERTO",
      totalDebe: "1500.50",
      totalHaber: "1500.50",
      doc: DOC_VENTA,
    });
    expect(h.docsPorAsiento).toHaveBeenCalledWith(["a1"]);
    // Cap del fetch período-bounded.
    expect(h.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: ASIENTOS_WORKLIST_MAX }),
    );
    expect(res.truncado).toBe(false);
  });

  it("expone truncado=true honesto cuando total excede las filas devueltas", async () => {
    armarMocks({ total: 5000 });

    const res = await listarAsientosWorklist({ vista: "todos" });

    expect(res.total).toBe(5000);
    expect(res.truncado).toBe(true);
  });

  it("KPIs por estado se cuentan sobre el where SIN vista (canon fin-cxc)", async () => {
    armarMocks();

    const res = await listarAsientosWorklist({ vista: "anulados", periodoId: 4 });

    // El groupBy NO lleva el corte de la vista (estado ANULADO) — sólo período.
    expect(h.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { periodoId: 4 } }));
    expect(res.kpis).toEqual({ borradores: 2, contabilizados: 5, anulados: 0 });
  });

  it("asiento sin documento de origen viaja doc=null", async () => {
    armarMocks();
    h.docsPorAsiento.mockResolvedValue(new Map([["a1", null]]));

    const res = await listarAsientosWorklist({ vista: "todos" });

    expect(res.rows[0].doc).toBeNull();
  });
});
