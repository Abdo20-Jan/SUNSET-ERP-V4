import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { calcularResumenSimulacion } from "@/lib/services/simulacion-importacion";
import { createTestDb, type TestDb } from "./db";

// Regressão CRIT-06 (PR-016): a LISTA de simulaciones deve exibir o MESMO
// custo nacionalizado que o detalhe/serviço canônico (`calcularResumenSimulacion`,
// que consome `calcularRateioEmbarque`). Antes do fix, `listarSimulaciones`
// reimplementava um agregado inline com arredondamento single-step → divergia
// do canônico por centavos. Este teste trava a invariante lista == detalhe.

const h = vi.hoisted(() => {
  let client: PrismaClient | undefined;
  return {
    setClient: (c: PrismaClient) => {
      client = c;
    },
    dbProxy: new Proxy(
      {},
      {
        get(_t, prop) {
          const target = client as unknown as Record<string | symbol, unknown> | undefined;
          const value = target?.[prop];
          return typeof value === "function"
            ? (value as (...args: unknown[]) => unknown).bind(client)
            : value;
        },
      },
    ),
  };
});

vi.mock("@/lib/db", () => ({ db: h.dbProxy }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { listarSimulaciones } from "@/lib/actions/simulaciones-importacion";

const TABLES = [
  "CostoSimulacionImportacion",
  "ItemSimulacionImportacion",
  "SimulacionImportacion",
] as const;

describe("listarSimulaciones — CRIT-06 lista == detalhe (canônico)", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    h.setClient(db.prisma);
  });

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await db.reset(TABLES);
  });

  it("custo nacionalizado da lista == calcularResumenSimulacion (TC decimal que divergiria no agregado inline)", async () => {
    // Fixture escolhido p/ o arredondamento divergir entre o agregado
    // single-step (antigo) e o canônico per-parcela:
    //   TC=1399.5; die=tasa=arancel=0.01; 1 custo logístico=0.01; FOB=1.00.
    // Antigo (inline):  1399.5 + 0.01×1399.5(=13.995) + 0.03×1399.5(=41.985) = 1455.48
    // Canônico (round2 por parcela): 1399.50 + round2(13.995)=14.00 +
    //   round2(round2(13.995)×3)=42.00 = 1455.50  → divergência de 0.02.
    await db.prisma.simulacionImportacion.create({
      data: {
        codigo: "SIM-TEST-001",
        moneda: "USD",
        tipoCambio: "1399.5",
        die: "0.01",
        tasaEstadistica: "0.01",
        arancelSim: "0.01",
        items: {
          create: [{ cantidad: 1, precioUnitarioFob: "1.00", descripcionLibre: "A" }],
        },
        costos: {
          create: [
            { tipo: "GASTOS_LOCALES", subtotal: "0.01", moneda: "USD", tipoCambio: "1399.5" },
          ],
        },
      },
    });

    // Referência canônica (mesma função que o form/detalhe usam).
    const resumen = calcularResumenSimulacion({
      moneda: "USD",
      tipoCambio: "1399.5",
      valorFleteOrigen: null,
      valorSeguroOrigen: null,
      die: "0.01",
      tasaEstadistica: "0.01",
      arancelSim: "0.01",
      iva: "0",
      ivaAdicional: "0",
      ganancias: "0",
      iibb: "0",
      items: [{ cantidad: 1, precioUnitarioFob: "1.00" }],
      costos: [{ subtotal: "0.01", moneda: "USD", tipoCambio: "1399.5" }],
    });

    const rows = await listarSimulaciones();
    const row = rows.find((r) => r.codigo === "SIM-TEST-001");
    expect(row).toBeDefined();

    // Valor canônico documentado (detalhe) — o agregado inline antigo dava "1455.48".
    expect(resumen.costoTotalNacionalizadoArs.toFixed(2)).toBe("1455.50");

    // Invariante CRIT-06: a lista mostra exatamente o custo canônico.
    expect(row?.costoTotalNacionalizado).toBe(resumen.costoTotalNacionalizadoArs.toFixed(2));
    expect(row?.fobTotal).toBe(resumen.fobTotal.toFixed(2));
  });
});
