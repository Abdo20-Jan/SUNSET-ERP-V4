import { describe, expect, it } from "vitest";
import { AuditAccion, AuditOrigen, EstadoSolicitud } from "@/generated/prisma/enums";
import {
  addHoras,
  aplicarDupla,
  aprobacionesRequeridas,
  auditDeAprobacion,
  type BandaSla,
  bandaDeFraccion,
  computeHito,
  escalarUnNivel,
  ventanaHoras,
} from "./aprobaciones-helpers";

const T0 = new Date("2026-06-25T00:00:00.000Z");
const H = 3_600_000;

describe("addHoras", () => {
  it("suma horas sin mutar la base", () => {
    const r = addHoras(T0, 48);
    expect(r.toISOString()).toBe("2026-06-27T00:00:00.000Z");
    expect(T0.toISOString()).toBe("2026-06-25T00:00:00.000Z");
  });

  it("acepta fracciones de hora", () => {
    expect(addHoras(T0, 0.5).toISOString()).toBe("2026-06-25T00:30:00.000Z");
  });
});

describe("bandaDeFraccion", () => {
  it.each<[number, BandaSla]>([
    [0, 0],
    [0.49, 0],
    [0.5, 50],
    [0.74, 50],
    [0.75, 75],
    [0.99, 75],
    [1, 100],
    [1.5, 100],
  ])("pct %s → banda %s", (pct, banda) => {
    expect(bandaDeFraccion(pct)).toBe(banda);
  });
});

describe("ventanaHoras", () => {
  it("nivel 0 = SLA completo; nivel > 0 = la mitad", () => {
    expect(ventanaHoras(48, 0)).toBe(48);
    expect(ventanaHoras(48, 1)).toBe(24);
    expect(ventanaHoras(48, 2)).toBe(24);
  });
});

describe("computeHito", () => {
  it("a mitad de la ventana base → banda 50", () => {
    const venceEn = addHoras(T0, 48);
    expect(
      computeHito({ venceEn, slaHoras: 48, nivelEscalonamiento: 0, ahora: addHoras(T0, 24) }).banda,
    ).toBe(50);
  });

  it("vencido → banda 100", () => {
    const venceEn = addHoras(T0, 48);
    expect(
      computeHito({ venceEn, slaHoras: 48, nivelEscalonamiento: 0, ahora: addHoras(T0, 60) }).banda,
    ).toBe(100);
  });

  it("tras escalar usa la media ventana (24h de un SLA de 48)", () => {
    const venceEn = addHoras(T0, 24);
    expect(
      computeHito({ venceEn, slaHoras: 48, nivelEscalonamiento: 1, ahora: addHoras(T0, 18) }).banda,
    ).toBe(75);
  });
});

describe("escalarUnNivel", () => {
  it("sube el nivel, deadline = ahora + SLA/2 y resetea el hito", () => {
    const ahora = addHoras(T0, 50);
    const patch = escalarUnNivel({ slaHoras: 48, nivelEscalonamiento: 0, ahora });
    expect(patch.nivelEscalonamiento).toBe(1);
    expect(patch.venceEn.getTime()).toBe(ahora.getTime() + 24 * H);
    expect(patch.ultimoHitoSla).toBe(0);
  });
});

describe("aprobacionesRequeridas / aplicarDupla", () => {
  it("requeridas: 1 simple, 2 dupla", () => {
    expect(aprobacionesRequeridas(false)).toBe(1);
    expect(aprobacionesRequeridas(true)).toBe(2);
  });

  it("simple: 1 aprobación distinta resuelve APROBADA", () => {
    expect(aplicarDupla(false, 1)).toEqual({ estado: EstadoSolicitud.APROBADA, resuelta: true });
  });

  it("dupla: 1 distinta sigue PENDIENTE, 2 distintas → APROBADA", () => {
    expect(aplicarDupla(true, 1)).toEqual({ estado: EstadoSolicitud.PENDIENTE, resuelta: false });
    expect(aplicarDupla(true, 2)).toEqual({ estado: EstadoSolicitud.APROBADA, resuelta: true });
  });
});

describe("auditDeAprobacion", () => {
  it("normal → APROBACION / MANUAL", () => {
    expect(auditDeAprobacion(false)).toEqual({
      accion: AuditAccion.APROBACION,
      origen: AuditOrigen.MANUAL,
    });
  });

  it("master override → MASTER_OVERRIDE / MASTER_OVERRIDE", () => {
    expect(auditDeAprobacion(true)).toEqual({
      accion: AuditAccion.MASTER_OVERRIDE,
      origen: AuditOrigen.MASTER_OVERRIDE,
    });
  });
});
