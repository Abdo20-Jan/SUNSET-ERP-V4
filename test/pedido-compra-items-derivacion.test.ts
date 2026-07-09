import { describe, expect, it } from "vitest";

import {
  derivarLineasPedidoCompra,
  resumirFacturacion,
} from "@/app/(dashboard)/compras/pedidos/[id]/_components/pedido-compra-items-view";

// Derivación de líneas de la aba Items del record de la OC (PR-029, espejo de
// derivarLineasPedido del PR-019): "facturada" = Σ ItemCompra por producto de
// compras vinculadas EMITIDA/RECIBIDA, cap-eada por línea a lo pedido (la
// conversión OC→Compra no es idempotente). Sin margen (la OC no lo modela).

const PRODUCTOS = {
  "p-1": { codigo: "1001", nombre: "Neumático A" },
  "p-2": { codigo: "1002", nombre: "Neumático B" },
};

function item(id: number, productoId: string, cantidad: number, precioUnitario = "100.00") {
  return { id, productoId, cantidad, precioUnitario };
}

describe("derivarLineasPedidoCompra", () => {
  it("deriva facturada/pendiente con cap por línea y estado de línea", () => {
    const lineas = derivarLineasPedidoCompra({
      items: [item(1, "p-1", 10), item(2, "p-2", 4)],
      productosMap: PRODUCTOS,
      facturadasMap: new Map([
        ["p-1", 25], // bruta > pedida (doble conversión) → cap a 10
        ["p-2", 1],
      ]),
      pedidoCancelado: false,
    });
    expect(lineas[0]).toMatchObject({
      codigo: "1001",
      pedida: 10,
      facturada: 10,
      pendiente: 0,
      estadoLinea: "Facturada",
    });
    expect(lineas[1]).toMatchObject({
      pedida: 4,
      facturada: 1,
      pendiente: 3,
      estadoLinea: "Parcial",
    });
  });

  it("sin facturación → Pendiente; pedido cancelado fuerza Cancelada", () => {
    const [pendiente] = derivarLineasPedidoCompra({
      items: [item(1, "p-1", 5)],
      productosMap: PRODUCTOS,
      facturadasMap: new Map(),
      pedidoCancelado: false,
    });
    expect(pendiente.estadoLinea).toBe("Pendiente");

    const [cancelada] = derivarLineasPedidoCompra({
      items: [item(1, "p-1", 5)],
      productosMap: PRODUCTOS,
      facturadasMap: new Map([["p-1", 5]]),
      pedidoCancelado: true,
    });
    expect(cancelada.estadoLinea).toBe("Cancelada");
  });

  it("calcula el total neto por línea (precio × pedida, 2 decimales)", () => {
    const [linea] = derivarLineasPedidoCompra({
      items: [item(1, "p-1", 3, "10.50")],
      productosMap: PRODUCTOS,
      facturadasMap: new Map(),
      pedidoCancelado: false,
    });
    expect(linea.totalNeto).toBe("31.50");
  });
});

describe("resumirFacturacion", () => {
  it("suma totales, pendiente y % facturado sobre las líneas derivadas", () => {
    const lineas = derivarLineasPedidoCompra({
      items: [item(1, "p-1", 10), item(2, "p-2", 10)],
      productosMap: PRODUCTOS,
      facturadasMap: new Map([["p-1", 5]]),
      pedidoCancelado: false,
    });
    const compras = [{ id: "c-1", numero: "C-2026-0001", estado: "EMITIDA" }];
    const resumen = resumirFacturacion(lineas, compras);
    expect(resumen).toMatchObject({
      pedidaTotal: 20,
      facturadaTotal: 5,
      pendienteTotal: 15,
      pct: 25,
      compras,
    });
  });

  it("OC sin unidades → pct 0 (sin división por cero)", () => {
    expect(resumirFacturacion([], [])).toMatchObject({ pedidaTotal: 0, pct: 0 });
  });
});
