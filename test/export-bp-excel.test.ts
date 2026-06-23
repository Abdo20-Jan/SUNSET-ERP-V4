import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { generarBalanceBPExcel } from "@/lib/services/reportes/export/balance-bp-excel";
import type { BalanceBPModelo } from "@/lib/services/reportes/export/balance-bp-modelo";

const modelo: BalanceBPModelo = {
  fecha: "2025-12-31",
  fechaInicial: "2025-01-01",
  fechaFinal: "2025-12-31",
  tc: "1390.11",
  ativo: [
    {
      key: "DISPONIBILIDADE",
      titulo: "DISPONIBILIDADE",
      lineas: [
        {
          codigo: "1.1.1.01.01",
          descripcion: "CAJA GENERAL",
          usd: "100.00",
          ars: "139011.00",
          usdInicial: "60.00",
          arsInicial: "83406.60",
        },
      ],
      subtotalUsd: "100.00",
      subtotalArs: "139011.00",
      subtotalUsdInicial: "60.00",
      subtotalArsInicial: "83406.60",
    },
  ],
  pasivo: [
    {
      key: "PROVEDORES_EXTERIOR",
      titulo: "PROVEDORES DO EXTERIOR",
      lineas: [
        {
          codigo: "2.1.1.02.01",
          descripcion: "PROVEEDOR",
          usd: "60.00",
          ars: "83406.60",
          usdInicial: "0.00",
          arsInicial: "0.00",
        },
      ],
      subtotalUsd: "60.00",
      subtotalArs: "83406.60",
      subtotalUsdInicial: "0.00",
      subtotalArsInicial: "0.00",
      detalle: [
        {
          embarqueCodigo: "BR-250827-015CN",
          descripcion: "QINGDAO TIRES CO",
          usd: "60.00",
          ars: "83406.60",
        },
      ],
    },
  ],
  pl: [
    {
      key: "PATRIMONIO_LIQUIDO",
      titulo: "PATRIMONIO LÍQUIDO",
      lineas: [
        {
          codigo: "3.1.01",
          descripcion: "CAPITAL SOCIAL",
          usd: "0.00",
          ars: "0.00",
          usdInicial: "0.00",
          arsInicial: "0.00",
        },
        {
          codigo: "3.4",
          descripcion: "RESULTADO DEL EJERCICIO",
          usd: "40.00",
          ars: "55604.40",
          usdInicial: "0.00",
          arsInicial: "0.00",
        },
      ],
      subtotalUsd: "40.00",
      subtotalArs: "55604.40",
      subtotalUsdInicial: "0.00",
      subtotalArsInicial: "0.00",
    },
  ],
  totalAtivoUsd: "100.00",
  totalAtivoArs: "139011.00",
  totalAtivoUsdInicial: "60.00",
  totalAtivoArsInicial: "83406.60",
  totalPasivoUsd: "60.00",
  totalPasivoArs: "83406.60",
  totalPasivoUsdInicial: "0.00",
  totalPasivoArsInicial: "0.00",
  totalPlUsd: "40.00",
  totalPlArs: "55604.40",
  totalPlUsdInicial: "0.00",
  totalPlArsInicial: "0.00",
  checkUsd: "0.00",
  checkArs: "0.00",
  cuadra: true,
  dre: {
    lineas: [
      {
        label: "Ingresos por ventas",
        tipo: "ingreso",
        enfasis: false,
        esResultado: false,
        usd: "100.00",
        ars: "139011.00",
      },
      {
        label: "Ingresos netos",
        tipo: "subtotal",
        enfasis: false,
        esResultado: false,
        usd: "100.00",
        ars: "139011.00",
      },
      {
        label: "Costo de ventas",
        tipo: "egreso",
        enfasis: false,
        esResultado: false,
        usd: "-60.00",
        ars: "-83406.60",
      },
      {
        label: "Resultado del ejercicio",
        tipo: "subtotal",
        enfasis: true,
        esResultado: true,
        usd: "40.00",
        ars: "55604.40",
      },
    ],
    impuestos: [{ grupo: "Impuestos sobre ventas (IIBB, tasas)", usd: "5.00", ars: "6950.55" }],
    totalImpuestosUsd: "5.00",
    totalImpuestosArs: "6950.55",
    resultadoUsd: "40.00",
    resultadoArs: "55604.40",
    checkUsd: "0.00",
    checkArs: "0.00",
  },
};

