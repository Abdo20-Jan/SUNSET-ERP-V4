import { describe, expect, it } from "vitest";

import { BALANCE_RUBROS } from "@/lib/services/orden-eecc";
import {
  BLOQUES,
  type BloqueBP,
  type LadoBP,
  bloqueArtesanalDe,
  bloquesPorLado,
  rubroBalanceConocido,
} from "@/lib/services/reportes/export/bloques-bp";

describe("bloqueArtesanalDe — tradução rubro formal (orden-eecc) → bloco artesanal PT", () => {
  // As strings de rubro são EXATAMENTE as de BALANCE_RUBROS (orden-eecc.ts), que
  // é o que rubroEECCDeCuenta persiste em Cuenta.rubroEECC.
  const casos: Array<[string | null, string, BloqueBP]> = [
    // ATIVO corriente
    ["Caja y bancos", "1.1.1.01.01", "DISPONIBILIDADE"],
    ["Inversiones financieras corrientes", "1.1.2.01", "DISPONIBILIDADE"],
    ["Cuentas por cobrar a clientes", "1.1.3.01.01", "REALIZAVEL_MEDIO"],
    ["Créditos impositivos y aduaneros", "1.1.4.1.01", "REALIZAVEL_CURTO"],
    ["Créditos con partes relacionadas", "1.1.5.01", "ADIANTAMENTO_PROVEDORES_LOCAIS"],
    ["Otras cuentas por cobrar", "1.1.6.01", "REALIZAVEL_CURTO"],
    ["Bienes de cambio", "1.1.7.01", "STOCK"],
    ["Otros activos corrientes", "1.1.8.01", "OUTROS_ATIVOS"],
    // ATIVO no corriente
    ["Inversiones financieras no corrientes", "1.2.1.01", "REALIZAVEL_LONGO"],
    ["Bienes de cambio no corrientes", "1.2.6.01", "REALIZAVEL_LONGO"],
    ["Propiedades de inversión", "1.2.7.01", "IMOBILIZADO"],
    ["Bienes de uso", "1.2.8.01", "IMOBILIZADO"],
    ["Activos intangibles", "1.2.9.01", "IMOBILIZADO"],
    ["Activo por impuesto diferido", "1.2.10.01", "REALIZAVEL_LONGO"],
    ["Otros activos no corrientes", "1.2.11.01", "REALIZAVEL_LONGO"],
    // PASIVO corriente
    ["Préstamos y otros pasivos financieros", "2.1.2.01", "EXIGIVEL_CURTO"],
    ["Cargas fiscales", "2.1.3.01", "PROVISIONAMENTOS"],
    ["Remuneraciones y cargas sociales", "2.1.4.1.01", "EXIGIVEL_CURTO"],
    ["Deudas en especie y anticipos de clientes", "2.1.5.01", "CIRCULANTE"],
    ["Otras cuentas por pagar", "2.1.7.02", "OUTRAS_OBRIGACOES"],
    ["Previsiones corrientes", "2.1.8.01", "PROVISIONAMENTOS"],
    // PASIVO no corriente
    ["Préstamos y otros pasivos financieros no corrientes", "2.2.1.01", "EXIGIVEL_LONGO"],
    ["Cargas fiscales no corrientes", "2.2.4.01", "PROVISIONAMENTOS"],
    ["Pasivo por impuesto diferido", "2.2.6.01", "EXIGIVEL_LONGO"],
    ["Previsiones no corrientes", "2.2.7.01", "PROVISIONAMENTOS"],
  ];

  for (const [rubro, codigo, esperado] of casos) {
    it(`${rubro} (${codigo}) → ${esperado}`, () => {
      expect(bloqueArtesanalDe(rubro, codigo)).toBe(esperado);
    });
  }

  it("divide 'Cuentas por pagar comerciales' por código: local (2.1.1.01.x) vs exterior (2.1.1.02.x)", () => {
    const r = "Cuentas por pagar comerciales";
    expect(bloqueArtesanalDe(r, "2.1.1.01.01")).toBe("PROVEDORES_LOCAIS");
    expect(bloqueArtesanalDe(r, "2.1.1.02.01")).toBe("PROVEDORES_EXTERIOR");
  });

  it("PATRIMONIO: qualquer conta classe 3 → PATRIMONIO_LIQUIDO", () => {
    expect(bloqueArtesanalDe("Aportes de los propietarios", "3.1.01")).toBe("PATRIMONIO_LIQUIDO");
    expect(bloqueArtesanalDe("Resultados acumulados", "3.3.01")).toBe("PATRIMONIO_LIQUIDO");
  });

  it("rubro desconhecido cai no catch-all do lado (derivado do código)", () => {
    expect(bloqueArtesanalDe("Rubro Inexistente", "1.9.9.99")).toBe("OUTROS_ATIVOS");
    expect(bloqueArtesanalDe(null, "1.9.9.99")).toBe("OUTROS_ATIVOS");
    expect(bloqueArtesanalDe("Rubro Inexistente", "2.9.9.99")).toBe("OUTRAS_OBRIGACOES");
  });

  it("respeita o lado de apresentação: conta de pasivo reclassificada ao ativo cai em OUTROS_ATIVOS", () => {
    const lado: LadoBP = "ATIVO";
    expect(bloqueArtesanalDe("Cuentas por pagar comerciales", "2.1.1.01.20", lado)).toBe(
      "OUTROS_ATIVOS",
    );
  });

  it("respeita o lado: crédito a cliente (1.1.3.x) reclassificado ao pasivo cai em OUTRAS_OBRIGACOES", () => {
    expect(bloqueArtesanalDe("Cuentas por cobrar a clientes", "1.1.3.10", "PASIVO")).toBe(
      "OUTRAS_OBRIGACOES",
    );
  });
});

describe("drift guard — todo rubro de BALANCE_RUBROS está coberto", () => {
  // Garante que o de-para acompanhe orden-eecc: se um rubro de balance for
  // adicionado/renomeado lá, este teste falha (em vez de cair silenciosamente
  // no catch-all). PN (classe 3) é resolvido por código, não pelo mapa.
  const rubrosBalance = BALANCE_RUBROS.filter((r) => r.grupo !== "Patrimonio neto");

  for (const r of rubrosBalance) {
    it(`rubro '${r.rubro}' (${r.prefijo}) é conhecido e não cai em catch-all por engano`, () => {
      expect(rubroBalanceConocido(r.rubro)).toBe(true);
      const lado: LadoBP = r.prefijo.startsWith("2") ? "PASIVO" : "ATIVO";
      const bloque = bloqueArtesanalDe(r.rubro, `${r.prefijo}.01`, lado);
      // deve resolver para um bloco do lado certo
      expect(BLOQUES.find((b) => b.key === bloque)?.lado).toBe(lado);
    });
  }
});

describe("BLOQUES — catálogo e ordem", () => {
  it("tem blocos para os três lados, sem chaves duplicadas", () => {
    const keys = BLOQUES.map((b) => b.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(bloquesPorLado("ATIVO").length).toBeGreaterThan(0);
    expect(bloquesPorLado("PASIVO").length).toBeGreaterThan(0);
    expect(bloquesPorLado("PL").map((b) => b.key)).toEqual(["PATRIMONIO_LIQUIDO"]);
  });

  it("ATIVO começa por DISPONIBILIDADE (ordem por liquidez)", () => {
    expect(bloquesPorLado("ATIVO")[0]?.key).toBe("DISPONIBILIDADE");
  });
});
