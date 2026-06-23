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
type DREConceptId = ModeloDREConCheck["lineas"][number]["id"];
type DREValue = { ars: string; usd: string };
type DRECellRef = {
  row: number;
  ars: string;
  usd: string;
  saldo: string;
  arsResult: number;
  usdResult: number;
  saldoResult: number;
};

// Âncora da TC de cierre (ARS por USD), em M1 — exatamente como no modelo
// BALANÇO PATRIMONIAL NASSER.xlsx. As fórmulas ARS usam N{linha}*$M$1.
const TC_CELL = "$M$1";

// Primeira coluna de movimento. O template possui 6 colunas entre a data inicial
// e a data final: H, I, J, K, L, M. Por enquanto o sistema grava o movimento
// líquido do período na primeira coluna (H) e preserva as demais livres.
const COL_MOV1 = COL.USD_IN + 1; // H
const ZERO_DRE: DREValue = { ars: "0.00", usd: "0.00" };

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
 * Gera o .xlsx do Balanço Patrimonial reproduzindo a grade do modelo artesanal
 * em A:O: DATA INICIAL (G), 6 colunas de movimento (H:M), DATA FINAL (N) e
 * SALDO (O). Corrige a versão anterior, que deslocava a planilha para C:Q.
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

  // Cabeçalho do PASIVO (espelha a segunda metade do modelo).
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

  // TC nas duas células do modelo (F1 e M1); só M1 é referenciada.
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

  // "BP DÓLARES" sobre H..L. A 6ª coluna do miolo é M, usada no cabeçalho como TC.
  if (!ladoPasivo) {
    setText(ws, n, COL_MOV1, tituloMeio, {
      font: fonte({ bold: true }),
      align: { horizontal: "center", vertical: "middle" },
    });
    ws.mergeCells(n, COL_MOV1, n, COL.TC - 1); // H..L
  }

  // TC (âncora) em M1
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
    ws.getRow(n).getCell(c).border = mesclarBordas(bordaCaixa(c), {
      bottom: { style: "double" },
    });
  }
}

// ----- Seção (bloco) -----------------------------------------------------
function renderBloque(ctx: Ctx, bloque: BloqueModelo, ativo: boolean): SeccionRef {
  const { ws } = ctx;

  const header = ws.addRow([]);
  const headerRow = header.number;
  setText(ws, headerRow, COL.CODIGO, abreviarCodigo(bloque.key), {
    font: fonte({ bold: true, size: 9 }),
  });
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
    // No modelo, a coluna SALDO dos subtotais referencia os saldos finais em USD.
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

function abreviarCodigo(key: string): string {
  const map: Record<string, string> = {
    DISPONIBILIDADE: "DIS",
    REALIZAVEL_CURTO_PRAZO: "RCP",
    STOCK: "STO",
    PROVEDORES_EXTERIOR: "EXT",
    PATRIMONIO_LIQUIDO: "PL",
  };
  return map[key] ?? key.slice(0, 3).toUpperCase();
}

// Linha de detalhe: G=saldo inicial · H=movimento líquido · I..M livres ·
// N=SUM(G:M) · F=N×TC · O=N×TC, reproduzindo as fórmulas centrais do modelo.
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

  // MOVIMENTO do período (final − inicial) em USD, na 1ª das 6 colunas H:M.
  const mov = num(ln.usd) - num(ln.usdInicial);
  setCell(ws, n, COL_MOV1, Number(mov.toFixed(2)), {
    font: fonte(),
    numFmt: FMT.CONTABIL,
    align: { horizontal: "right", vertical: "middle" },
  });

  // DATA FINAL (fechamento) = SUM(G:M)
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

  // ARS = N × $M$1 (ou valor quando sem TC)
  const arsVal = tcCell
    ? { formula: `${colLetra(COL.USD)}${n}*${tcCell}`, result: num(ln.ars) }
    : num(ln.ars);
  setCell(ws, n, COL.ARS, arsVal, {
    font: fonte({ size: 9, color: { argb: COR.AZUL } }),
    numFmt: FMT.ARS,
    align: { horizontal: "right", vertical: "middle" },
  });

  // Coluna SALDO do modelo: detalhe convertido pela mesma TC.
  setCell(ws, n, COL.SALDO, arsVal, {
    font: fonte({ size: 9, color: { argb: COR.AZUL } }),
    numFmt: FMT.ARS,
    align: { horizontal: "right", vertical: "middle" },
  });

  for (let c = COL.CODIGO; c <= COL.SALDO; c++) {
    ws.getRow(n).getCell(c).border = mesclarBordas(bordaCaixa(c), BORDA.hair);
  }
  if (ln.codigo === "3.4") ctx.resultadoRow = n;
}

