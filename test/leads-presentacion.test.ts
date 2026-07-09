import { describe, expect, it } from "vitest";

import type { LeadRow } from "@/lib/actions/leads";
import {
  type ActividadSeguimientoLike,
  buildLeadsHref,
  derivarSeguimiento,
  esSinFollowUp,
  flattenLeads,
  resolverVista,
} from "@/app/(dashboard)/crm/leads/_components/leads-presentacion";

// Helpers PUROS de presentación de la worklist de leads (CRM-01 · PR-030).
// El seguimiento se DERIVA de Actividad (el Lead no tiene campo
// proximaAccion/últimoContacto); `esSinFollowUp` es el espejo puro del
// predicado SQL de `listarLeadsSinFollowUp` (lead-seguimiento.ts).

const AHORA = new Date("2026-07-09T12:00:00.000Z");

function dias(n: number): Date {
  return new Date(AHORA.getTime() - n * 86_400_000);
}

function act(over: Partial<ActividadSeguimientoLike>): ActividadSeguimientoLike {
  return {
    leadId: "l1",
    tipo: "NOTA",
    completada: false,
    fechaProgramada: null,
    fechaCompletada: null,
    ...over,
  };
}

function lead(over: Partial<LeadRow>): LeadRow {
  return {
    id: "l1",
    nombre: "Lead Uno",
    empresa: "Empresa SA",
    cuit: "30-11111111-1",
    email: "uno@test.com",
    telefono: "1111",
    fuente: "ORGANICO",
    estado: "NUEVO",
    score: 40,
    ownerId: "u1",
    ownerNombre: "Ana",
    clienteId: null,
    clienteNombre: null,
    notas: null,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-02T00:00:00.000Z"),
    ...over,
  };
}

describe("resolverVista", () => {
  it("cae en 'todos' con param ausente o desconocido", () => {
    expect(resolverVista(undefined)).toBe("todos");
    expect(resolverVista("")).toBe("todos");
    expect(resolverVista("xxx")).toBe("todos");
    expect(resolverVista("todos")).toBe("todos");
  });

  it("acepta las vistas oficiales", () => {
    expect(resolverVista("mios")).toBe("mios");
    expect(resolverVista("sin-follow-up")).toBe("sin-follow-up");
  });
});

describe("derivarSeguimiento", () => {
  it("próxima acción = pendiente con MENOR fechaProgramada (con su tipo)", () => {
    const seg = derivarSeguimiento([
      act({ tipo: "LLAMADA", fechaProgramada: new Date("2026-07-15T00:00:00.000Z") }),
      act({ tipo: "REUNION", fechaProgramada: new Date("2026-07-11T00:00:00.000Z") }),
      act({ tipo: "EMAIL", fechaProgramada: new Date("2026-07-20T00:00:00.000Z") }),
    ]).get("l1");
    expect(seg?.tienePendiente).toBe(true);
    expect(seg?.proximaAccionFecha?.toISOString()).toBe("2026-07-11T00:00:00.000Z");
    expect(seg?.proximaAccionTipo).toBe("REUNION");
  });

  it("pendiente SIN fecha marca tienePendiente sin fecha propia", () => {
    const seg = derivarSeguimiento([act({ tipo: "TAREA" })]).get("l1");
    expect(seg?.tienePendiente).toBe(true);
    expect(seg?.proximaAccionFecha).toBeNull();
    expect(seg?.proximaAccionTipo).toBeNull();
  });

  it("último contacto = completada con MAYOR fechaCompletada (con su tipo)", () => {
    const seg = derivarSeguimiento([
      act({ tipo: "EMAIL", completada: true, fechaCompletada: dias(10) }),
      act({ tipo: "WHATSAPP", completada: true, fechaCompletada: dias(2) }),
      act({ tipo: "LLAMADA", completada: true, fechaCompletada: dias(5) }),
    ]).get("l1");
    expect(seg?.tienePendiente).toBe(false);
    expect(seg?.ultimoContactoFecha?.toISOString()).toBe(dias(2).toISOString());
    expect(seg?.ultimoContactoTipo).toBe("WHATSAPP");
  });

  it("agrupa por lead e ignora actividades sin leadId", () => {
    const map = derivarSeguimiento([
      act({ leadId: "l1" }),
      act({ leadId: "l2", completada: true, fechaCompletada: dias(1), tipo: "LLAMADA" }),
      act({ leadId: null }),
    ]);
    expect(map.size).toBe(2);
    expect(map.get("l1")?.tienePendiente).toBe(true);
    expect(map.get("l2")?.ultimoContactoTipo).toBe("LLAMADA");
  });
});

