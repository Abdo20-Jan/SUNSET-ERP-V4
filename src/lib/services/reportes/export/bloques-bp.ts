// Camada de tradução: rubros formais (EECC argentinos, `Cuenta.rubroEECC`) →
// blocos do Balanço Patrimonial no formato artesanal do dono (rótulos PT-BR).
//
// O Balance General do ERP agrupa por rubro formal (ej. "Caja y bancos",
// "Bienes de cambio", "Deudas comerciales"). A planilha artesanal usa blocos
// por liquidez em PT (DISPONIBILIDADE, STOCK, EXIGIVEL…). Esta é a ponte 1:1.

export type LadoBP = "ATIVO" | "PASIVO" | "PL";

export type BloqueBP =
  | "DISPONIBILIDADE"
  | "REALIZAVEL_CURTO"
  | "REALIZAVEL_MEDIO"
  | "STOCK"
  | "REALIZAVEL_LONGO"
  | "ADIANTAMENTO_PROVEDORES_LOCAIS"
  | "IMOBILIZADO"
  | "OUTROS_ATIVOS"
  | "CIRCULANTE"
  | "PROVISIONAMENTOS"
  | "PROVEDORES_LOCAIS"
  | "PROVEDORES_EXTERIOR"
  | "EXIGIVEL_CURTO"
  | "EXIGIVEL_LONGO"
  | "OUTRAS_OBRIGACOES"
  | "PATRIMONIO_LIQUIDO";

export type DefBloque = { key: BloqueBP; titulo: string; lado: LadoBP };

// Ordem de exibição (espelha a planilha artesanal: ATIVO por liquidez → PASIVO
// circulante→exigível → PL).
export const BLOQUES: readonly DefBloque[] = [
  { key: "DISPONIBILIDADE", titulo: "DISPONIBILIDADE", lado: "ATIVO" },
  { key: "REALIZAVEL_CURTO", titulo: "REALIZAVEL A CURTO PRAZO", lado: "ATIVO" },
  { key: "REALIZAVEL_MEDIO", titulo: "REALIZAVEL A MEDIO PRAZO", lado: "ATIVO" },
  { key: "STOCK", titulo: "STOCK", lado: "ATIVO" },
  { key: "REALIZAVEL_LONGO", titulo: "REALIZAVEL A LONGO PRAZO", lado: "ATIVO" },
  {
    key: "ADIANTAMENTO_PROVEDORES_LOCAIS",
    titulo: "ADIANTAMENTO A PROVEDORES LOCAIS",
    lado: "ATIVO",
  },
  { key: "IMOBILIZADO", titulo: "IMOBILIZADO", lado: "ATIVO" },
  { key: "OUTROS_ATIVOS", titulo: "OUTROS ATIVOS", lado: "ATIVO" },
  { key: "CIRCULANTE", titulo: "CIRCULANTE", lado: "PASIVO" },
  { key: "PROVISIONAMENTOS", titulo: "PROVISIONAMENTOS", lado: "PASIVO" },
  { key: "PROVEDORES_LOCAIS", titulo: "PROVEDORES LOCAIS", lado: "PASIVO" },
  { key: "PROVEDORES_EXTERIOR", titulo: "PROVEDORES DO EXTERIOR", lado: "PASIVO" },
  { key: "EXIGIVEL_CURTO", titulo: "EXIGIVEL A CURTO PRAZO", lado: "PASIVO" },
  { key: "EXIGIVEL_LONGO", titulo: "EXIGIVEL A LONGO PRAZO", lado: "PASIVO" },
  { key: "OUTRAS_OBRIGACOES", titulo: "OUTRAS OBRIGAÇÕES", lado: "PASIVO" },
  { key: "PATRIMONIO_LIQUIDO", titulo: "PATRIMONIO LÍQUIDO", lado: "PL" },
] as const;

export function bloquesPorLado(lado: LadoBP): DefBloque[] {
  return BLOQUES.filter((b) => b.lado === lado);
}

const CATCHALL: Record<LadoBP, BloqueBP> = {
  ATIVO: "OUTROS_ATIVOS",
  PASIVO: "OUTRAS_OBRIGACOES",
  PL: "PATRIMONIO_LIQUIDO",
};

const LADO_DE_BLOQUE: Record<BloqueBP, LadoBP> = Object.fromEntries(
  BLOQUES.map((b) => [b.key, b.lado]),
) as Record<BloqueBP, LadoBP>;

