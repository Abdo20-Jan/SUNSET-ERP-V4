import { describe, expect, it } from "vitest";

import { EmbarqueEstado } from "@/generated/prisma/client";
import {
  bandDiasSinActualizacion,
  clasificarSeveridad,
  diasSinActualizacion,
  proximaAccionPorEstado,
} from "@/lib/services/comex-cockpit-derivaciones";
import {
  agruparEventosPorDia,
  type CalendarioEvento,
  type CalendarioEventoTipo,
  construirCalendario,
  type ProcesoCalendarioFuente,
  tagEventosDeProceso,
} from "@/lib/services/comex-cockpit-calendario";

// `now` inyectado (nunca Date.now() interno) → determinista, igual al patrón de
// comex-worklist-derivaciones. Referencia fija para todo el suite.
const NOW = new Date("2026-06-28T00:00:00.000Z");
const diasAtras = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
const enFecha = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("clasificarSeveridad", () => {
  it("bloqueo presente → crítico (señal de pago local vencido)", () => {
    expect(clasificarSeveridad({ bloqueo: "Pago local vencido", etaTono: "none" })).toBe("critico");
  });

  it("ETA overdue → crítico aunque no haya bloqueo", () => {
    expect(clasificarSeveridad({ bloqueo: null, etaTono: "overdue" })).toBe("critico");
  });

  it("ETA soon (sin bloqueo) → atención", () => {
    expect(clasificarSeveridad({ bloqueo: null, etaTono: "soon" })).toBe("atencion");
  });

  it("sin señales → ok", () => {
    expect(clasificarSeveridad({ bloqueo: null, etaTono: "none" })).toBe("ok");
  });

  it("bloqueo tiene prioridad sobre ETA soon", () => {
    expect(clasificarSeveridad({ bloqueo: "Pago local vencido", etaTono: "soon" })).toBe("critico");
  });
});

describe("diasSinActualizacion", () => {
  it("mismo instante → 0 días", () => {
    expect(diasSinActualizacion(NOW, NOW)).toBe(0);
  });

  it("cuenta días enteros transcurridos (floor)", () => {
    expect(diasSinActualizacion(diasAtras(6), NOW)).toBe(6);
    expect(diasSinActualizacion(diasAtras(11), NOW)).toBe(11);
  });

  it("fracción de día redondea hacia abajo", () => {
    const hace2dYMedio = new Date(NOW.getTime() - 2.5 * 86_400_000);
    expect(diasSinActualizacion(hace2dYMedio, NOW)).toBe(2);
  });
});

describe("bandDiasSinActualizacion", () => {
  it("≤5 días → fresca", () => {
    expect(bandDiasSinActualizacion(NOW, NOW)).toBe("fresca");
    expect(bandDiasSinActualizacion(diasAtras(5), NOW)).toBe("fresca");
  });

  it(">5 y ≤10 días → amber", () => {
    expect(bandDiasSinActualizacion(diasAtras(6), NOW)).toBe("amber");
    expect(bandDiasSinActualizacion(diasAtras(10), NOW)).toBe("amber");
  });

  it(">10 días → red", () => {
    expect(bandDiasSinActualizacion(diasAtras(11), NOW)).toBe("red");
    expect(bandDiasSinActualizacion(diasAtras(40), NOW)).toBe("red");
  });
});

describe("proximaAccionPorEstado", () => {
  it("devuelve una acción no vacía para cada EmbarqueEstado", () => {
    for (const estado of Object.values(EmbarqueEstado)) {
      const accion = proximaAccionPorEstado(estado);
      expect(typeof accion).toBe("string");
      expect(accion.length).toBeGreaterThan(0);
    }
  });

  it("mapea estados clave a su acción esperada", () => {
    expect(proximaAccionPorEstado(EmbarqueEstado.BORRADOR)).toMatch(/confirmar/i);
    expect(proximaAccionPorEstado(EmbarqueEstado.EN_TRANSITO)).toMatch(/eta|seguir/i);
    expect(proximaAccionPorEstado(EmbarqueEstado.EN_ADUANA)).toMatch(/liberaci/i);
    expect(proximaAccionPorEstado(EmbarqueEstado.CERRADO)).toMatch(/cerrado/i);
  });
});

// ── Calendario semanal operacional (PR-022c) ─────────────────────────────────

function mkProceso(
  id: string,
  fechas: Partial<Omit<ProcesoCalendarioFuente, "id" | "codigo" | "proveedor">> = {},
): ProcesoCalendarioFuente {
  return {
    id,
    codigo: `IMP-${id}`,
    proveedor: { nombre: `Prov ${id}` },
    fechaEmpaque: fechas.fechaEmpaque ?? null,
    fechaSalida: fechas.fechaSalida ?? null,
    fechaTransbordo: fechas.fechaTransbordo ?? null,
    fechaLlegada: fechas.fechaLlegada ?? null,
    fechaZonaPrimaria: fechas.fechaZonaPrimaria ?? null,
    fechaCierre: fechas.fechaCierre ?? null,
    contenedores: fechas.contenedores ?? [],
    costos: fechas.costos ?? [],
    despachos: fechas.despachos ?? [],
  };
}

const tipos = (evs: CalendarioEvento[]): CalendarioEventoTipo[] => evs.map((e) => e.tipo);