describe("esSinFollowUp (espejo puro del predicado SQL)", () => {
  it("estados fuera del funnel → false aunque no haya contacto", () => {
    expect(esSinFollowUp(undefined, "DESCALIFICADO", AHORA)).toBe(false);
    expect(esSinFollowUp(undefined, "CONVERTIDO", AHORA)).toBe(false);
  });

  it("con actividad pendiente → false (ya hay follow-up planificado)", () => {
    const seg = derivarSeguimiento([act({})]).get("l1");
    expect(esSinFollowUp(seg, "NUEVO", AHORA)).toBe(false);
  });

  it("contacto completado hace 6 días → false", () => {
    const seg = derivarSeguimiento([act({ completada: true, fechaCompletada: dias(6) })]).get("l1");
    expect(esSinFollowUp(seg, "CONTACTADO", AHORA)).toBe(false);
  });

  it("contacto completado hace 8 días → true", () => {
    const seg = derivarSeguimiento([act({ completada: true, fechaCompletada: dias(8) })]).get("l1");
    expect(esSinFollowUp(seg, "CONTACTADO", AHORA)).toBe(true);
  });

  it("boundary: contacto EXACTAMENTE hace 7 días → false (gte del SQL)", () => {
    const seg = derivarSeguimiento([act({ completada: true, fechaCompletada: dias(7) })]).get("l1");
    expect(esSinFollowUp(seg, "CALIFICADO", AHORA)).toBe(false);
  });

  it("nunca contactado y sin pendientes → true (en estado activo)", () => {
    expect(esSinFollowUp(undefined, "NUEVO", AHORA)).toBe(true);
    expect(esSinFollowUp(undefined, "CONTACTADO", AHORA)).toBe(true);
    expect(esSinFollowUp(undefined, "CALIFICADO", AHORA)).toBe(true);
  });
});

describe("flattenLeads", () => {
  it("proyecta 1:1 preservando el orden", () => {
    const rows = [lead({ id: "a", nombre: "A" }), lead({ id: "b", nombre: "B" })];
    const flat = flattenLeads(rows, new Map(), AHORA);
    expect(flat).toHaveLength(2);
    expect(flat.map((r) => r.id)).toEqual(["a", "b"]);
    expect(flat[0]?.nombre).toBe("A");
    expect(flat[0]?.createdAt).toBe("2026-07-01T00:00:00.000Z");
  });

  it("lead sin seguimiento → nulls, sin pendiente y sinFollowUp según estado", () => {
    const [activo, convertido] = flattenLeads(
      [lead({ id: "a", estado: "NUEVO" }), lead({ id: "b", estado: "CONVERTIDO" })],
      new Map(),
      AHORA,
    );
    expect(activo?.proximaAccionFecha).toBeNull();
    expect(activo?.proximaAccionTipo).toBeNull();
    expect(activo?.ultimoContactoFecha).toBeNull();
    expect(activo?.ultimoContactoTipo).toBeNull();
    expect(activo?.tienePendiente).toBe(false);
    expect(activo?.sinFollowUp).toBe(true);
    expect(convertido?.sinFollowUp).toBe(false);
  });

  it("inyecta el seguimiento derivado del lead correspondiente", () => {
    const seguimiento = derivarSeguimiento([
      act({ leadId: "a", tipo: "LLAMADA", fechaProgramada: new Date("2026-07-12T00:00:00.000Z") }),
      act({ leadId: "a", tipo: "EMAIL", completada: true, fechaCompletada: dias(3) }),
    ]);
    const [a, b] = flattenLeads([lead({ id: "a" }), lead({ id: "b" })], seguimiento, AHORA);
    expect(a?.tienePendiente).toBe(true);
    expect(a?.proximaAccionFecha).toBe("2026-07-12T00:00:00.000Z");
    expect(a?.proximaAccionTipo).toBe("LLAMADA");
    expect(a?.ultimoContactoTipo).toBe("EMAIL");
    expect(a?.sinFollowUp).toBe(false);
    expect(b?.tienePendiente).toBe(false);
  });
});

describe("buildLeadsHref", () => {
  it("sin filtros → ruta limpia (omite defaults)", () => {
    expect(buildLeadsHref({})).toBe("/crm/leads");
    expect(buildLeadsHref({ vista: "todos", perPage: "50" })).toBe("/crm/leads");
  });

  it("serializa vista/q/estado/fuente/perPage no-default y NUNCA lleva page", () => {
    const href = buildLeadsHref({
      vista: "sin-follow-up",
      q: "acme",
      estado: "NUEVO",
      fuente: "FERIA",
      perPage: "100",
    });
    expect(href).toBe("/crm/leads?vista=sin-follow-up&q=acme&estado=NUEVO&fuente=FERIA&perPage=100");
    expect(href).not.toContain("page=1");
  });

  it("vista sola", () => {
    expect(buildLeadsHref({ vista: "mios" })).toBe("/crm/leads?vista=mios");
  });
});
