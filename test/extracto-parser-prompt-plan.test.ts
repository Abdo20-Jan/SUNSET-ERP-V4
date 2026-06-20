import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLAN_RT9 } from "@/lib/services/plan-de-cuentas";

// Guard textual (F0-FND-1) del SYSTEM_PROMPT del parser de extractos.
//
// El prompt le indica a la IA qué código contable contrapartida sugerir para
// cada movimiento. Tras la refundación a 9 clases / 631 cuentas, NINGÚN código
// del plan viejo (5.8.x / 1.1.5.x / 1.1.3.01) puede sobrevivir —reusar uno
// contamina el ledger (p. ej. 1.1.3.01 hoy es DEUDORES POR VENTAS, no FCI)— y
// cada código citado debe existir en el plan vigente.
//
// Se lee el archivo-FUENTE en lugar de importar el módulo: extracto-parser.ts
// es `server-only` y arrastra el SDK de Anthropic; el guard sólo necesita el
// texto del prompt, que vive en el fuente.
const FUENTE = readFileSync(join(process.cwd(), "src/lib/services/extracto-parser.ts"), "utf8");

const CODIGOS_VALIDOS = new Set(PLAN_RT9.map((c) => c.codigo));

// Códigos nuevos clave que el de-para debe emitir (regresión de la reescritura).
const CODIGOS_NUEVOS_ESPERADOS = [
  "9.6.01", // Ley 25.413
  "9.6.02", // Sellos
  "1.1.4.2.03", // IIBB SIRCREB
  "1.1.4.1.06", // IVA percepciones bancarias
  "1.1.4.1.01", // IVA crédito fiscal local
  "9.5.01", // Comisiones bancarias
  "9.1.04", // Intereses descubierto
  "1.1.2.01", // FCI
];

describe("extracto-parser SYSTEM_PROMPT ↔ plano de 631 cuentas", () => {
  it("no contiene códigos del plan viejo (5.8.x / 1.1.5.x / 1.1.3.01)", () => {
    const viejos = FUENTE.match(/\b5\.8\.\d|\b1\.1\.5\.\d|\b1\.1\.3\.01\b/g) ?? [];
    expect(viejos).toEqual([]);
  });

  it("todo código contable citado (entre comillas) existe en el plan vigente", () => {
    // Códigos citados como "N.N.N…" (≥3 segmentos) en el prompt — el ancla en
    // comillas evita falsos positivos (Ley 25413, RG 2408, CUITs, 21%).
    const citados = [...FUENTE.matchAll(/"(\d+(?:\.\d+){2,})"/g)].map((m) => m[1]);
    expect(citados.length).toBeGreaterThan(0);
    const fantasmas = [...new Set(citados.filter((c) => !CODIGOS_VALIDOS.has(c)))];
    expect(fantasmas).toEqual([]);
  });

  it("están presentes los códigos nuevos esperados del de-para", () => {
    const faltantes = CODIGOS_NUEVOS_ESPERADOS.filter((c) => !FUENTE.includes(`"${c}"`));
    expect(faltantes).toEqual([]);
  });
});