// Detalhe por embarque (informativo): código em vermelho; valor em N (data
// final), F/O em ARS. Sem saldo inicial (abertura 0). NÃO soma ao subtotal.
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
    setText(ws, n, COL.DESC, d.descripcion, {
      font: fonte({ color: { argb: COR.CINZA } }),
    });
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
    setCell(ws, n, COL.SALDO, arsVal, {
      font: fonte({ size: 9, color: { argb: COR.AZUL } }),
      numFmt: FMT.ARS,
      align: { horizontal: "right", vertical: "middle" },
    });
    for (let c = COL.CODIGO; c <= COL.SALDO; c++) {
      ws.getRow(n).getCell(c).border = bordaCaixa(c);
    }
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

// Escreve F (ARS), G (saldo inicial USD), N (data final USD) e O (SALDO USD)
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

// ----- Bloco inferior fixo do DRE / gastos -------------------------------
function renderDRE(ctx: Ctx, dre: ModeloDREConCheck, plResultadoRow?: number): void {
  const { ws } = ctx;
  const byId = new Map<DREConceptId, DREValue>();
  for (const ln of dre.lineas) byId.set(ln.id, { ars: ln.ars, usd: ln.usd });
  const value = (id: DREConceptId): DREValue => byId.get(id) ?? ZERO_DRE;

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
  setText(ws, cap.number, COL.SALDO, "SALDO", {
    font: fonte({ bold: true, italic: true }),
    align: { horizontal: "right", vertical: "middle" },
  });

  // Linhas fixas exigidas pelo modelo artesanal. Quando ainda não existe fonte
  // analítica no ERP (ex.: venda à vista vs crédito, IVA como resultado), a linha
  // permanece explícita com zero para preservar o layout 1:1.
  const vendaVista = renderDREValueRow(ctx, "Venda à vista", ZERO_DRE);
  const vendaCredito = renderDREValueRow(ctx, "Venda a Crédito", value("INGRESOS_VENTAS"));
  const provisaoIR = renderDREValueRow(ctx, "PROVISÃO IR", value("IMPUESTO_GANANCIAS"));
  const provisaoIVA = renderDREValueRow(ctx, "PROVISÃO IVA", ZERO_DRE);
  const ingressosBrutos = renderDRESubtotalRow(ctx, "INGRESSOS BRUTOS", [
    vendaVista,
    vendaCredito,
    provisaoIR,
    provisaoIVA,
  ]);

  const devolucoes = renderDREValueRow(ctx, "Devoluções", value("DEDUCCIONES"));
  const outrosIngressosOperativos = renderDREValueRow(
    ctx,
    "Outros ingressos operativos",
    value("OTROS_INGRESOS_OPERATIVOS"),
  );
  const ingressosNetos = renderDRESubtotalRow(ctx, "INGRESSOS NETOS", [
    ingressosBrutos,
    devolucoes,
    outrosIngressosOperativos,
  ]);

  const cmv = renderDREValueRow(ctx, "CMV", value("COSTO_VENTAS"));
  const rma = renderDREValueRow(ctx, "RMA", ZERO_DRE);
  const resultadoBruto = renderDRESubtotalRow(ctx, "RESULTADO BRUTO", [ingressosNetos, cmv, rma]);

  renderDRESectionRow(ctx, "GASTOS");
  const bancos = renderDREValueRow(ctx, "BANCOS", value("RESULTADOS_FINANCIEROS"));
  const gastosDiversos = renderDREValueRow(
    ctx,
    "GASTOS DIVERSOS",
    sumDREValues([
      value("GASTOS_COMERCIALIZACION"),
      value("GASTOS_ADMINISTRACION"),
      value("OTROS_GASTOS_OPERATIVOS"),
      value("OTROS_EGRESOS"),
      value("MULTAS_SANCIONES"),
      value("CAMBIOS_PROP_INVERSION"),
      value("PERDIDAS_DESVALORIZACION"),
      value("RESULTADO_VENTA_BAJA_ACTIVOS"),
      value("CONTINGENCIAS"),
    ]),
  );
  const impostos = renderDREValueRow(ctx, "impostos", {
    ars: dre.totalImpuestosArs,
    usd: dre.totalImpuestosUsd,
  });
  const publicidade = renderDREValueRow(ctx, "publicidade", ZERO_DRE);
  const garantia = renderDREValueRow(ctx, "garantia", ZERO_DRE);
  const desconto = renderDREValueRow(ctx, "desconto", ZERO_DRE);
  const seguro = renderDREValueRow(ctx, "seguro", ZERO_DRE);
  const fretes = renderDREValueRow(ctx, "fretes", ZERO_DRE);
  const totalGastos = renderDRESubtotalRow(ctx, "TOTAL GASTOS", [
    bancos,
    gastosDiversos,
    impostos,
    publicidade,
    garantia,
    desconto,
    seguro,
    fretes,
  ]);

  renderDREValueRow(ctx, "Otros ingresos", value("OTROS_INGRESOS"));
  renderDREValueRow(
    ctx,
    "Resultado neto operaciones discontinuadas",
    value("RESULTADO_OPERACIONES_DISCONTINUADAS"),
  );
  const resultadoEjercicio = renderDREValueRow(
    ctx,
    "RESULTADO DEL EJERCICIO",
    value("RESULTADO_EJERCICIO"),
    {
      bold: true,
      topDouble: true,
    },
  );
  renderDRESubtotalRow(ctx, "RESULTADO OPERACIONAL (controle)", [resultadoBruto, totalGastos], {
    muted: true,
  });

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
  if (plResultadoRow) {
    usdCheck = {
      formula: `${resultadoEjercicio.usd}-${colLetra(COL.USD)}${plResultadoRow}`,
      result: num(dre.checkUsd),
    };
    arsCheck = {
      formula: `${resultadoEjercicio.ars}-${colLetra(COL.ARS)}${plResultadoRow}`,
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
      renderDREValueRow(ctx, `  ${imp.grupo}`, { ars: imp.ars, usd: imp.usd }, { muted: true });
    }
  }
}

