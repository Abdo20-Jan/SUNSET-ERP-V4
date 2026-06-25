import { describe, expect, it } from "vitest";

import { AuditAccion, AuditOrigen } from "@/generated/prisma/enums";
import {
  construirWhereAuditoria,
  parseFiltros,
  whereDeFiltros,
  whereDeVista,
} from "@/lib/services/auditoria-filtros";

describe("parseFiltros", () => {
  it("descarta acción/origen/vista inválidos (no rompe Prisma)", () => {
    const f = parseFiltros({ accion: "NOPE", origen: "XX", vista: "raras" });
    expect(f.accion).toBeUndefined();
    expect(f.origen).toBeUndefined();
    expect(f.vista).toBeUndefined();
  });

  it("acepta enums válidos y limpia strings vacíos", () => {
    const f = parseFiltros({
      accion: "EXPORTACION",
      origen: "MANUAL",
      usuario: " u1 ",
      motivo: "   ",
      tabla: "Cliente",
      vista: "exportaciones",
    });
    expect(f.accion).toBe(AuditAccion.EXPORTACION);
    expect(f.origen).toBe(AuditOrigen.MANUAL);
    expect(f.usuarioId).toBe("u1");
    expect(f.motivo).toBeUndefined();
    expect(f.tabla).toBe("Cliente");
    expect(f.vista).toBe("exportaciones");
  });

  it("parsea rango de fecha (inicio 00:00, fin 23:59)", () => {
    const f = parseFiltros({ desde: "2026-06-01", hasta: "2026-06-30" });
    expect(f.desde?.getFullYear()).toBe(2026);
    expect(f.desde?.getHours()).toBe(0);
    expect(f.hasta?.getHours()).toBe(23);
    expect(f.hasta?.getMinutes()).toBe(59);
  });

  it("fecha inválida → undefined", () => {
    expect(parseFiltros({ desde: "no-fecha" }).desde).toBeUndefined();
  });
});

describe("whereDeVista", () => {
  it("todos / sin vista → {}", () => {
    expect(whereDeVista(undefined)).toEqual({});
    expect(whereDeVista("todos")).toEqual({});
  });

  it("presets por acción", () => {
    expect(whereDeVista("exportaciones")).toEqual({ accion: AuditAccion.EXPORTACION });
    expect(whereDeVista("aprobaciones")).toEqual({ accion: AuditAccion.APROBACION });
    expect(whereDeVista("visualizaciones-sensibles")).toEqual({
      accion: AuditAccion.VISUALIZACION_SENSIBLE,
    });
  });

  it("eventos críticos = IN(MASTER_OVERRIDE, CANCELACION, DELETE)", () => {
    expect(whereDeVista("eventos-criticos")).toEqual({
      accion: { in: [AuditAccion.MASTER_OVERRIDE, AuditAccion.CANCELACION, AuditAccion.DELETE] },
    });
  });

  it("master overrides = acción OR origen MASTER_OVERRIDE", () => {
    expect(whereDeVista("master-overrides")).toEqual({
      OR: [{ accion: AuditAccion.MASTER_OVERRIDE }, { origen: AuditOrigen.MASTER_OVERRIDE }],
    });
  });
});

describe("whereDeFiltros", () => {
  it("vacío → {}", () => {
    expect(whereDeFiltros({})).toEqual({});
  });

  it("arma where con todos los campos", () => {
    const desde = new Date("2026-06-01T00:00:00");
    const hasta = new Date("2026-06-30T23:59:59.999");
    const where = whereDeFiltros({
      desde,
      hasta,
      usuarioId: "u1",
      tabla: "Cliente",
      accion: AuditAccion.UPDATE,
      origen: AuditOrigen.MANUAL,
      motivo: "cambio",
    });
    expect(where.fecha).toEqual({ gte: desde, lte: hasta });
    expect(where.usuarioId).toBe("u1");
    expect(where.tabla).toBe("Cliente");
    expect(where.accion).toBe(AuditAccion.UPDATE);
    expect(where.origen).toBe(AuditOrigen.MANUAL);
    expect(where.motivo).toEqual({ contains: "cambio", mode: "insensitive" });
  });

  it("solo desde → fecha.gte sin lte", () => {
    const desde = new Date("2026-06-01T00:00:00");
    expect(whereDeFiltros({ desde }).fecha).toEqual({ gte: desde });
  });
});

describe("construirWhereAuditoria", () => {
  it("intersección (AND) de la sub-vista con los filtros explícitos", () => {
    const where = construirWhereAuditoria({ vista: "exportaciones", usuarioId: "u1" });
    expect(where).toEqual({
      AND: [{ accion: AuditAccion.EXPORTACION }, { usuarioId: "u1" }],
    });
  });
});
