import "server-only";

import ExcelJS from "exceljs";

import type { BalanceBPModelo, BloqueModelo } from "./balance-bp-modelo";

// O bloco DRE do modelo inclui a conferência ▲ (checkArs/checkUsd) que
// construirModeloBP calcula sobre o ModeloDRE base.
type ModeloDREConCheck = NonNullable<BalanceBPModelo["dre"]>;

const FMT_MONEY = "#,##0.00";
const COL_USD = 3;
const COL_ARS = 4;

// O modelo guarda os valores como string (toFixed(2)); convertemos para Number
// na hora de escrever a célula para que o number-format do Excel se aplique
// (numFmt em célula de texto é ignorado).
function num(s: string): number {
  return Number(s);
}

// Geração do .xlsx do Balanço Patrimonial no formato artesanal do dono.
// Colunas: Código · Descrição · USD · ARS. Blocos em PT, subtotais por bloco e
// totais por lado + linha de conferência (▲).
export async function generarBalanceBPExcel(modelo: BalanceBPModelo): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Sunset ERP";
  const ws = wb.addWorksheet("BP SUNSET SAS DÓLAR");

  ws.columns = [
    { key: "codigo", width: 16 },
    { key: "descripcion", width: 50 },
    { key: "usd", width: 18 },
    { key: "ars", width: 18 },
  ];

  // Cabeçalho
  const titulo = ws.addRow(["BALANÇO PATRIMONIAL — SUNSET TIRES CORPORATION SAS"]);
  titulo.font = { bold: true, size: 13 };
  ws.mergeCells(titulo.number, 1, titulo.number, 4);

  const tcTxt = modelo.tc ? `TC de cierre ${modelo.tc}` : "sin cotización de cierre (USD = ARS)";
  const sub = ws.addRow([`Saldo al ${modelo.fecha}`, "", `${tcTxt}`, ""]);
  sub.font = { italic: true, color: { argb: "FF666666" } };

  ws.addRow([]);
  const cab = ws.addRow(["Código", "Descrição", "USD", "ARS"]);
  cab.font = { bold: true };
  cab.eachCell((c) => {
    c.border = { bottom: { style: "thin" } };
  });

  renderSeccion(
    ws,
    "ATIVO",
    modelo.ativo,
    "TOTAL ATIVO",
    modelo.totalAtivoUsd,
    modelo.totalAtivoArs,
  );
  renderSeccion(
    ws,
    "PASIVO",
    modelo.pasivo,
    "TOTAL PASIVO",
    modelo.totalPasivoUsd,
    modelo.totalPasivoArs,
  );
  const pl = renderSeccion(
    ws,
    "PATRIMONIO LÍQUIDO",
    modelo.pl,
    "TOTAL PATRIMONIO LÍQUIDO",
    modelo.totalPlUsd,
    modelo.totalPlArs,
  );

  ws.addRow([]);
  const check = ws.addRow([
    modelo.cuadra ? "✓ CONFERE (ATIVO = PASIVO + PL)" : "▲ DIFERENÇA",
    "",
    num(modelo.checkUsd),
    num(modelo.checkArs),
  ]);
  check.font = { bold: true, color: { argb: modelo.cuadra ? "FF177245" : "FFB00020" } };
  setMoney(check);

  if (modelo.dre) renderDRE(ws, modelo.dre, pl.resultadoRow);

  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf);
}

type RenderSeccionResult = { resultadoRow?: ExcelJS.Row };

function renderSeccion(
  ws: ExcelJS.Worksheet,
  titulo: string,
  bloques: BloqueModelo[],
  totalLabel: string,
  totalUsd: string,
  totalArs: string,
): RenderSeccionResult {
  ws.addRow([]);
  const head = ws.addRow([titulo]);
  head.font = { bold: true, size: 12 };
  head.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF4" } };
  });
  ws.mergeCells(head.number, 1, head.number, 4);

  let resultadoRow: ExcelJS.Row | undefined;
  for (const bloque of bloques) {
    const bh = ws.addRow([bloque.titulo]);
    bh.font = { bold: true };
    for (const ln of bloque.lineas) {
      const r = ws.addRow([ln.codigo, ln.descripcion, num(ln.usd), num(ln.ars)]);
      setMoney(r);
      // RESULTADO DEL EJERCICIO (codigo "3.4") → referenciada pela conferência do DRE.
      if (ln.codigo === "3.4") resultadoRow = r;
    }
    const st = ws.addRow([
      `  Subtotal ${bloque.titulo}`,
      "",
      num(bloque.subtotalUsd),
      num(bloque.subtotalArs),
    ]);
    st.font = { italic: true };
    setMoney(st);
    renderDetalle(ws, bloque);
  }

  const total = ws.addRow([totalLabel, "", num(totalUsd), num(totalArs)]);
  total.font = { bold: true };
  total.eachCell((c) => {
    c.border = { top: { style: "thin" } };
  });
  setMoney(total);
  return { resultadoRow };
}