function renderDRESectionRow(ctx: Ctx, label: string): void {
  const { ws } = ctx;
  const r = ws.addRow([]);
  const n = r.number;
  setText(ws, n, COL.CODIGO, label, { font: fonte({ bold: true, size: 11 }) });
  for (let c = COL.CODIGO; c <= COL.SALDO; c++) {
    const cell = ws.getRow(n).getCell(c);
    cell.fill = fillSolido(COR.CIANO);
    cell.border = mesclarBordas(bordaCaixa(c), BORDA.topoDuplo);
  }
}

function renderDREValueRow(
  ctx: Ctx,
  label: string,
  value: DREValue,
  opts: { bold?: boolean; muted?: boolean; topDouble?: boolean } = {},
): DRECellRef {
  const { ws } = ctx;
  const r = ws.addRow([]);
  const n = r.number;
  const color = opts.muted ? COR.CINZA : COR.AZUL;
  const labelFont = opts.muted
    ? fonte({ bold: opts.bold, color: { argb: COR.CINZA } })
    : fonte({ bold: opts.bold });
  const arsResult = num(value.ars);
  const usdResult = num(value.usd);

  setText(ws, n, COL.DESC, label, { font: labelFont });
  setCell(ws, n, COL.ARS, arsResult, {
    font: fonte({ bold: opts.bold, size: 9, color: { argb: color } }),
    numFmt: FMT.ARS,
    align: { horizontal: "right", vertical: "middle" },
  });
  setCell(ws, n, COL.USD, usdResult, {
    font: fonte({ bold: opts.bold, size: 9, color: { argb: opts.muted ? COR.CINZA : COR.AZUL } }),
    numFmt: FMT.USD,
    align: { horizontal: "right", vertical: "middle" },
  });
  setCell(ws, n, COL.SALDO, arsResult, {
    font: fonte({ bold: opts.bold, size: 9, color: { argb: color } }),
    numFmt: FMT.ARS,
    align: { horizontal: "right", vertical: "middle" },
  });
  for (let c = COL.CODIGO; c <= COL.SALDO; c++) {
    ws.getRow(n).getCell(c).border = mesclarBordas(
      bordaCaixa(c),
      opts.topDouble ? BORDA.topoDuplo : BORDA.hair,
    );
  }
  return {
    row: n,
    ars: `${colLetra(COL.ARS)}${n}`,
    usd: `${colLetra(COL.USD)}${n}`,
    saldo: `${colLetra(COL.SALDO)}${n}`,
    arsResult,
    usdResult,
    saldoResult: arsResult,
  };
}

