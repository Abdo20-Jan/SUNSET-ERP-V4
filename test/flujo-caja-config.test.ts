import { describe, expect, it } from "vitest";
import {
  assertOwnershipUnico,
  FLUJO_CAJA_ESTRUCTURA,
} from "@/lib/services/reportes/flujo-caja-config";
import { PLAN_RT9 } from "@/lib/services/plan-de-cuentas";

// Rebuild RT9 #4 — la estructura del flujo de caja (template de la dirección)
// debe referenciar SÓLO códigos del plan v3. Los costos logísticos de
// importación capitalizan a 1.1.7.x (ya no son 5.x) → sus líneas quedan como
// template sin cuenta (cuentaCodigos: []).

function codigosReferenciados(): string[] {
  const out: string[] = [];
  for (const sec of FLUJO_CAJA_ESTRUCTURA) {
    for (const sub of sec.subsecciones) {
      for (const item of sub.items) out.push(...item.cuentaCodigos);
    }
  }
  return out;
}

describe("flujo-caja-config (RT9)", () => {
  it("ownership único: ningún código en dos items", () => {
    expect(() => assertOwnershipUnico()).not.toThrow();
  });

  // ETAPA 3: el template del flujo de caja fue reapuntado al plano de 9 clases
  // (cargas fiscales a pagar 2.1.3.x). Guard ACTIVO: todo código referenciado
  // debe existir en PLAN_RT9.
  it("todo código referenciado existe en PLAN_RT9", () => {
    const enPlan = new Set(PLAN_RT9.map((c) => c.codigo));
    const fueraDelPlan = [...new Set(codigosReferenciados())].filter((c) => !enPlan.has(c));
    expect(fueraDelPlan).toEqual([]);
  });

  it("no referencia rubros 5.4/5.5/5.6/5.7 (logística capitalizada, ya no existen)", () => {
    const capitalizados = codigosReferenciados().filter((c) => /^5\.[4-7]\./.test(c));
    expect(capitalizados).toEqual([]);
  });
});
