import { describe, expect, it } from "vitest";

import { EmbarqueEstado } from "@/generated/prisma/client";
import {
  bandDiasSinActualizacion,
  clasificarSeveridad,
  diasSinActualizacion,
  proximaAccionPorEstado,
} from "@/lib/services/comex-cockpit-derivaciones";

// `now` inyectado (nunca Date.now() interno) → determinista, igual al patrón de
// comex-worklist-derivaciones. Referencia fija para todo el suite.
const NOW = new Date("2026-06-28T00:00:00.000Z");
const diasAtras = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

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
