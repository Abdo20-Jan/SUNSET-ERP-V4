import "server-only";

import ExcelJS from "exceljs";

import {
  BORDA,
  COL,
  COR,
  FMT,
  FONTE_TITULO,
  LARGURAS,
  bordaCaixa,
  fillSolido,
  fonte,
  mesclarBordas,
} from "./balance-bp-estilo";
import type { BalanceBPModelo, BloqueModelo, LineaBP } from "./balance-bp-modelo";

type ModeloDREConCheck = NonNullable<BalanceBPModelo["dre"]>;

// Âncora da TC de cierre (ARS por USD), em O1 — espelha o modelo (H = USD × O1).
const TC_CELL = "$O$1";
// Primeira coluna de movimento (das 6 entre data inicial e data final). O
// movimento líquido do período (final − inicial) é gravado aqui; as demais
// (K..O) ficam livres para lançamentos manuais, como na planilha do dono.
const COL_MOV1 = COL.USD_IN + 1; // J

function num(s: string): number {
  return Number(s);
}

function colLetra(col: number): string {
  let s = "";
  let n = col;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function aData(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Gera o .xlsx do Balanço Patrimonial reproduzindo 1:1 a planilha artesanal do
 * dono ("BP SUNSET SAS | DÓLAR"): grade boxed (cols C..Q), cabeçalho com
 * DATA INICIAL · 6 colunas de movimento ("BP DÓLARES") · DATA FINAL · SALDO,
 * cabeçalhos de seção ciano, fonte Arial/Tahoma, formatos [$ARS]/[$$-409],
 * valores em azul, código de embarque em vermelho, e fórmulas vivas:
 *   H (ARS) = P × $O$1 · P (data final) = SUM(I:O) · subtotais/totais via SUM.
 */
export async function generarBalanceBPExcel(modelo: BalanceBPModelo): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Sunset ERP";
  const ws = wb.addWorksheet("BP SUNSET SAS DÓLAR", { views: [{ showGridLines: false }] });
  ws.columns = LARGURAS;

  const ctx: Ctx = { ws, tcCell: modelo.tc ? TC_CELL : null };

  // Linha 1 = cabeçalho do ATIVO (datas, BP DÓLARES, TC, SALDO).
  renderCabecalhoLinha(ctx, modelo, "BP DÓLARES");

  // ATIVO — seções fluem direto (sem faixa "ATIVO", como no modelo).
  const ativoSecs = modelo.ativo.map((b) => renderBloque(ctx, b, true));
  const totalAtivoRow = renderTotal(ctx, "TOTAL ATIVO", ativoSecs, modelo);

  // Cabeçalho do PASIVO (espelha a linha 58 do modelo).
  ws.addRow([]);
  renderCabecalhoLinha(ctx, modelo, "OBRIGAÇÕES + ORIGENS + PATRIMONIO LÍQUIDO", true);

  const pasivoSecs = modelo.pasivo.map((b) => renderBloque(ctx, b, false));
  const totalPasivoRow = renderTotal(ctx, "TOTAL PASIVO", pasivoSecs, modelo);

  const plSecs = modelo.pl.map((b) => renderBloque(ctx, b, false));
  const plResultadoRow = ctx.resultadoRow;

  const saldoCredorRow = renderSaldoCredor(ctx, totalPasivoRow, plSecs, modelo);
  renderCheck(ctx, modelo, totalAtivoRow, saldoCredorRow);

  if (modelo.dre) renderDRE(ctx, modelo.dre, plResultadoRow);

  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf);
}

type Ctx = {
  ws: ExcelJS.Worksheet;
  tcCell: string | null;
  resultadoRow?: number;
};

type SeccionRef = { headerRow: number };

