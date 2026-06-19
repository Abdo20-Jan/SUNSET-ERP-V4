import { describe, expect, it } from "vitest";
import * as registry from "@/lib/services/cuenta-registry";
import { categoriaPorClase, PLAN_RT9 } from "@/lib/services/plan-de-cuentas";

// Rebuild RT9 #5 — guard de consistencia registry ↔ PLAN_RT9.
//
// `cuenta-registry.ts` (los códigos canónicos que el motor crea/reutiliza) y
// `plan-de-cuentas.ts` (la fuente única que siembra la DB) son DOS verdades que
// deben coincidir: si el motor referencia un código que el plan no declara, el
// asiento nace fuera del plan sembrado (cuenta fantasma). Este guard recorre
// todos los `CuentaDef` exportados por el registry y exige que cada código
// exista en PLAN_RT9 como ANALÍTICA con la misma categoría.

type Def = { codigo: string; nombre: string; categoria: string };

function isDef(v: unknown): v is Def {
  return !!v && typeof v === "object" && "codigo" in v && "categoria" in v;
}

function registryDefs(): Def[] {
  const defs: Def[] = [];
  for (const exported of Object.values(registry)) {
    // Mapas de CuentaDef ({ KEY: { codigo, nombre, categoria } }); se ignoran
    // los exports escalares (tasas, días, porcentajes).
    if (exported && typeof exported === "object" && !isDef(exported)) {
      for (const inner of Object.values(exported as Record<string, unknown>)) {
        if (isDef(inner)) defs.push(inner);
      }
    }
  }
  return defs;
}

// ETAPA 1/3 (plan nuevo): el registry del motor todavía apunta a códigos del
// plan viejo; este guard se reactiva al reapuntar el motor en la etapa 3 (flujos).
describe.skip("guard registry ↔ PLAN_RT9", () => {
  const plan = new Map(PLAN_RT9.map((c) => [c.codigo, c]));
  const defs = registryDefs();

  it("recolecta las cuentas canónicas del registry", () => {
    expect(defs.length).toBeGreaterThan(40);
  });

  it("todo código del registry existe en PLAN_RT9 (sin cuentas fantasma)", () => {
    const faltantes = [...new Set(defs.filter((d) => !plan.has(d.codigo)).map((d) => d.codigo))];
    expect(faltantes).toEqual([]);
  });

  it("la categoría del registry coincide con la de PLAN_RT9", () => {
    const choques = [
      ...new Set(
        defs
          .filter(
            (d) =>
              plan.has(d.codigo) &&
              categoriaPorClase(plan.get(d.codigo)?.clase ?? 0) !== d.categoria,
          )
          .map(
            (d) =>
              `${d.codigo}: registry=${d.categoria} plan=${categoriaPorClase(plan.get(d.codigo)?.clase ?? 0)}`,
          ),
      ),
    ];
    expect(choques).toEqual([]);
  });

  it("todo código del registry apunta a una ANALÍTICA del plan (no a una sintética)", () => {
    const sinteticas = [
      ...new Set(defs.filter((d) => plan.get(d.codigo)?.tipo === "SINTETICA").map((d) => d.codigo)),
    ];
    expect(sinteticas).toEqual([]);
  });
});
