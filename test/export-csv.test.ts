import { describe, expect, it } from "vitest";

import { toCsv } from "@/lib/export/csv";
import type { ExportColumn } from "@/lib/export/types";

const BOM = "﻿";

type Row = { a: string | number | null; b: string | number | null };

const cols: ExportColumn<Row>[] = [
  { header: "A", value: (r) => r.a },
  { header: "B", value: (r) => r.b },
];

describe("toCsv", () => {
  it("emite la fila de cabecera con los headers", () => {
    const csv = toCsv(cols, [{ a: "x", b: "y" }]);
    const [, head] = csv.split("\r\n");
    expect(csv.startsWith(`${BOM}A,B`)).toBe(true);
    expect(head).toBe("x,y");
  });

  it("envuelve en comillas un valor con coma", () => {
    const csv = toCsv(cols, [{ a: "uno, dos", b: "ok" }]);
    expect(csv).toBe(`${BOM}A,B\r\n"uno, dos",ok`);
  });

  it("duplica la comilla interna y envuelve en comillas", () => {
    const csv = toCsv(cols, [{ a: 'di "hola"', b: "ok" }]);
    expect(csv).toBe(`${BOM}A,B\r\n"di ""hola""",ok`);
  });

  it("envuelve en comillas un valor con salto de línea", () => {
    const csv = toCsv(cols, [{ a: "linea1\nlinea2", b: "ok" }]);
    expect(csv).toBe(`${BOM}A,B\r\n"linea1\nlinea2",ok`);
  });

  it("serializa null como cadena vacía", () => {
    const csv = toCsv(cols, [{ a: null, b: "ok" }]);
    expect(csv).toBe(`${BOM}A,B\r\n,ok`);
  });

  it("antepone el BOM (\\uFEFF) al inicio", () => {
    const csv = toCsv(cols, [{ a: "x", b: "y" }]);
    expect(csv[0]).toBe("﻿");
  });

  it("sin filas → solo cabecera (con BOM, sin salto final)", () => {
    const csv = toCsv(cols, []);
    expect(csv).toBe(`${BOM}A,B`);
  });
});
