import "server-only";

import ExcelJS from "exceljs";

import type { BalanceBPModelo, BloqueModelo } from "./balance-bp-modelo";

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
  renderSeccion(
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

  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf);
}

function renderSeccion(
  ws: ExcelJS.Worksheet,
  titulo: string,
  bloques: BloqueModelo[],
  totalLabel: string,
  totalUsd: string,
  totalArs: string,
): void {
  ws.addRow([]);
  const head = ws.addRow([titulo]);
  head.font = { bold: true, size: 12 };
  head.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF4" } };
  });
  ws.mergeCells(head.number, 1, head.number, 4);

  for (const bloque of bloques) {
    const bh = ws.addRow([bloque.titulo]);
    bh.font = { bold: true };
    for (const ln of bloque.lineas) {
      const r = ws.addRow([ln.codigo, ln.descripcion, num(ln.usd), num(ln.ars)]);
      setMoney(r);
    }
    const st = ws.addRow([
      `  Subtotal ${bloque.titulo}`,
      "",
      num(bloque.subtotalUsd),
      num(bloque.subtotalArs),
    ]);
    st.font = { italic: true };
    setMoney(st);
  }

  const total = ws.addRow([totalLabel, "", num(totalUsd), num(totalArs)]);
  total.font = { bold: true };
  total.eachCell((c) => {
    c.border = { top: { style: "thin" } };
  });
  setMoney(total);
}

function setMoney(row: ExcelJS.Row): void {
  row.getCell(COL_USD).numFmt = FMT_MONEY;
  row.getCell(COL_ARS).numFmt = FMT_MONEY;
}
