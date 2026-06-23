// Constantes de estilo do export do Balanço Patrimonial, transcritas 1:1 da
// planilha artesanal do dono ("BP SUNSET SAS | DÓLAR.xlsx"). Mantidas em módulo
// próprio para que o renderer (balance-bp-excel.ts) reproduza o visual idêntico
// ao modelo: cabeçalhos ciano, fonte Arial, formatos contábeis [$ARS]/[$$-409],
// texto azul nos valores, código de embarque em vermelho, e a grade "boxed"
// (borda dupla à esquerda da 1ª coluna e à direita da última).
//
// Cores e formatos extraídos célula-a-célula do modelo (Arial é a fonte
// default; Tahoma itálico nos títulos de seção; números no formato contábil
// argentino). NÃO inventar — qualquer ajuste deve casar com o arquivo modelo.

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

// ----- Colunas (1-indexadas, espelham as letras do modelo) ---------------
// C=código, D=descrição, E=moeda, F=contêiner, H=ARS, I=USD (lançado),
// O=TC/espaçador, P=USD (fechamento, =SUM(I:O)), Q=SALDO (USD, seção/total).
export const COL = {
  CODIGO: 3, // C
  DESC: 4, // D
  MONEDA: 5, // E
  CONTENEDOR: 6, // F
  ARS: 8, // H
  USD_IN: 9, // I
  TC: 15, // O
  USD: 16, // P
  SALDO: 17, // Q
} as const;

// Larguras de coluna do modelo (A..Q). As colunas J..N ficam como o "miolo"
// de movimentos do modelo (vazias), preservando o espaçamento característico.
export const LARGURAS: { width: number }[] = [
  { width: 5.2 }, // A
  { width: 7.0 }, // B
  { width: 14.7 }, // C
  { width: 17.5 }, // D
  { width: 6.2 }, // E
  { width: 12.7 }, // F
  { width: 15.2 }, // G
  { width: 20.5 }, // H
  { width: 17.8 }, // I
  { width: 19.0 }, // J
  { width: 18.5 }, // K
  { width: 12.0 }, // L
  { width: 19.3 }, // M
  { width: 18.5 }, // N
  { width: 9.0 }, // O
  { width: 14.7 }, // P
  { width: 17.5 }, // Q
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

// Borda "caixa" do corpo: dupla à esquerda da 1ª coluna (C) e à direita da
// última (Q). Aplicada por coluna.
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