// Bloco "Conferindo o DRE": cascata RT9 (USD+ARS) com fórmulas vivas — cada
// subtotal/resultado é um SUM dos conceptos-conta acima; a conferência ▲
// referencia o RESULTADO do PL (= 0 por construção). Abaixo, o detalhe dos
// impostos de resultado (taxonomia AR).
function renderDRE(
  ws: ExcelJS.Worksheet,
  dre: ModeloDREConCheck,
  plResultadoRow?: ExcelJS.Row,
): void {
  ws.addRow([]);
  const head = ws.addRow(["CONFERINDO O DRE"]);
  head.font = { bold: true, size: 12 };
  head.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF4" } };
  });
  ws.mergeCells(head.number, 1, head.number, 4);

  const cab = ws.addRow(["", "Concepto", "USD", "ARS"]);
  cab.font = { bold: true, italic: true };

  // Células-conta acumuladas (para os SUM vivos dos subtotais).
  const usdCells: string[] = [];
  const arsCells: string[] = [];
  let resultadoUsdAddr: string | undefined;
  let resultadoArsAddr: string | undefined;

  for (const ln of dre.lineas) {
    const r = ws.addRow(["", ln.label, num(ln.usd), num(ln.ars)]);
    setMoney(r);
    const usdCell = r.getCell(COL_USD);
    const arsCell = r.getCell(COL_ARS);
    if (ln.tipo === "subtotal") {
      r.font = { bold: ln.enfasis };
      // SUM vivo dos conceptos-conta acima (a cascata RT9 é soma corrida; as
      // linhas guardam o valor ASSINADO, então um SUM simples = acumulado).
      if (usdCells.length > 0) {
        usdCell.value = { formula: `SUM(${usdCells.join(",")})`, result: num(ln.usd) };
        arsCell.value = { formula: `SUM(${arsCells.join(",")})`, result: num(ln.ars) };
      }
      // Referência da conferência: a linha RESULTADO_EJERCICIO (por flag, não por ordem).
      if (ln.esResultado) {
        resultadoUsdAddr = usdCell.address;
        resultadoArsAddr = arsCell.address;
      }
    } else {
      usdCells.push(usdCell.address);
      arsCells.push(arsCell.address);
    }
  }

  // Conferência ▲ = RESULTADO do DRE − RESULTADO do PL (0 por construção).
  ws.addRow([]);
  const cuadra = num(dre.checkArs) === 0 && num(dre.checkUsd) === 0;
  const chk = ws.addRow([
    cuadra ? "✓ CONFERE (DRE = Resultado del PL)" : "▲ DIFERENÇA DRE vs PL",
    "",
    num(dre.checkUsd),
    num(dre.checkArs),
  ]);
  chk.font = { bold: true, color: { argb: cuadra ? "FF177245" : "FFB00020" } };
  setMoney(chk);
  if (plResultadoRow && resultadoUsdAddr && resultadoArsAddr) {
    const plUsd = plResultadoRow.getCell(COL_USD).address;
    const plArs = plResultadoRow.getCell(COL_ARS).address;
    chk.getCell(COL_USD).value = {
      formula: `${resultadoUsdAddr}-${plUsd}`,
      result: num(dre.checkUsd),
    };
    chk.getCell(COL_ARS).value = {
      formula: `${resultadoArsAddr}-${plArs}`,
      result: num(dre.checkArs),
    };
  }

  // Detalhe dos impostos de resultado (taxonomia AR) — informativo.
  if (dre.impuestos.length > 0) {
    ws.addRow([]);
    const ih = ws.addRow(["", "Impuestos del ejercicio (detalle AR)", "", ""]);
    ih.font = { bold: true, italic: true, color: { argb: "FF666666" } };
    for (const imp of dre.impuestos) {
      const r = ws.addRow(["", `  ${imp.grupo}`, num(imp.usd), num(imp.ars)]);
      r.font = { color: { argb: "FF666666" } };
      setMoney(r);
    }
    const tot = ws.addRow([
      "",
      "  Total impuestos del ejercicio",
      num(dre.totalImpuestosUsd),
      num(dre.totalImpuestosArs),
    ]);
    tot.font = { italic: true, bold: true, color: { argb: "FF666666" } };
    setMoney(tot);
  }
}

// Detalhe por embarque (informativo) sob o bloco — NÃO soma ao subtotal.
function renderDetalle(ws: ExcelJS.Worksheet, bloque: BloqueModelo): void {
  const detalle = bloque.detalle;
  if (!detalle || detalle.length === 0) return;

  const dh = ws.addRow(["  Detalle por embarque (informativo)"]);
  dh.font = { italic: true, color: { argb: "FF666666" } };
  for (const d of detalle) {
    const r = ws.addRow([`    ${d.embarqueCodigo}`, d.descripcion, num(d.usd), num(d.ars)]);
    r.font = { color: { argb: "FF666666" } };
    setMoney(r);
  }
}

function setMoney(row: ExcelJS.Row): void {
  row.getCell(COL_USD).numFmt = FMT_MONEY;
  row.getCell(COL_ARS).numFmt = FMT_MONEY;
}