function renderDRESubtotalRow(
  ctx: Ctx,
  label: string,
  refs: DRECellRef[],
  opts: { muted?: boolean } = {},
): DRECellRef {
  const { ws } = ctx;
  const r = ws.addRow([]);
  const n = r.number;
  const color = opts.muted ? COR.CINZA : COR.AZUL;
  const fontColor = opts.muted ? { argb: COR.CINZA } : undefined;
  const formula = (key: keyof Pick<DRECellRef, "ars" | "usd" | "saldo">) =>
    refs.map((ref) => ref[key]).join("+") || "0";
  const arsResult = sumRefs(refs, "ars");
  const usdResult = sumRefs(refs, "usd");
  const saldoResult = sumRefs(refs, "saldo");

  setText(ws, n, COL.CODIGO, label, {
    font: fonte({ bold: true, size: 10, color: fontColor }),
  });
  setCell(
    ws,
    n,
    COL.ARS,
    { formula: formula("ars"), result: arsResult },
    {
      font: fonte({ bold: true, color: { argb: color } }),
      numFmt: FMT.ARS,
      align: { horizontal: "right", vertical: "middle" },
    },
  );
  setCell(
    ws,
    n,
    COL.USD,
    { formula: formula("usd"), result: usdResult },
    {
      font: fonte({ bold: true, color: { argb: opts.muted ? COR.CINZA : COR.AZUL } }),
      numFmt: FMT.USD,
      align: { horizontal: "right", vertical: "middle" },
    },
  );
  setCell(
    ws,
    n,
    COL.SALDO,
    { formula: formula("saldo"), result: saldoResult },
    {
      font: fonte({ bold: true, color: { argb: color } }),
      numFmt: FMT.ARS,
      align: { horizontal: "right", vertical: "middle" },
    },
  );
  for (let c = COL.CODIGO; c <= COL.SALDO; c++) {
    ws.getRow(n).getCell(c).border = mesclarBordas(bordaCaixa(c), BORDA.totalTopo);
  }
  return {
    row: n,
    ars: `${colLetra(COL.ARS)}${n}`,
    usd: `${colLetra(COL.USD)}${n}`,
    saldo: `${colLetra(COL.SALDO)}${n}`,
    arsResult,
    usdResult,
    saldoResult,
  };
}

function sumDREValues(vals: DREValue[]): DREValue {
  return {
    ars: vals.reduce((acc, v) => acc + num(v.ars), 0).toFixed(2),
    usd: vals.reduce((acc, v) => acc + num(v.usd), 0).toFixed(2),
  };
}

function sumRefs(refs: DRECellRef[], key: "ars" | "usd" | "saldo"): number {
  switch (key) {
    case "ars":
      return refs.reduce((acc, ref) => acc + ref.arsResult, 0);
    case "usd":
      return refs.reduce((acc, ref) => acc + ref.usdResult, 0);
    case "saldo":
      return refs.reduce((acc, ref) => acc + ref.saldoResult, 0);
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