// ----- Cabeçalho (data inicial · BP DÓLARES · TC · data final · SALDO) ----
function renderCabecalhoLinha(
  ctx: Ctx,
  modelo: BalanceBPModelo,
  tituloMeio: string,
  ladoPasivo = false,
): void {
  const { ws } = ctx;
  const r = ws.addRow([]);
  const n = r.number;

  if (ladoPasivo) {
    setText(ws, n, COL.CODIGO, "CUENTA", { font: fonte({ bold: true, size: 8 }) });
    setText(ws, n, COL.DESC, tituloMeio, { font: fonte({ bold: true, size: 9 }) });
  }
  // TC nas duas células do modelo (H1 e O1); só O1 é referenciada.
  const tcNum = modelo.tc ? num(modelo.tc) : null;
  setCell(ws, n, COL.ARS, tcNum, {
    font: fonte({ bold: true, size: 9 }),
    numFmt: FMT.CONTABIL,
    align: { horizontal: "center", vertical: "middle" },
  });
  // DATA INICIAL
  const dIni = aData(modelo.fechaInicial);
  setCell(ws, n, COL.USD_IN, dIni ?? "—", {
    font: fonte({ bold: true }),
    numFmt: dIni ? FMT.DATA : undefined,
    align: { horizontal: "center", vertical: "middle" },
  });
  // "BP DÓLARES" sobre as 6 colunas de movimento (J..N) — só no cabeçalho ativo.
  if (!ladoPasivo) {
    setText(ws, n, COL_MOV1, tituloMeio, {
      font: fonte({ bold: true }),
      align: { horizontal: "center", vertical: "middle" },
    });
    ws.mergeCells(n, COL_MOV1, n, COL.TC - 1); // J..N
  }
  // TC (âncora) em O1
  setCell(ws, n, COL.TC, tcNum, {
    font: fonte({ bold: true, size: 9, color: { argb: COR.VERMELHO } }),
    numFmt: FMT.CONTABIL,
    align: { horizontal: "center", vertical: "middle" },
  });
  // DATA FINAL
  const dFim = aData(modelo.fechaFinal);
  setCell(ws, n, COL.USD, dFim ?? modelo.fechaFinal, {
    font: fonte({ bold: true }),
    numFmt: dFim ? FMT.DATA : undefined,
    align: { horizontal: "center", vertical: "middle" },
  });
  // SALDO
  setText(ws, n, COL.SALDO, "SALDO", {
    font: fonte({ bold: true, size: 8 }),
    align: { horizontal: "right", vertical: "middle" },
  });
  for (let c = COL.CODIGO; c <= COL.SALDO; c++) {
    ws.getRow(n).getCell(c).border = mesclarBordas(bordaCaixa(c), { bottom: { style: "double" } });
  }
}

// ----- Seção (bloco) -----------------------------------------------------
function renderBloque(ctx: Ctx, bloque: BloqueModelo, ativo: boolean): SeccionRef {
  const { ws } = ctx;

  const header = ws.addRow([]);
  const headerRow = header.number;
  setText(ws, headerRow, COL.DESC, bloque.titulo, {
    font: { name: FONTE_TITULO, size: 8, italic: true },
    align: { horizontal: "left", vertical: "middle" },
  });

  const firstDetail = headerRow + 1;
  for (const ln of bloque.lineas) renderLinha(ctx, ln);
  const lastDetail = headerRow + bloque.lineas.length;

  // Subtotais (fórmula viva) na linha do cabeçalho, à direita — como no modelo.
  if (bloque.lineas.length > 0) {
    const rng = (col: number) => `${colLetra(col)}${firstDetail}:${colLetra(col)}${lastDetail}`;
    setCell(
      ws,
      headerRow,
      COL.ARS,
      { formula: `SUM(${rng(COL.ARS)})`, result: num(bloque.subtotalArs) },
      {
        font: fonte({ bold: true, size: 9, color: { argb: COR.AZUL } }),
        numFmt: FMT.ARS,
        align: { horizontal: "right", vertical: "middle" },
      },
    );
    setCell(
      ws,
      headerRow,
      COL.USD_IN,
      { formula: `SUM(${rng(COL.USD_IN)})`, result: num(bloque.subtotalUsdInicial) },
      {
        font: fonte({ bold: true, size: 9 }),
        numFmt: FMT.CONTABIL,
        align: { horizontal: "right", vertical: "middle" },
      },
    );
    setCell(
      ws,
      headerRow,
      COL.USD,
      { formula: `SUM(${rng(COL.USD)})`, result: num(bloque.subtotalUsd) },
      {
        font: fonte({ bold: true, size: 9 }),
        numFmt: FMT.USD,
        align: { horizontal: "right", vertical: "middle" },
      },
    );
    setCell(
      ws,
      headerRow,
      COL.SALDO,
      { formula: `SUM(${rng(COL.USD)})`, result: num(bloque.subtotalUsd) },
      {
        font: fonte({ bold: true }),
        numFmt: FMT.USD,
        align: { horizontal: "right", vertical: "middle" },
      },
    );
  } else {
    setCell(ws, headerRow, COL.SALDO, num(bloque.subtotalUsd), {
      font: fonte({ bold: true }),
      numFmt: FMT.USD,
      align: { horizontal: "right", vertical: "middle" },
    });
  }

  for (let c = COL.CODIGO; c <= COL.SALDO; c++) {
    const cell = ws.getRow(headerRow).getCell(c);
    if (ativo) cell.fill = fillSolido(COR.CIANO);
    cell.border = mesclarBordas(
      bordaCaixa(c),
      ativo ? BORDA.topoDuplo : { top: { style: "double" } },
    );
  }

  renderDetalle(ctx, bloque);
  return { headerRow };
}

