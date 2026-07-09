import { describe, expect, it } from "vitest";

import {
  cutoffSinFollowUp,
  SIN_FOLLOW_UP_DIAS,
} from "@/lib/services/crm/lead-seguimiento";

// Sólo la parte PURA del servicio (el predicado con DB se valida vía el
// espejo `esSinFollowUp` en leads-presentacion.test.ts + QA manual).

describe("cutoffSinFollowUp", () => {
  it("default = ahora - SIN_FOLLOW_UP_DIAS (7) días", () => {
    const ahora = new Date("2026-07-09T12:00:00.000Z");
    expect(SIN_FOLLOW_UP_DIAS).toBe(7);
    expect(cutoffSinFollowUp(ahora).toISOString()).toBe("2026-07-02T12:00:00.000Z");
  });

  it("acepta ventana custom en días", () => {
    const ahora = new Date("2026-07-09T00:00:00.000Z");
    expect(cutoffSinFollowUp(ahora, 1).toISOString()).toBe("2026-07-08T00:00:00.000Z");
    expect(cutoffSinFollowUp(ahora, 14).toISOString()).toBe("2026-06-25T00:00:00.000Z");
  });

  it("es puro: no muta la fecha de entrada", () => {
    const ahora = new Date("2026-07-09T00:00:00.000Z");
    cutoffSinFollowUp(ahora);
    expect(ahora.toISOString()).toBe("2026-07-09T00:00:00.000Z");
  });
});
