import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { generarBalanceBPExcel } from "@/lib/services/reportes/export/balance-bp-excel";
import type { BalanceBPModelo } from "@/lib/services/reportes/export/balance-bp-modelo";

const modelo: BalanceBPModelo = {
  fecha: "2025-12-31",
  tc: "1390.11",
  ativo: [
    {
      key: "DISPONIBILIDADE",
      titulo: "DISPONIBILIDADE",
      lineas: [
        { codigo: "1.1.1.01.01", descripcion: "CAJA GENERAL", usd: "100.00", ars: "139011.00" },
      ],
      subtotalUsd: "100.00",
      subtotalArs: "139011.00",
    },
  ],
  pasivo: [
    {
      key: "PROVEDORES_EXTERIOR",
      titulo: "PROVEDORES DO EXTERIOR",
      lineas: [{ codigo: "2.1.1.02.01", descripcion: "PROVEEDOR", usd: "60.00", ars: "83406.60" }],
      subtotalUsd: "60.00",
      subtotalArs: "83406.60",
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
      lineas: [{ codigo: "3.1.01", descripcion: "CAPITAL SOCIAL", usd: "40.00", ars: "55604.40" }],
      subtotalUsd: "40.00",
      subtotalArs: "55604.40",
    },
  ],
  totalAtivoUsd: "100.00",
  totalAtivoArs: "139011.00",
  totalPasivoUsd: "60.00",
  totalPasivoArs: "83406.60",
  totalPlUsd: "40.00",
  totalPlArs: "55604.40",
  checkUsd: "0.00",
  checkArs: "0.00",
  cuadra: true,
};

describe("generarBalanceBPExcel", () => {
  it("gera um .xlsx válido e relegível com blocos, totais e conferência", async () => {
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
    ws?.eachRow((row) => {
      row.eachCell((cell) => {
        if (typeof cell.value === "string") textos.push(cell.value);
      });
    });
    const blob = textos.join(" | ");

    expect(blob).toContain("DISPONIBILIDADE");
    expect(blob).toContain("PROVEDORES DO EXTERIOR");
    expect(blob).toContain("PATRIMONIO LÍQUIDO");
    expect(blob).toContain("TOTAL ATIVO");
    expect(blob).toContain("CONFERE");
    // Detalhe por embarque (PR2): sub-seção + código do embarque renderizados.
    expect(blob).toContain("Detalle por embarque (informativo)");
    expect(blob).toContain("BR-250827-015CN");
  });
});
