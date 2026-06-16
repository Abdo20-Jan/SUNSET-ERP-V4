import { describe, expect, it } from "vitest";
import { Decimal } from "@/lib/decimal";
import {
  costoPromedioEnFecha,
  type ItemBackfillCmv,
  type MovimientoFechado,
  reconciliarVenta,
} from "@/lib/services/backfill-cmv";

// Onda E #4 — backfill de ItemVenta.costoUnitarioCmv para las ventas legacy
// (snapshot 0) con puente 1.1.5.03 abierto. El valor fiel al runtime es el
// Producto.costoPromedio AL MOMENTO DE LA EMISIÓN; se reproduce replayando los
// MovimientoStock NACIONAL hasta la fecha de emisión (reusa replayStockNacional
// del #14). El total por venta se AUTO-VERIFICA contra g.haber (la provisión
// que la emisión acreditó a 1.1.5.03): si no coincide, hay drift y se marca.

const NAC = "NACIONAL" as const;
const ZP = "ZONA_PRIMARIA" as const;

function mov(
  fecha: string,
  tipo: MovimientoFechado["tipo"],
  cantidad: number,
  costoUnitario: string,
  depositoTipo: MovimientoFechado["depositoTipo"] = NAC,
): MovimientoFechado {
  return { fecha: new Date(fecha), tipo, cantidad, costoUnitario, depositoTipo };
}

describe("costoPromedioEnFecha — replay del costoPromedio vendible al momento de la emisión", () => {
  const historial: MovimientoFechado[] = [
    mov("2026-01-01", "INGRESO", 10, "1000.00"),
    mov("2026-03-01", "INGRESO", 10, "2000.00"),
  ];

  it("corte intermedio: sólo cuenta el primer ingreso", () => {
    const p = costoPromedioEnFecha(historial, new Date("2026-02-01"));
    expect(p.toNumber()).toBeCloseTo(1000, 6);
  });

  it("corte posterior: promedia ambos ingresos", () => {
    const p = costoPromedioEnFecha(historial, new Date("2026-03-15"));
    expect(p.toNumber()).toBeCloseTo(1500, 6);
  });

  it("corte previo a todo movimiento: promedio 0", () => {
    const p = costoPromedioEnFecha(historial, new Date("2025-12-01"));
    expect(p.eq(new Decimal(0))).toBe(true);
  });

  it("el corte es inclusivo (fecha == corte cuenta el movimiento de ese día)", () => {
    const p = costoPromedioEnFecha(historial, new Date("2026-03-01"));
    expect(p.toNumber()).toBeCloseTo(1500, 6);
  });

  it("ignora las patas en ZONA_PRIMARIA (sólo el agregado NACIONAL es vendible)", () => {
    const conBonded: MovimientoFechado[] = [
      mov("2026-01-01", "INGRESO", 100, "999.00", ZP),
      mov("2026-01-02", "INGRESO", 10, "1000.00", NAC),
    ];
    const p = costoPromedioEnFecha(conBonded, new Date("2026-02-01"));
    expect(p.toNumber()).toBeCloseTo(1000, 6);
  });
});

describe("reconciliarVenta — auto-verificación del backfill contra la provisión de emisión", () => {
  const items: ItemBackfillCmv[] = [
    {
      itemVentaId: 1,
      cantidad: 10,
      costoUnitarioActual: "1500.00",
      costoUnitarioEmision: "1000.00",
    },
    {
      itemVentaId: 2,
      cantidad: 5,
      costoUnitarioActual: "2200.00",
      costoUnitarioEmision: "2000.00",
    },
  ];
  // Σ cantidad × emisión = 10·1000 + 5·2000 = 20.000
  // Σ cantidad × actual  = 10·1500 + 5·2200 = 26.000

  it("totalEmision y totalActual se computan por separado", () => {
    const r = reconciliarVenta(items, "20000.00");
    expect(r.totalEmision.toNumber()).toBeCloseTo(20000, 2);
    expect(r.totalActual.toNumber()).toBeCloseTo(26000, 2);
  });

  it("coincide con la provisión esperada (g.haber) ⇒ ok, delta 0", () => {
    const r = reconciliarVenta(items, "20000.00");
    expect(r.delta.toNumber()).toBeCloseTo(0, 2);
    expect(r.ok).toBe(true);
  });

  it("tolera diferencias de redondeo de hasta 1 centavo por defecto", () => {
    const r = reconciliarVenta(items, "20000.01");
    expect(r.ok).toBe(true);
  });

  it("drift mayor a la tolerancia ⇒ ok falso y delta expuesto", () => {
    const r = reconciliarVenta(items, "19900.00");
    expect(r.ok).toBe(false);
    expect(r.delta.toNumber()).toBeCloseTo(100, 2);
  });
});
