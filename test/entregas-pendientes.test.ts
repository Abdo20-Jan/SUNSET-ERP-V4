import { describe, expect, it } from "vitest";
import { resumenPendienteVenta } from "@/lib/services/entregas-pendientes";

// Helper puro: dado los items de una venta con cantidad vendida y entregada,
// resume cuántas unidades quedan pendientes de entrega. Base del hub de
// entregas (lista de ventas con despacho pendiente) y del badge por venta.

describe("resumenPendienteVenta", () => {
  it("venta sin nada entregado → todo pendiente", () => {
    const r = resumenPendienteVenta([
      { vendido: 5, entregado: 0 },
      { vendido: 3, entregado: 0 },
    ]);
    expect(r.unidadesVendidas).toBe(8);
    expect(r.unidadesEntregadas).toBe(0);
    expect(r.unidadesPendientes).toBe(8);
    expect(r.tienePendiente).toBe(true);
  });

  it("venta totalmente entregada → sin pendiente", () => {
    const r = resumenPendienteVenta([
      { vendido: 5, entregado: 5 },
      { vendido: 3, entregado: 3 },
    ]);
    expect(r.unidadesPendientes).toBe(0);
    expect(r.tienePendiente).toBe(false);
  });

  it("entrega parcial → pendiente = vendido - entregado", () => {
    const r = resumenPendienteVenta([{ vendido: 10, entregado: 4 }]);
    expect(r.unidadesEntregadas).toBe(4);
    expect(r.unidadesPendientes).toBe(6);
    expect(r.tienePendiente).toBe(true);
  });

  it("clamp por item: un item completo no compensa a otro pendiente", () => {
    // item A entregado de más (no debería pasar por el tope, pero el resumen
    // no debe restar ese exceso del pendiente del item B).
    const r = resumenPendienteVenta([
      { vendido: 2, entregado: 5 }, // exceso de 3
      { vendido: 4, entregado: 0 }, // pendiente real 4
    ]);
    expect(r.unidadesPendientes).toBe(4);
    expect(r.tienePendiente).toBe(true);
  });

  it("venta sin items → todo en cero, sin pendiente", () => {
    const r = resumenPendienteVenta([]);
    expect(r.unidadesVendidas).toBe(0);
    expect(r.unidadesEntregadas).toBe(0);
    expect(r.unidadesPendientes).toBe(0);
    expect(r.tienePendiente).toBe(false);
  });
});