// Linha de detalhe: I=saldo inicial (data inicial) · J=movimento líquido ·
// K..O livres · P=SUM(I:O) (data final) · H=P×TC (ARS).
function renderLinha(ctx: Ctx, ln: LineaBP): void {
  const { ws, tcCell } = ctx;
  const r = ws.addRow([]);
  const n = r.number;
  setText(ws, n, COL.CODIGO, ln.codigo, { font: fonte() });
  setText(ws, n, COL.DESC, ln.descripcion, { font: fonte() });

  // DATA INICIAL (saldo de abertura em USD)
  setCell(ws, n, COL.USD_IN, num(ln.usdInicial), {
    font: fonte(),
    numFmt: FMT.CONTABIL,
    align: { horizontal: "right", vertical: "middle" },
  });
  // MOVIMENTO do período (final − inicial) em USD, na 1ª coluna de movimento.
  const mov = num(ln.usd) - num(ln.usdInicial);
  setCell(ws, n, COL_MOV1, Number(mov.toFixed(2)), {
    font: fonte(),
    numFmt: FMT.CONTABIL,
    align: { horizontal: "right", vertical: "middle" },
  });
  // DATA FINAL (fechamento) = SUM(I:O)
  setCell(
    ws,
    n,
    COL.USD,
    { formula: `SUM(${colLetra(COL.USD_IN)}${n}:${colLetra(COL.TC)}${n})`, result: num(ln.usd) },
    {
      font: fonte({ size: 9, color: { argb: COR.AZUL } }),
      numFmt: FMT.USD,
      align: { horizontal: "right", vertical: "middle" },
    },
  );
  // ARS = P × TC (ou valor quando sem TC)
  const arsVal = tcCell
    ? { formula: `${colLetra(COL.USD)}${n}*${tcCell}`, result: num(ln.ars) }
    : num(ln.ars);
  setCell(ws, n, COL.ARS, arsVal, {
    font: fonte({ size: 9, color: { argb: COR.AZUL } }),
    numFmt: FMT.ARS,
    align: { horizontal: "right", vertical: "middle" },
  });
  for (let c = COL.CODIGO; c <= COL.SALDO; c++) {
    ws.getRow(n).getCell(c).border = mesclarBordas(bordaCaixa(c), BORDA.hair);
  }
  if (ln.codigo === "3.4") ctx.resultadoRow = n;
}

// Detalhe por embarque (informativo): código em vermelho; valor em P (data
// final) e H (ARS). Sem saldo inicial (abertura 0). NÃO soma ao subtotal.
function renderDetalle(ctx: Ctx, bloque: BloqueModelo): void {
  const { ws, tcCell } = ctx;
  const detalle = bloque.detalle;
  if (!detalle || detalle.length === 0) return;

  const dh = ws.addRow([]);
  setText(ws, dh.number, COL.DESC, "Detalle por embarque (informativo)", {
    font: fonte({ italic: true, size: 9, color: { argb: COR.CINZA } }),
  });
  for (const d of detalle) {
    const r = ws.addRow([]);
    const n = r.number;
    setText(ws, n, COL.CODIGO, d.embarqueCodigo, {
      font: fonte({ color: { argb: COR.VERMELHO } }),
    });
    setText(ws, n, COL.DESC, d.descripcion, { font: fonte({ color: { argb: COR.CINZA } }) });
    setCell(ws, n, COL.USD, num(d.usd), {
      font: fonte({ size: 9, color: { argb: COR.AZUL } }),
      numFmt: FMT.USD,
      align: { horizontal: "right", vertical: "middle" },
    });
    const arsVal = tcCell
      ? { formula: `${colLetra(COL.USD)}${n}*${tcCell}`, result: num(d.ars) }
      : num(d.ars);
    setCell(ws, n, COL.ARS, arsVal, {
      font: fonte({ size: 9, color: { argb: COR.AZUL } }),
      numFmt: FMT.ARS,
      align: { horizontal: "right", vertical: "middle" },
    });
    for (let c = COL.CODIGO; c <= COL.SALDO; c++) ws.getRow(n).getCell(c).border = bordaCaixa(c);
  }
}

