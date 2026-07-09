import { describe, expect, it } from "vitest";

import type { PedidoCompraRow } from "@/lib/actions/pedidos-compra";
import {
  filtrarPorVista,
  flattenPedidos,
  resolverVista,
} from "@/app/(dashboard)/compras/pedidos/_components/pedidos-compra-presentacion";

// Helpers PUROS de la worklist de OC (COMP-01 · PR-029): sub-vistas oficiales
// como presets de URL server-side (lección PR-010) y aplanado 1:1 de lo que
// `listarPedidosCompra` ya devuelve + conteo de compras vinculadas. Sin
// re-derivación: la paridad grid↔export depende de estos mismos helpers.

function pedido(id: number, estado: PedidoCompraRow["estado"]): PedidoCompraRow {
  return {
    id,
    numero: `OC-2026-${String(id).padStart(4, "0")}`,
    fecha: "2026-07-01T00:00:00.000Z",
    fechaPrevista: null,
    proveedor: { id: `prov-${id}`, nombre: `Proveedor ${id}` },
    moneda: "USD",
    total: "100.00",
    estado,
    itemsCount: 1,
  };
}

describe("resolverVista", () => {
  it("acepta las vistas válidas y cae a 'todas' ante cualquier otra cosa", () => {
    expect(resolverVista("abiertas")).toBe("abiertas");
    expect(resolverVista("completadas")).toBe("completadas");
    expect(resolverVista("canceladas")).toBe("canceladas");
    expect(resolverVista(undefined)).toBe("todas");
    expect(resolverVista("x")).toBe("todas");
  });
});

describe("filtrarPorVista", () => {
  const rows = flattenPedidos(
    [
      pedido(1, "BORRADOR"),
      pedido(2, "ENVIADO"),
      pedido(3, "CONFIRMADO"),
      pedido(4, "PARCIAL"),
      pedido(5, "COMPLETADO"),
      pedido(6, "CANCELADO"),
    ],
    new Map(),
  );

  it("'abiertas' = BORRADOR+ENVIADO+CONFIRMADO+PARCIAL", () => {
    expect(filtrarPorVista(rows, "abiertas").map((r) => r.id)).toEqual([1, 2, 3, 4]);
  });

  it("'completadas' y 'canceladas' filtran su estado; 'todas' no filtra", () => {
    expect(filtrarPorVista(rows, "completadas").map((r) => r.id)).toEqual([5]);
    expect(filtrarPorVista(rows, "canceladas").map((r) => r.id)).toEqual([6]);
    expect(filtrarPorVista(rows, "todas")).toHaveLength(6);
  });
});

describe("flattenPedidos", () => {
  it("aplana proveedor e inyecta comprasCount (0 sin vínculos)", () => {
    const [conCompras, sinCompras] = flattenPedidos(
      [pedido(1, "CONFIRMADO"), pedido(2, "BORRADOR")],
      new Map([[1, 3]]),
    );
    expect(conCompras).toMatchObject({
      proveedorId: "prov-1",
      proveedorNombre: "Proveedor 1",
      comprasCount: 3,
    });
    expect(sinCompras.comprasCount).toBe(0);
  });
});
