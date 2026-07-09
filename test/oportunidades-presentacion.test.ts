import { describe, expect, it } from "vitest";

// Helpers PUROS de la worklist de oportunidades (CRM-01 · PR-030): valor
// ponderado decimal exacto, derivación de próxima acción (first-wins sobre el
// orden nulls-last del servicio), presets de URL server-side (lección PR-010)
// y href canónico con defaults omitidos. La paridad grid↔export depende de
// estos mismos helpers.
import type { ActividadPendienteRow } from "@/lib/services/crm-proxima-accion";
import {
  armarWorklistRows,
  buildOportunidadesHref,
  calcularValorPonderado,
  derivarProximaAccionDeActividades,
  derivarProximaAccionPorOportunidad,
  derivarUltimoContacto,
  filtrarSinAccion,
  type OportunidadRow,
  parseEstadoParam,
  resolverFiltro,
  resolverVista,
} from "@/app/(dashboard)/crm/oportunidades/_components/oportunidades-presentacion";

function op(id: string, over: Partial<OportunidadRow> = {}): OportunidadRow {
  return {
    id,
    numero: `O-2026-${id}`,
    titulo: `Oportunidad ${id}`,
    monto: "1000.00",
    moneda: "USD",
    stageId: "st-1",
    stageNombre: "Prospección",
    stageOrden: 1,
    probabilidad: 50,
    cierreEstimado: null,
    estado: "ABIERTA",
    leadId: null,
    leadNombre: null,
    leadEmpresa: null,
    clienteId: "cli-1",
    clienteNombre: "Cliente SA",
    ownerId: "u-1",
    ownerNombre: "Vendedor",
    notas: null,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    ...over,
  };
}

function pendiente(
  oportunidadId: string,
  fecha: string | null,
  over: Partial<ActividadPendienteRow> = {},
): ActividadPendienteRow {
  return {
    oportunidadId,
    tipo: "LLAMADA",
    contenido: "Llamar al cliente",
    fechaProgramada: fecha ? new Date(fecha) : null,
    ...over,
  };
}

describe("calcularValorPonderado", () => {
  it("decimal exacto a 2 decimales: 1000.55 × 33% = 330.18", () => {
    expect(calcularValorPonderado("1000.55", 33)).toBe("330.18");
  });

  it("0% → 0.00", () => {
    expect(calcularValorPonderado("1000.55", 0)).toBe("0.00");
  });

  it("100% → passthrough del monto", () => {
    expect(calcularValorPonderado("1000.55", 100)).toBe("1000.55");
  });
});

describe("derivarProximaAccionPorOportunidad", () => {
  it("first-wins: con el orden asc del servicio, la primera pendiente queda", () => {
    const map = derivarProximaAccionPorOportunidad([
      pendiente("op-1", "2026-07-10T00:00:00.000Z", { tipo: "EMAIL" }),
      pendiente("op-1", "2026-08-01T00:00:00.000Z"),
    ]);
    expect(map.get("op-1")?.tipo).toBe("EMAIL");
    expect(map.get("op-1")?.fecha?.toISOString()).toBe("2026-07-10T00:00:00.000Z");
  });

  it("defensivo ante orden inesperado: con-fecha desplaza a sin-fecha", () => {
    const map = derivarProximaAccionPorOportunidad([
      pendiente("op-1", null, { tipo: "NOTA" }),
      pendiente("op-1", "2026-07-10T00:00:00.000Z", { tipo: "REUNION" }),
    ]);
    expect(map.get("op-1")?.tipo).toBe("REUNION");
  });

  it("oportunidad sin pendientes: ausente del map", () => {
    const map = derivarProximaAccionPorOportunidad([pendiente("op-1", null)]);
    expect(map.get("op-2")).toBeUndefined();
  });
});

describe("armarWorklistRows", () => {
  it("conservación 1:1: mismas filas, mismo orden, ponderado y próxima anexados", () => {
    const ops = [op("a", { probabilidad: 33, monto: "1000.55" }), op("b")];
    const proximas = derivarProximaAccionPorOportunidad([
      pendiente("a", "2026-07-10T00:00:00.000Z"),
    ]);
    const rows = armarWorklistRows(ops, proximas);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(rows[0]?.valorPonderado).toBe("330.18");
    expect(rows[0]?.proximaAccion?.tipo).toBe("LLAMADA");
    expect(rows[1]?.proximaAccion).toBeNull();
    expect(rows[1]?.valorPonderado).toBe("500.00");
  });
});

describe("filtrarSinAccion", () => {
  it("pendiente SIN fecha CUENTA como tener próxima acción (no entra al preset)", () => {
    const rows = armarWorklistRows(
      [op("a"), op("b")],
      derivarProximaAccionPorOportunidad([pendiente("a", null)]),
    );
    expect(filtrarSinAccion(rows).map((r) => r.id)).toEqual(["b"]);
  });

  it("se restringe a ABIERTA: cerradas sin pendientes no ahogan el preset", () => {
    const rows = armarWorklistRows(
      [op("a"), op("g", { estado: "GANADA" }), op("p", { estado: "PERDIDA" })],
      new Map(),
    );
    expect(filtrarSinAccion(rows).map((r) => r.id)).toEqual(["a"]);
  });
});