// ----- Totais ------------------------------------------------------------
function renderTotal(ctx: Ctx, label: string, secs: SeccionRef[], modelo: BalanceBPModelo): number {
  const { ws } = ctx;
  const r = ws.addRow([]);
  const n = r.number;
  setText(ws, n, COL.CODIGO, label, { font: fonte({ bold: true, size: 11 }) });
  const cells = (col: number) => secs.map((s) => `${colLetra(col)}${s.headerRow}`);
  const ehAtivo = label.includes("ATIVO");
  somaCols(ws, n, cells, {
    ars: ehAtivo ? modelo.totalAtivoArs : modelo.totalPasivoArs,
    usdIni: ehAtivo ? modelo.totalAtivoUsdInicial : modelo.totalPasivoUsdInicial,
    usd: ehAtivo ? modelo.totalAtivoUsd : modelo.totalPasivoUsd,
  });
  for (let c = COL.CODIGO; c <= COL.SALDO; c++) {
    ws.getRow(n).getCell(c).border = mesclarBordas(bordaCaixa(c), BORDA.totalTopo);
  }
  return n;
}

function renderSaldoCredor(
  ctx: Ctx,
  totalPasivoRow: number,
  plSecs: SeccionRef[],
  modelo: BalanceBPModelo,
): number {
  const { ws } = ctx;
  const r = ws.addRow([]);
  const n = r.number;
  setText(ws, n, COL.CODIGO, "SALDO CREDOR", { font: fonte({ bold: true, size: 11 }) });
  const refs = [{ headerRow: totalPasivoRow }, ...plSecs];
  const cells = (col: number) => refs.map((s) => `${colLetra(col)}${s.headerRow}`);
  somaCols(ws, n, cells, {
    ars: (num(modelo.totalPasivoArs) + num(modelo.totalPlArs)).toFixed(2),
    usdIni: (num(modelo.totalPasivoUsdInicial) + num(modelo.totalPlUsdInicial)).toFixed(2),
    usd: (num(modelo.totalPasivoUsd) + num(modelo.totalPlUsd)).toFixed(2),
  });
  for (let c = COL.CODIGO; c <= COL.SALDO; c++) {
    ws.getRow(n).getCell(c).border = mesclarBordas(bordaCaixa(c), BORDA.totalTopo);
  }
  return n;
}

// Escreve H (ARS), I (saldo inicial USD), P (data final USD) e Q (SALDO USD)
// como somas das células referenciadas, com resultados em cache.
function somaCols(
  ws: ExcelJS.Worksheet,
  n: number,
  cells: (col: number) => string[],
  res: { ars: string; usdIni: string; usd: string },
): void {
  setCell(
    ws,
    n,
    COL.ARS,
    { formula: cells(COL.ARS).join("+"), result: num(res.ars) },
    {
      font: fonte({ bold: true, color: { argb: COR.AZUL } }),
      numFmt: FMT.ARS,
      align: { horizontal: "right", vertical: "middle" },
    },
  );
  setCell(
    ws,
    n,
    COL.USD_IN,
    { formula: cells(COL.USD_IN).join("+"), result: num(res.usdIni) },
    {
      font: fonte({ bold: true }),
      numFmt: FMT.CONTABIL,
      align: { horizontal: "right", vertical: "middle" },
    },
  );
  setCell(
    ws,
    n,
    COL.USD,
    { formula: cells(COL.USD).join("+"), result: num(res.usd) },
    {
      font: fonte({ bold: true }),
      numFmt: FMT.USD,
      align: { horizontal: "right", vertical: "middle" },
    },
  );
  setCell(
    ws,
    n,
    COL.SALDO,
    { formula: cells(COL.SALDO).join("+"), result: num(res.usd) },
    {
      font: fonte({ bold: true }),
      numFmt: FMT.USD,
      align: { horizontal: "right", vertical: "middle" },
    },
  );
}