// Rubro formal do Balance → bloco artesanal. As CHAVES são EXATAMENTE os
// `rubro` de `BALANCE_RUBROS` em `orden-eecc.ts` (fonte única, transcrita 1:1 do
// Excel do dono) — que é o que `rubroEECCDeCuenta(codigo)` persiste em
// `Cuenta.rubroEECC`. NÃO usar nomes informais: o de-para abaixo é o join real.
// "Cuentas por pagar comerciales" NÃO entra aqui — é tratado à parte (split
// local/exterior por código). O teste de drift (export-bp-bloques.test.ts)
// garante que todo rubro de balance esteja coberto.
const POR_RUBRO: Record<string, BloqueBP> = {
  // Activo corriente
  "Caja y bancos": "DISPONIBILIDADE",
  "Inversiones financieras corrientes": "DISPONIBILIDADE",
  "Cuentas por cobrar a clientes": "REALIZAVEL_MEDIO",
  "Créditos impositivos y aduaneros": "REALIZAVEL_CURTO",
  "Créditos con partes relacionadas": "ADIANTAMENTO_PROVEDORES_LOCAIS",
  "Otras cuentas por cobrar": "REALIZAVEL_CURTO",
  "Bienes de cambio": "STOCK",
  "Otros activos corrientes": "OUTROS_ATIVOS",
  // Activo no corriente
  "Inversiones financieras no corrientes": "REALIZAVEL_LONGO",
  "Cuentas por cobrar no corrientes": "REALIZAVEL_LONGO",
  "Créditos impositivos no corrientes": "REALIZAVEL_LONGO",
  "Créditos con partes relacionadas no corrientes": "REALIZAVEL_LONGO",
  "Otras cuentas por cobrar no corrientes": "REALIZAVEL_LONGO",
  "Bienes de cambio no corrientes": "REALIZAVEL_LONGO",
  "Propiedades de inversión": "IMOBILIZADO",
  "Bienes de uso": "IMOBILIZADO",
  "Activos intangibles": "IMOBILIZADO",
  "Activo por impuesto diferido": "REALIZAVEL_LONGO",
  "Otros activos no corrientes": "REALIZAVEL_LONGO",
  // Pasivo corriente (2.1.1 "Cuentas por pagar comerciales" → ver caso especial)
  "Préstamos y otros pasivos financieros": "EXIGIVEL_CURTO",
  "Cargas fiscales": "PROVISIONAMENTOS",
  "Remuneraciones y cargas sociales": "EXIGIVEL_CURTO",
  "Deudas en especie y anticipos de clientes": "CIRCULANTE",
  "Deudas con partes relacionadas": "EXIGIVEL_CURTO",
  "Otras cuentas por pagar": "OUTRAS_OBRIGACOES",
  "Previsiones corrientes": "PROVISIONAMENTOS",
  // Pasivo no corriente
  "Préstamos y otros pasivos financieros no corrientes": "EXIGIVEL_LONGO",
  "Deudas comerciales no corrientes": "EXIGIVEL_LONGO",
  "Deudas con partes relacionadas no corrientes": "EXIGIVEL_LONGO",
  "Cargas fiscales no corrientes": "PROVISIONAMENTOS",
  "Otras cuentas por pagar no corrientes": "EXIGIVEL_LONGO",
  "Pasivo por impuesto diferido": "EXIGIVEL_LONGO",
  "Previsiones no corrientes": "PROVISIONAMENTOS",
};

// Rubro do subledger comercial (2.1.1) — split local/exterior por código.
const RUBRO_COMERCIAL = "Cuentas por pagar comerciales";

// True se o rubro formal de balance é tratado explicitamente (mapa ou caso
// especial). Usado pelo teste de drift contra BALANCE_RUBROS de orden-eecc.
export function rubroBalanceConocido(rubro: string): boolean {
  return rubro === RUBRO_COMERCIAL || Object.hasOwn(POR_RUBRO, rubro);
}

function ladoDeCodigo(codigo: string): LadoBP {
  if (codigo.startsWith("3")) return "PL";
  if (codigo.startsWith("2")) return "PASIVO";
  return "ATIVO";
}

function ajustarAoLado(bloque: BloqueBP, lado: LadoBP): BloqueBP {
  return LADO_DE_BLOQUE[bloque] === lado ? bloque : CATCHALL[lado];
}

/**
 * Mapeia uma conta (rubro formal + código) a um bloco do BP artesanal, SEMPRE
 * dentro do lado em que a conta está sendo apresentada (`ladoPresentacion`,
 * default derivado do código). Garante que toda conta caia em algum bloco do
 * lado correto — contas reclassificadas para o lado oposto (saldos a favor)
 * caem no catch-all do lado de apresentação.
 *
 * Caso especial: "Cuentas por pagar comerciales" se divide em PROVEDORES
 * LOCAIS (`2.1.1.01.x`) vs PROVEDORES DO EXTERIOR (`2.1.1.02.x`) pelo código.
 */
export function bloqueArtesanalDe(
  rubroEECC: string | null,
  codigo: string,
  ladoPresentacion: LadoBP = ladoDeCodigo(codigo),
): BloqueBP {
  if (ladoPresentacion === "PL") return "PATRIMONIO_LIQUIDO";

  if (rubroEECC === RUBRO_COMERCIAL) {
    const bloque = codigo.startsWith("2.1.1.02") ? "PROVEDORES_EXTERIOR" : "PROVEDORES_LOCAIS";
    return ajustarAoLado(bloque, ladoPresentacion);
  }

  const candidato = (rubroEECC && POR_RUBRO[rubroEECC]) || CATCHALL[ladoPresentacion];
  return ajustarAoLado(candidato, ladoPresentacion);
}

export function tituloBloque(key: BloqueBP): string {
  return BLOQUES.find((b) => b.key === key)?.titulo ?? key;
}
