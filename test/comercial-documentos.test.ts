import { describe, expect, it } from "vitest";

import type { PedidoVentaRow } from "@/lib/actions/pedidos-venta";
import type { VentaRow } from "@/lib/actions/ventas";
import {
  type ComercialDocRow,
  esBorrador,
  esCancelado,
  esPendiente,
  mergeComercialDocumentos,
  pedidoToDoc,
  ventaToDoc,
} from "@/lib/comercial/documentos";

function venta(over: Partial<VentaRow> = {}): VentaRow {
  return {
    id: "v1",
    numero: "V-0001",
    fecha: "2026-06-01T00:00:00.000Z",
    fechaVencimiento: "2026-07-01T00:00:00.000Z",
    cliente: { id: "c1", nombre: "ACME" },
    moneda: "USD",
    subtotal: "100",
    iva: "21",
    total: "121",
    estado: "EMITIDA",
    asientoId: "a1",
    ...over,
  };
}

function pedido(over: Partial<PedidoVentaRow> = {}): PedidoVentaRow {
  return {
    id: 5,
    numero: "OV-0005",
    fecha: "2026-06-02T00:00:00.000Z",
    fechaPrevista: "2026-06-20T00:00:00.000Z",
    cliente: { id: "c2", nombre: "Beta SRL" },
    moneda: "ARS",
    total: "5000",
    estado: "CONFIRMADO",
    itemsCount: 3,
    ...over,
  };
}

describe("ventaToDoc", () => {
  it("mapea una venta emitida → fila VENTA con record href y vencimiento visible", () => {
    expect(ventaToDoc(venta())).toEqual<ComercialDocRow>({
      key: "venta-v1",
      tipo: "VENTA",
      id: "v1",
      numero: "V-0001",
      recordHref: "/ventas/v1",
      fecha: "2026-06-01T00:00:00.000Z",
      fechaRef: "2026-07-01T00:00:00.000Z",
      cliente: { id: "c1", nombre: "ACME" },
      clienteNombre: "ACME",
      moneda: "USD",
      total: "121",
      estado: "EMITIDA",
      itemsCount: null,
    });
  });

  it("oculta el vencimiento (fechaRef=null) cuando la venta NO está emitida", () => {
    const doc = ventaToDoc(venta({ estado: "BORRADOR" }));
    expect(doc.fechaRef).toBeNull();
    expect(doc.estado).toBe("BORRADOR");
  });
});

describe("pedidoToDoc", () => {
  it("mapea un pedido → fila PEDIDO con id string, href de pedido y prevista como fechaRef", () => {
    expect(pedidoToDoc(pedido())).toEqual<ComercialDocRow>({
      key: "pedido-5",
      tipo: "PEDIDO",
      id: "5",
      numero: "OV-0005",
      recordHref: "/ventas/pedidos/5",
      fecha: "2026-06-02T00:00:00.000Z",
      fechaRef: "2026-06-20T00:00:00.000Z",
      cliente: { id: "c2", nombre: "Beta SRL" },
      clienteNombre: "Beta SRL",
      moneda: "ARS",
      total: "5000",
      estado: "CONFIRMADO",
      itemsCount: 3,
    });
  });
});

describe("mergeComercialDocumentos", () => {
  it("une ventas + pedidos y ordena por fecha descendente (más reciente primero)", () => {
    const merged = mergeComercialDocumentos(
      [venta({ id: "vA", fecha: "2026-06-01T00:00:00.000Z" })],
      [pedido({ id: 9, fecha: "2026-06-10T00:00:00.000Z" })],
    );
    expect(merged.map((d) => d.key)).toEqual(["pedido-9", "venta-vA"]);
  });

  it("conserva ambos tipos y no pierde filas", () => {
    const merged = mergeComercialDocumentos(
      [venta(), venta({ id: "v2", numero: "V-0002" })],
      [pedido()],
    );
    expect(merged).toHaveLength(3);
    expect(merged.filter((d) => d.tipo === "VENTA")).toHaveLength(2);
    expect(merged.filter((d) => d.tipo === "PEDIDO")).toHaveLength(1);
  });

  it("listas vacías → []", () => {
    expect(mergeComercialDocumentos([], [])).toEqual([]);
  });
});

describe("predicados de vistas salvas", () => {
  const borrador = ventaToDoc(venta({ estado: "BORRADOR" }));
  const emitida = ventaToDoc(venta({ estado: "EMITIDA" }));
  const canceladaVenta = ventaToDoc(venta({ estado: "CANCELADA" }));
  const canceladoPedido = pedidoToDoc(pedido({ estado: "CANCELADO" }));
  const confirmado = pedidoToDoc(pedido({ estado: "CONFIRMADO" }));

  it("esBorrador sólo para BORRADOR", () => {
    expect(esBorrador(borrador)).toBe(true);
    expect(esBorrador(emitida)).toBe(false);
  });

  it("esCancelado cubre CANCELADA (venta) y CANCELADO (pedido)", () => {
    expect(esCancelado(canceladaVenta)).toBe(true);
    expect(esCancelado(canceladoPedido)).toBe(true);
    expect(esCancelado(confirmado)).toBe(false);
  });

  it("esPendiente = vivo no finalizado (excluye emitida/completado/cancelado)", () => {
    expect(esPendiente(borrador)).toBe(true);
    expect(esPendiente(confirmado)).toBe(true);
    expect(esPendiente(emitida)).toBe(false);
    expect(esPendiente(canceladaVenta)).toBe(false);
  });
});