describe("tagEventosDeProceso", () => {
  it("emite 1 evento por cada campo de fecha ARMAZENADO no nulo (mapa completo)", () => {
    const evs = tagEventosDeProceso(
      mkProceso("e1", {
        fechaEmpaque: enFecha("2026-06-22"),
        fechaSalida: enFecha("2026-06-23"),
        fechaTransbordo: enFecha("2026-06-24"),
        fechaLlegada: enFecha("2026-06-25"),
        fechaZonaPrimaria: enFecha("2026-06-26"),
        fechaCierre: enFecha("2026-06-27"),
        contenedores: [
          { fechaTrasladoDF: enFecha("2026-06-29"), fechaDesconsolidacion: enFecha("2026-06-30") },
        ],
        despachos: [{ fecha: enFecha("2026-07-01") }],
        costos: [{ fechaVencimiento: enFecha("2026-07-02") }],
      }),
    );
    expect(new Set(tipos(evs))).toEqual(
      new Set<CalendarioEventoTipo>([
        "empaque",
        "embarcado",
        "transbordo",
        "arribo",
        "ingreso-zpa",
        "traslado-df",
        "desconsolidacion",
        "nacionalizacion",
        "despacho",
        "pago-exterior",
      ]),
    );
  });

  it("omite fechas nulas (proceso vacío → ningún evento)", () => {
    expect(tagEventosDeProceso(mkProceso("e2"))).toEqual([]);
  });

  it("sólo emite los tipos con fecha presente", () => {
    const evs = tagEventosDeProceso(
      mkProceso("e3", { fechaLlegada: enFecha("2026-06-25") }),
    );
    expect(tipos(evs)).toEqual(["arribo"]);
  });

  it("mapea cada evento a su aba de drill-down (operacion/aduana/finanzas)", () => {
    const evs = tagEventosDeProceso(
      mkProceso("e4", {
        fechaLlegada: enFecha("2026-06-25"),
        fechaCierre: enFecha("2026-06-27"),
        despachos: [{ fecha: enFecha("2026-07-01") }],
        costos: [{ fechaVencimiento: enFecha("2026-07-02") }],
      }),
    );
    const tabPorTipo = Object.fromEntries(evs.map((e) => [e.tipo, e.tab]));
    expect(tabPorTipo.arribo).toBe("operacion");
    expect(tabPorTipo.nacionalizacion).toBe("finanzas");
    expect(tabPorTipo.despacho).toBe("aduana");
    expect(tabPorTipo["pago-exterior"]).toBe("finanzas");
  });

  it("de-duplica eventos de arrays por DÍA (2 contenedores mismo día → 1 ícono)", () => {
    const evs = tagEventosDeProceso(
      mkProceso("e5", {
        contenedores: [
          { fechaTrasladoDF: enFecha("2026-06-29"), fechaDesconsolidacion: null },
          { fechaTrasladoDF: enFecha("2026-06-29"), fechaDesconsolidacion: null },
        ],
      }),
    );
    expect(tipos(evs)).toEqual(["traslado-df"]);
  });

  it("NO lleva ningún valor monetario en el payload del evento", () => {
    const [ev] = tagEventosDeProceso(mkProceso("e6", { fechaLlegada: enFecha("2026-06-25") }));
    expect(Object.keys(ev).sort()).toEqual(
      ["codigo", "embarqueId", "fechaISO", "proveedorNombre", "tab", "tipo"].sort(),
    );
  });
});

describe("agruparEventosPorDia", () => {
  it("agrupa por día UTC (mismo día junta; días distintos separan)", () => {
    const evs = tagEventosDeProceso(
      mkProceso("e1", {
        fechaEmpaque: enFecha("2026-06-25"),
        fechaSalida: enFecha("2026-06-25"),
        fechaLlegada: enFecha("2026-06-26"),
      }),
    );
    const map = agruparEventosPorDia(evs);
    expect(map.get("2026-06-25")).toHaveLength(2);
    expect(map.get("2026-06-26")).toHaveLength(1);
    expect(map.has("2026-06-27")).toBe(false);
  });
});

describe("construirCalendario", () => {
  it("grilla de ≥4 semanas, cada una con 7 días (lunes→domingo)", () => {
    const cal = construirCalendario([mkProceso("e1", { fechaLlegada: NOW })], NOW);
    expect(cal.semanas.length).toBeGreaterThanOrEqual(4);
    for (const semana of cal.semanas) {
      expect(semana.dias).toHaveLength(7);
    }
  });

  it("marca esHoy en la celda de `now` (UTC) y ubica el evento en su día", () => {
    const cal = construirCalendario([mkProceso("e1", { fechaLlegada: NOW })], NOW);
    const dias = cal.semanas.flatMap((s) => s.dias);
    const hoy = dias.find((d) => d.esHoy);
    expect(hoy?.diaISO).toBe("2026-06-28");
    const conEvento = dias.find((d) => d.eventos.length > 0);
    expect(conEvento?.diaISO).toBe("2026-06-28");
    expect(conEvento?.eventos[0]?.tipo).toBe("arribo");
  });

  it("respeta el universo filtrado: sólo los procesos pasados aportan eventos", () => {
    const soloUno = construirCalendario(
      [mkProceso("e1", { fechaLlegada: NOW })],
      NOW,
    );
    expect(soloUno.totalEventos).toBe(1);
    expect(soloUno.semanas.flatMap((s) => s.dias).flatMap((d) => d.eventos)).toHaveLength(1);
  });

  it("procesos sin fechas mapeadas → 0 eventos (omisión, no se inventa)", () => {
    const cal = construirCalendario([mkProceso("e1"), mkProceso("e2")], NOW);
    expect(cal.totalEventos).toBe(0);
    expect(cal.fueraDeVentana).toBe(0);
  });

  it("eventos dentro de la ventana → fueraDeVentana = 0", () => {
    const cal = construirCalendario(
      [mkProceso("e1", { fechaLlegada: NOW, fechaEmpaque: diasAtras(3) })],
      NOW,
    );
    expect(cal.totalEventos).toBe(2);
    expect(cal.fueraDeVentana).toBe(0);
  });
});
