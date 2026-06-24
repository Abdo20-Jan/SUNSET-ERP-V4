// Constantes de estilo do export do Balanço Patrimonial, transcritas 1:1 da
// planilha artesanal do dono ("BALANÇO PATRIMONIAL NASSER.xlsx"). Mantidas em
// módulo próprio para que o renderer (balance-bp-excel.ts) reproduza o visual do
// modelo: cabeçalhos ciano, fonte Arial, formatos contábeis [$ARS]/[$$-409],
// texto azul nos valores, código de embarque em vermelho, e a grade "boxed".
//
// IMPORTANTE: o template real trabalha na grade A:O. A versão anterior do
// exportador deslocava tudo para C:Q, o que quebrava fórmulas, bordas, larguras e
// a leitura visual do BP.

import type { Borders, Fill, Font } from "exceljs";

// ----- Cores (ARGB) ------------------------------------------------------
export const COR = {
  CIANO: "FFCCFFFF", // fill dos cabeçalhos de seção do ATIVO
  AZUL: "FF0070C0", // texto dos valores ARS/USD
  VERMELHO: "FFFF0000", // código de embarque (EM TRÂNSITO / EXTERIOR)
  NAVY: "FF002060", // conferência do DRE
  CINZA: "FF666666", // notas/subtítulos
  VERDE_OK: "FF177245", // ✓ confere
  VERMELHO_ERRO: "FFB00020", // ▲ diferença
} as const;

// ----- Formatos numéricos (transcritos do modelo) ------------------------
export const FMT = {
  // Contábil sem símbolo: _(* #,##0.00_);_(* (#,##0.00);_(* "-"??_);_(@_)
  CONTABIL: '_(* #,##0.00_);_(* \\(#,##0.00\\);_(* "-"??_);_(@_)',
  // Pesos argentinos: [$ARS] #,##0.00
  ARS: "[$ARS]\\ #,##0.00",
  // Dólar (locale 409): _-[$$-409]* #,##0.00_ ;_-[$$-409]* -#,##0.00 ;…
  USD: '_-[$$-409]* #,##0.00_ ;_-[$$-409]* \\-#,##0.00\\ ;_-[$$-409]* "-"??_ ;_-@_ ',
  DATA: "d-mmm",
} as const;

// ----- Fontes ------------------------------------------------------------
export const FONTE = "Arial";
export const FONTE_TITULO = "Tahoma"; // títulos de seção (itálico no modelo)

export function fonte(opts: Partial<Font> = {}): Partial<Font> {
  return { name: FONTE, size: 10, ...opts };
}

// ----- Colunas (1-indexadas, espelham as letras do modelo A:O) -----------
// A=código, B=descrição, C/D/E=colunas auxiliares/espaçadores do template,
// F=ARS, G=data inicial/saldo inicial USD, H:M=6 colunas de movimento,
// M=TC de cierre no cabeçalho, N=data final/saldo final USD, O=SALDO.
export const COL = {
  CODIGO: 1, // A
  DESC: 2, // B
  MONEDA: 3, // C
  CONTENEDOR: 4, // D
  AUX: 5, // E
  ARS: 6, // F
  USD_IN: 7, // G
  TC: 13, // M
  USD: 14, // N
  SALDO: 15, // O
} as const;

// Larguras de coluna do modelo (A..O). Correspondem ao miolo real da planilha
// artesanal; antes o export usava A..Q e deixava duas colunas mortas à esquerda.
export const LARGURAS: { width: number }[] = [
  { width: 14.7 }, // A
  { width: 17.5 }, // B
  { width: 6.2 }, // C
  { width: 12.7 }, // D
  { width: 15.2 }, // E
  { width: 20.5 }, // F
  { width: 17.8 }, // G
  { width: 19.0 }, // H
  { width: 18.5 }, // I
  { width: 12.0 }, // J
  { width: 19.3 }, // K
  { width: 18.5 }, // L
  { width: 9.0 }, // M
  { width: 14.7 }, // N
  { width: 17.5 }, // O
];

// ----- Fills -------------------------------------------------------------
export function fillSolido(argb: string): Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

// ----- Bordas ------------------------------------------------------------
type BorderStyle = NonNullable<Borders["top"]>["style"];
function lado(style: BorderStyle) {
  return { style };
}

// Borda "caixa" do corpo: dupla à esquerda da 1ª coluna (A) e à direita da
// última (O). Aplicada por coluna.
export function bordaCaixa(col: number): Partial<Borders> {
  if (col === COL.CODIGO) return { left: lado("double") };
  if (col === COL.SALDO) return { right: lado("double") };
  return {};
}

// Bordas horizontais comuns por tipo de linha (espelham o modelo).
export const BORDA = {
  hair: { top: lado("hair"), bottom: lado("hair") } as Partial<Borders>,
  topoDuplo: { top: lado("double"), bottom: lado("hair") } as Partial<Borders>,
  totalTopo: { top: lado("thin"), bottom: lado("double") } as Partial<Borders>,
} as const;

export function mesclarBordas(...bs: Partial<Borders>[]): Partial<Borders> {
  return Object.assign({}, ...bs);
}