describe("generarBalanceBPExcel", () => {
  it("gera um .xlsx no formato do modelo Nasser A:O (data inicial · 6 movimentos · data final)", async () => {
    const bytes = await generarBalanceBPExcel(modelo);
    expect(bytes.length).toBeGreaterThan(0);

    const dir = mkdtempSync(join(tmpdir(), "bp-xlsx-"));
    const file = join(dir, "bp.xlsx");
    writeFileSync(file, bytes);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    const ws = wb.getWorksheet("BP SUNSET SAS DÓLAR");
    expect(ws).toBeDefined();

    const textos: string[] = [];
    const formulas: string[] = [];
    const numFmts: string[] = [];
    const fills: string[] = [];
    const fonts: string[] = [];
    ws?.eachRow((row) => {
      row.eachCell((cell) => {
        if (typeof cell.value === "string") textos.push(cell.value);
        if (cell.formula) formulas.push(cell.formula);
        if (cell.numFmt) numFmts.push(cell.numFmt);
        const fill = cell.fill as { fgColor?: { argb?: string } } | undefined;
        if (fill?.fgColor?.argb) fills.push(fill.fgColor.argb);
        if (cell.font?.name) fonts.push(cell.font.name);
      });
    });
    const blob = textos.join(" | ");

    expect(blob).toContain("DISPONIBILIDADE");
    expect(blob).toContain("PROVEDORES DO EXTERIOR");
    expect(blob).toContain("PATRIMONIO LÍQUIDO");
    expect(blob).toContain("TOTAL ATIVO");
    expect(blob).toContain("SALDO CREDOR");
    expect(blob).toContain("CONFERE");
    // Detalhe por embarque (PR2): sub-seção + código do embarque renderizados.
    expect(blob).toContain("Detalle por embarque (informativo)");
    expect(blob).toContain("BR-250827-015CN");
    // Bloco DRE (PR3): cascata + impostos AR + fórmulas vivas.
    expect(blob).toContain("CONFERINDO O DRE");
    expect(blob).toContain("Ingresos por ventas");
    expect(blob).toContain("Impuestos del ejercicio (detalle AR)");
    expect(blob).toContain("CONFERE (DRE = Resultado del PL)");

    // ----- Estrutura do modelo real: A:O -----
    expect(ws?.actualColumnCount).toBeLessThanOrEqual(15);
    expect(ws?.getCell("F1").value).toBe(1390.11); // TC espelhada do modelo
    expect(ws?.getCell("M1").value).toBe(1390.11); // TC âncora usada em fórmulas
    expect(ws?.getCell("O1").value).toBe("SALDO");
    expect(blob).toContain("BP DÓLARES");
    expect(blob).toContain("SALDO");

    // DATA FINAL = SUM(G:M) — soma abertura + 6 colunas de movimento.
    expect(formulas.some((f) => /SUM\(G\d+:M\d+\)/.test(f))).toBe(true);
    expect(formulas.some((f) => /SUM\(I\d+:O\d+\)/.test(f))).toBe(false);
    // ARS = USD final × TC do modelo, ancorada em $M$1.
    expect(formulas.some((f) => f.includes("*$M$1"))).toBe(true);
    expect(formulas.some((f) => f.includes("*$O$1"))).toBe(false);

    // Datas (inicial/final) com formato d-mmm.
    expect(numFmts.some((f) => f === "d-mmm")).toBe(true);
    // Subtotais/totais por SUM + conferência por subtração.
    expect(formulas.some((f) => f.startsWith("SUM("))).toBe(true);
    expect(formulas.some((f) => f.includes("-"))).toBe(true);

    // ----- Fidelidade visual (paleta do modelo) -----
    expect(fills.some((c) => c.toUpperCase().endsWith("CCFFFF"))).toBe(true); // ciano
    expect(numFmts.some((f) => f.includes("[$ARS]"))).toBe(true);
    expect(numFmts.some((f) => f.includes("[$$-409]"))).toBe(true);
    expect(fonts.some((f) => f === "Arial")).toBe(true);
  });
});