describe("resolverVista / resolverFiltro / parseEstadoParam", () => {
  it("resolverVista: 'tablero' pasa, todo lo demás cae a 'lista'", () => {
    expect(resolverVista("tablero")).toBe("tablero");
    expect(resolverVista(undefined)).toBe("lista");
    expect(resolverVista("x")).toBe("lista");
  });

  it("resolverFiltro: 'sin_accion' pasa, todo lo demás cae a 'todas'", () => {
    expect(resolverFiltro("sin_accion")).toBe("sin_accion");
    expect(resolverFiltro(undefined)).toBe("todas");
    expect(resolverFiltro("x")).toBe("todas");
  });

  it("parseEstadoParam: valores del enum pasan, el resto → undefined", () => {
    expect(parseEstadoParam("ABIERTA")).toBe("ABIERTA");
    expect(parseEstadoParam("GANADA")).toBe("GANADA");
    expect(parseEstadoParam("EN_PAUSA")).toBe("EN_PAUSA");
    expect(parseEstadoParam(undefined)).toBeUndefined();
    expect(parseEstadoParam("x")).toBeUndefined();
  });
});

describe("buildOportunidadesHref", () => {
  it("omite defaults: vista=lista y filtro=todas no viajan", () => {
    expect(buildOportunidadesHref({})).toBe("/crm/oportunidades");
    expect(buildOportunidadesHref({ vista: "lista", filtro: "todas" })).toBe("/crm/oportunidades");
  });

  it("orden estable de params: vista · estado · filtro · owner · moneda", () => {
    expect(
      buildOportunidadesHref({
        vista: "tablero",
        estado: "ABIERTA",
        filtro: "sin_accion",
        owner: "me",
        moneda: "USD",
      }),
    ).toBe("/crm/oportunidades?vista=tablero&estado=ABIERTA&filtro=sin_accion&owner=me&moneda=USD");
  });

  it("round-trip: los resolvers recuperan lo que el href codificó", () => {
    const href = buildOportunidadesHref({ estado: "GANADA", filtro: "sin_accion", moneda: "ARS" });
    const qs = new URLSearchParams(href.split("?")[1]);
    expect(resolverVista(qs.get("vista") ?? undefined)).toBe("lista");
    expect(resolverFiltro(qs.get("filtro") ?? undefined)).toBe("sin_accion");
    expect(parseEstadoParam(qs.get("estado") ?? undefined)).toBe("GANADA");
    expect(qs.get("moneda")).toBe("ARS");
  });
});

describe("derivaciones del record (actividades de getOportunidad)", () => {
  const acts = [
    {
      tipo: "EMAIL",
      contenido: "Mandar propuesta",
      completada: false,
      fechaProgramada: new Date("2026-07-20T00:00:00.000Z"),
      fechaCompletada: null,
    },
    {
      tipo: "LLAMADA",
      contenido: "Llamado inicial",
      completada: false,
      fechaProgramada: new Date("2026-07-12T00:00:00.000Z"),
      fechaCompletada: null,
    },
    {
      tipo: "NOTA",
      contenido: "Nota suelta",
      completada: false,
      fechaProgramada: null,
      fechaCompletada: null,
    },
    {
      tipo: "REUNION",
      contenido: "Kickoff",
      completada: true,
      fechaProgramada: new Date("2026-06-01T00:00:00.000Z"),
      fechaCompletada: new Date("2026-06-02T00:00:00.000Z"),
    },
    {
      tipo: "WHATSAPP",
      contenido: "Seguimiento",
      completada: true,
      fechaProgramada: null,
      fechaCompletada: new Date("2026-06-20T00:00:00.000Z"),
    },
  ];

  it("próxima acción = pendiente con MENOR fechaProgramada (con-fecha vence sin-fecha)", () => {
    const p = derivarProximaAccionDeActividades(acts);
    expect(p?.tipo).toBe("LLAMADA");
    expect(p?.fecha?.toISOString()).toBe("2026-07-12T00:00:00.000Z");
  });

  it("sólo pendientes sin fecha: devuelve una sin fecha (hay seguimiento)", () => {
    const p = derivarProximaAccionDeActividades([acts[2] as (typeof acts)[number]]);
    expect(p?.tipo).toBe("NOTA");
    expect(p?.fecha).toBeNull();
  });

  it("último contacto = completada con MAYOR fechaCompletada; null sin completadas", () => {
    const u = derivarUltimoContacto(acts);
    expect(u?.tipo).toBe("WHATSAPP");
    expect(u?.fecha?.toISOString()).toBe("2026-06-20T00:00:00.000Z");
    expect(derivarUltimoContacto([acts[0] as (typeof acts)[number]])).toBeNull();
  });
});
