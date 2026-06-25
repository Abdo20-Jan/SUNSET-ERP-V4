import { describe, expect, it } from "vitest";

import { EstadoSolicitud, TipoAprobacion } from "@/generated/prisma/enums";
import {
  construirWhereAprobaciones,
  parseFiltros,
  whereDeFiltros,
  whereDeVista,
} from "@/lib/services/aprobaciones-filtros";

describe("parseFiltros (Central de Aprobaciones)", () => {
  it("default a vista=pendientes y descarta tipo/estado inválidos", () => {
    const f = parseFiltros({ tipo: "NOPE", estado: "XX" });
    expect(f.vista).toBe("pendientes");
    expect(f.tipo).toBeUndefined();
    expect(f.estado).toBeUndefined();
    expect(f.soloRiesgoSla).toBe(false);
  });

  it("acepta enums válidos y limpia strings vacíos", () => {
    const f = parseFiltros({
      vista: "resueltas",
      tipo: "MARGEN_BAJA_5",
      estado: "APROBADA",
      solicitante: " u1 ",
    });
    expect(f.vista).toBe("resueltas");
    expect(f.tipo).toBe(TipoAprobacion.MARGEN_BAJA_5);
    expect(f.estado).toBe(EstadoSolicitud.APROBADA);
    expect(f.solicitanteId).toBe("u1");
  });

  it("marca soloRiesgoSla para el preset por-vencer y para sla=riesgo", () => {
    expect(parseFiltros({ vista: "por-vencer" }).soloRiesgoSla).toBe(true);
    expect(parseFiltros({ sla: "riesgo" }).soloRiesgoSla).toBe(true);
    expect(parseFiltros({ sla: "otro" }).soloRiesgoSla).toBe(false);
  });

  it("vista desconocida cae al default pendientes", () => {
    expect(parseFiltros({ vista: "raras" }).vista).toBe("pendientes");
  });
});

describe("whereDeVista / whereDeFiltros", () => {
  it("presets abiertos vs resueltos", () => {
    expect(whereDeVista("pendientes")).toEqual({
      estado: { in: [EstadoSolicitud.PENDIENTE, EstadoSolicitud.SOLICITANDO_INFO] },
    });
    expect(whereDeVista("resueltas")).toEqual({
      estado: {
        in: [
          EstadoSolicitud.APROBADA,
          EstadoSolicitud.RECHAZADA,
          EstadoSolicitud.EXPIRADA,
          EstadoSolicitud.CANCELADA,
        ],
      },
    });
    expect(whereDeVista("todos")).toEqual({});
  });

  it("filtros explícitos arman el where plano", () => {
    const where = whereDeFiltros({
      vista: "todos",
      tipo: TipoAprobacion.PAGO_NORMAL,
      estado: EstadoSolicitud.PENDIENTE,
      solicitanteId: "u9",
      soloRiesgoSla: false,
    });
    expect(where).toEqual({
      tipo: TipoAprobacion.PAGO_NORMAL,
      estado: EstadoSolicitud.PENDIENTE,
      solicitanteId: "u9",
    });
  });
});

describe("construirWhereAprobaciones", () => {
  it("intersecta (AND) preset + filtros", () => {
    const where = construirWhereAprobaciones({
      vista: "pendientes",
      soloRiesgoSla: false,
    });
    const and = where.AND as unknown[];
    expect(and).toHaveLength(3);
    expect(and[0]).toEqual({
      estado: { in: [EstadoSolicitud.PENDIENTE, EstadoSolicitud.SOLICITANDO_INFO] },
    });
  });

  it("inyecta los tipos aprobables sólo en la vista mis-pendientes", () => {
    const where = construirWhereAprobaciones({ vista: "mis-pendientes", soloRiesgoSla: false }, [
      TipoAprobacion.MARGEN_BAJA_5,
      TipoAprobacion.PLAZO_ESPECIAL,
    ]);
    const and = where.AND as unknown[];
    expect(and[2]).toEqual({
      tipo: { in: [TipoAprobacion.MARGEN_BAJA_5, TipoAprobacion.PLAZO_ESPECIAL] },
    });
  });

  it("no inyecta tipos fuera de mis-pendientes", () => {
    const where = construirWhereAprobaciones({ vista: "pendientes", soloRiesgoSla: false }, [
      TipoAprobacion.MARGEN_BAJA_5,
    ]);
    const and = where.AND as unknown[];
    expect(and[2]).toEqual({});
  });
});