function renderCheck(
  ctx: Ctx,
  modelo: BalanceBPModelo,
  totalAtivoRow: number,
  saldoCredorRow: number,
): void {
  const { ws } = ctx;
  ws.addRow([]);
  const r = ws.addRow([]);
  const n = r.number;
  const cor = modelo.cuadra ? COR.VERDE_OK : COR.VERMELHO_ERRO;
  setText(ws, n, COL.CODIGO, modelo.cuadra ? "✓ CONFERE (ATIVO = PASIVO + PL)" : "▲ DIFERENÇA", {
    font: fonte({ bold: true, color: { argb: cor } }),
  });
  const sub = (col: number, result: number) =>
    setCell(
      ws,
      n,
      col,
      { formula: `${colLetra(col)}${totalAtivoRow}-${colLetra(col)}${saldoCredorRow}`, result },
      {
        font: fonte({ bold: true, color: { argb: cor } }),
        numFmt: col === COL.ARS ? FMT.ARS : FMT.USD,
        align: { horizontal: "right", vertical: "middle" },
      },
    );
  sub(COL.SALDO, num(modelo.checkUsd));
  sub(COL.ARS, num(modelo.checkArs));
}

// ----- Bloco "Conferindo o DRE" ------------------------------------------
function renderDRE(ctx: Ctx, dre: ModeloDREConCheck, plResultadoRow?: number): void {
  const { ws } = ctx;
  ws.addRow([]);
  const head = ws.addRow([]);
  setText(ws, head.number, COL.CODIGO, "CONFERINDO O DRE", {
    font: fonte({ bold: true, size: 12 }),
  });
  for (let c = COL.CODIGO; c <= COL.SALDO; c++) {
    ws.getRow(head.number).getCell(c).fill = fillSolido(COR.CIANO);
    ws.getRow(head.number).getCell(c).border = bordaCaixa(c);
  }
  ws.mergeCells(head.number, COL.CODIGO, head.number, COL.SALDO);

  const cap = ws.addRow([]);
  setText(ws, cap.number, COL.DESC, "Concepto", { font: fonte({ bold: true, italic: true }) });
  setText(ws, cap.number, COL.ARS, "ARS", {
    font: fonte({ bold: true, italic: true }),
    align: { horizontal: "right", vertical: "middle" },
  });
  setText(ws, cap.number, COL.USD, "USD", {
    font: fonte({ bold: true, italic: true }),
    align: { horizontal: "right", vertical: "middle" },
  });

  const usdCells: string[] = [];
  const arsCells: string[] = [];
  let resultadoUsdAddr: string | undefined;
  let resultadoArsAddr: string | undefined;

  for (const ln of dre.lineas) {
    const r = ws.addRow([]);
    const nn = r.number;
    setText(ws, nn, COL.DESC, ln.label, {
      font: fonte({ bold: ln.tipo === "subtotal" && ln.enfasis }),
    });
    const usdAddr = `${colLetra(COL.USD)}${nn}`;
    const arsAddr = `${colLetra(COL.ARS)}${nn}`;
    if (ln.tipo === "subtotal") {
      const usdVal =
        usdCells.length > 0
          ? { formula: `SUM(${usdCells.join(",")})`, result: num(ln.usd) }
          : num(ln.usd);
      const arsVal =
        arsCells.length > 0
          ? { formula: `SUM(${arsCells.join(",")})`, result: num(ln.ars) }
          : num(ln.ars);
      setCell(ws, nn, COL.USD, usdVal, {
        font: fonte({ bold: ln.enfasis }),
        numFmt: FMT.USD,
        align: { horizontal: "right", vertical: "middle" },
      });
      setCell(ws, nn, COL.ARS, arsVal, {
        font: fonte({ bold: ln.enfasis, color: { argb: COR.AZUL } }),
        numFmt: FMT.ARS,
        align: { horizontal: "right", vertical: "middle" },
      });
      if (ln.esResultado) {
        resultadoUsdAddr = usdAddr;
        resultadoArsAddr = arsAddr;
      }
    } else {
      setCell(ws, nn, COL.USD, num(ln.usd), {
        font: fonte({ size: 9 }),
        numFmt: FMT.USD,
        align: { horizontal: "right", vertical: "middle" },
      });
      setCell(ws, nn, COL.ARS, num(ln.ars), {
        font: fonte({ size: 9, color: { argb: COR.AZUL } }),
        numFmt: FMT.ARS,
        align: { horizontal: "right", vertical: "middle" },
      });
      usdCells.push(usdAddr);
      arsCells.push(arsAddr);
    }
  }

  ws.addRow([]);
  const cuadra = num(dre.checkArs) === 0 && num(dre.checkUsd) === 0;
  const chk = ws.addRow([]);
  const cn = chk.number;
  setText(
    ws,
    cn,
    COL.CODIGO,
    cuadra ? "✓ CONFERE (DRE = Resultado del PL)" : "▲ DIFERENÇA DRE vs PL",
    {
      font: fonte({ bold: true, color: { argb: cuadra ? COR.VERDE_OK : COR.VERMELHO_ERRO } }),
    },
  );
  let usdCheck: ExcelJS.CellValue = num(dre.checkUsd);
  let arsCheck: ExcelJS.CellValue = num(dre.checkArs);
  if (plResultadoRow && resultadoUsdAddr && resultadoArsAddr) {
    usdCheck = {
      formula: `${resultadoUsdAddr}-${colLetra(COL.USD)}${plResultadoRow}`,
      result: num(dre.checkUsd),
    };
    arsCheck = {
      formula: `${resultadoArsAddr}-${colLetra(COL.ARS)}${plResultadoRow}`,
      result: num(dre.checkArs),
    };
  }
  setCell(ws, cn, COL.USD, usdCheck, {
    font: fonte({ bold: true, color: { argb: COR.NAVY } }),
    numFmt: FMT.USD,
    align: { horizontal: "right", vertical: "middle" },
  });
  setCell(ws, cn, COL.ARS, arsCheck, {
    font: fonte({ bold: true, color: { argb: COR.NAVY } }),
    numFmt: FMT.ARS,
    align: { horizontal: "right", vertical: "middle" },
  });

  if (dre.impuestos.length > 0) {
    ws.addRow([]);
    const ih = ws.addRow([]);
    setText(ws, ih.number, COL.DESC, "Impuestos del ejercicio (detalle AR)", {
      font: fonte({ bold: true, italic: true, color: { argb: COR.CINZA } }),
    });
    for (const imp of dre.impuestos) {
      const r = ws.addRow([]);
      const nn = r.number;
      setText(ws, nn, COL.DESC, `  ${imp.grupo}`, { font: fonte({ color: { argb: COR.CINZA } }) });
      setCell(ws, nn, COL.USD, num(imp.usd), {
        font: fonte({ size: 9, color: { argb: COR.CINZA } }),
        numFmt: FMT.USD,
        align: { horizontal: "right", vertical: "middle" },
      });
      setCell(ws, nn, COL.ARS, num(imp.ars), {
        font: fonte({ size: 9, color: { argb: COR.CINZA } }),
        numFmt: FMT.ARS,
        align: { horizontal: "right", vertical: "middle" },
      });
    }
    const tot = ws.addRow([]);
    const tn = tot.number;
    setText(ws, tn, COL.DESC, "  Total impuestos del ejercicio", {
      font: fonte({ bold: true, italic: true, color: { argb: COR.CINZA } }),
    });
    setCell(ws, tn, COL.USD, num(dre.totalImpuestosUsd), {
      font: fonte({ bold: true, color: { argb: COR.CINZA } }),
      numFmt: FMT.USD,
      align: { horizontal: "right", vertical: "middle" },
    });
    setCell(ws, tn, COL.ARS, num(dre.totalImpuestosArs), {
      font: fonte({ bold: true, color: { argb: COR.CINZA } }),
      numFmt: FMT.ARS,
      align: { horizontal: "right", vertical: "middle" },
    });
  }
}

// ----- Helpers de célula -------------------------------------------------
type CellStyle = {
  font?: Partial<ExcelJS.Font>;
  numFmt?: string;
  align?: Partial<ExcelJS.Alignment>;
  fill?: ExcelJS.Fill;
};

function setCell(
  ws: ExcelJS.Worksheet,
  row: number,
  col: number,
  value: ExcelJS.CellValue,
  style: CellStyle = {},
): void {
  const cell = ws.getRow(row).getCell(col);
  cell.value = value;
  if (style.font) cell.font = style.font;
  if (style.numFmt) cell.numFmt = style.numFmt;
  if (style.align) cell.alignment = style.align;
  if (style.fill) cell.fill = style.fill;
}

function setText(
  ws: ExcelJS.Worksheet,
  row: number,
  col: number,
  text: string,
  style: CellStyle = {},
): void {
  setCell(ws, row, col, text, { font: fonte(), ...style });
}
