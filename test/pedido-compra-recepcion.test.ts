import { describe, expect, it } from "vitest";

import { DespachoEstado, EmbarqueEstado } from "@/generated/prisma/client";
import {
  derivarEmbarcado,
  derivarNacionalizado,
  derivarRecepcionPorProducto,
  type RecepcionInsumos,
} from "@/lib/services/pedido-compra-recepcion";

// Recepción derivada de la OC (PR-029 · COMP-02 · OD-11): dos trilhas SEPARADAS
// — comercial (Facturado: ItemCompra EMITIDA/RECIBIDA) × física (Ingresado a
// stock: MovimientoStock / ItemDespacho CONTABILIZADO) — que nunca se suman.
// No existe modelo Recepcion ni writer de RECIBIDA; todo deriva de documentos
// vinculados, agrupado por productoId (no hay FK ítem-a-ítem).

const P1 = "producto-1";
const P2 = "producto-2";
const P3 = "producto-3";

function insumosBase(): RecepcionInsumos {
  return {
    itemsPedido: [],
    facturado: [],
    ingresadoNacional: [],
    embarcado: [],
    nacionalizado: [],
  };
}

describe("derivarRecepcionPorProducto", () => {
  it("agrupa por producto y calcula pendiente de facturar", () => {
    const lineas = derivarRecepcionPorProducto({
      ...insumosBase(),
      itemsPedido: [
        { productoId: P1, cantidad: 10 },
        { productoId: P2, cantidad: 4 },
      ],
      facturado: [{ productoId: P1, cantidad: 6 }],
    });
    const l1 = lineas.find((l) => l.productoId === P1);
    const l2 = lineas.find((l) => l.productoId === P2);
    expect(l1).toMatchObject({ pedida: 10, facturada: 6, pendienteFacturar: 4 });
    expect(l2).toMatchObject({ pedida: 4, facturada: 0, pendienteFacturar: 4 });
  });

  it("colapsa líneas duplicadas del mismo producto en la OC (junción por producto)", () => {
    const lineas = derivarRecepcionPorProducto({
      ...insumosBase(),
      itemsPedido: [
        { productoId: P1, cantidad: 3 },
        { productoId: P1, cantidad: 7 },
      ],
    });
    expect(lineas).toHaveLength(1);
    expect(lineas[0]).toMatchObject({ productoId: P1, pedida: 10 });
  });

  it("cap-ea facturada a lo pedido pero conserva la bruta (conversión no idempotente)", () => {
    const [linea] = derivarRecepcionPorProducto({
      ...insumosBase(),
      itemsPedido: [{ productoId: P1, cantidad: 5 }],
      facturado: [
        { productoId: P1, cantidad: 5 },
        { productoId: P1, cantidad: 5 },
      ],
    });
    expect(linea).toMatchObject({ facturada: 5, facturadaBruta: 10, pendienteFacturar: 0 });
  });

  it("producto fuera de pedido: pedida=0, sin cap, ordenado al final", () => {
    const lineas = derivarRecepcionPorProducto({
      ...insumosBase(),
      itemsPedido: [{ productoId: P1, cantidad: 2 }],
      facturado: [{ productoId: P3, cantidad: 9 }],
    });
    expect(lineas.map((l) => l.productoId)).toEqual([P1, P3]);
    expect(lineas[1]).toMatchObject({ pedida: 0, facturada: 9, facturadaBruta: 9 });
  });

  it("trilhas comercial y física quedan separadas (nunca se suman)", () => {
    const [linea] = derivarRecepcionPorProducto({
      ...insumosBase(),
      itemsPedido: [{ productoId: P1, cantidad: 10 }],
      facturado: [{ productoId: P1, cantidad: 10 }],
      ingresadoNacional: [{ productoId: P1, cantidad: 4 }],
      nacionalizado: [{ productoId: P1, cantidad: 6 }],
    });
    expect(linea.facturada).toBe(10);
    expect(linea.ingresadaStock).toBe(4);
    expect(linea.nacionalizada).toBe(6);
    // pendienteFacturar sólo mira la trilha comercial.
    expect(linea.pendienteFacturar).toBe(0);
  });
});

type EmbarqueFixture = Parameters<typeof derivarNacionalizado>[0][number];

function embarque(overrides: Partial<EmbarqueFixture>): EmbarqueFixture {
  return {
    estado: EmbarqueEstado.EN_TRANSITO,
    asientoId: null,
    items: [{ id: 1, productoId: P1, cantidad: 10 }],
    despachos: [],
    ...overrides,
  };
}

describe("derivarEmbarcado", () => {
  it("excluye embarques BORRADOR e incluye los demás estados", () => {
    const filas = derivarEmbarcado([
      embarque({ estado: EmbarqueEstado.BORRADOR }),
      embarque({ estado: EmbarqueEstado.EN_TRANSITO }),
    ]);
    expect(filas).toEqual([{ productoId: P1, cantidad: 10 }]);
  });
});

describe("derivarNacionalizado", () => {
  it("sólo despachos CONTABILIZADO prueban nacionalización", () => {
    const filas = derivarNacionalizado([
      embarque({
        despachos: [
          { estado: DespachoEstado.CONTABILIZADO, items: [{ itemEmbarqueId: 1, cantidad: 4 }] },
          { estado: DespachoEstado.BORRADOR, items: [{ itemEmbarqueId: 1, cantidad: 3 }] },
          { estado: DespachoEstado.ANULADO, items: [{ itemEmbarqueId: 1, cantidad: 2 }] },
        ],
      }),
    ]);
    expect(filas).toEqual([{ productoId: P1, cantidad: 4 }]);
  });

  it("fallback legacy: embarque cerrado monolítico (asiento, sin despachos) nacionalizó todo", () => {
    const filas = derivarNacionalizado([
      embarque({ estado: EmbarqueEstado.CERRADO, asientoId: "asiento-1" }),
    ]);
    expect(filas).toEqual([{ productoId: P1, cantidad: 10 }]);
  });

  it("anti-doble-conteo: con despachos CONTABILIZADO no aplica el fallback del cierre", () => {
    const filas = derivarNacionalizado([
      embarque({
        estado: EmbarqueEstado.CERRADO,
        asientoId: "asiento-1",
        despachos: [
          { estado: DespachoEstado.CONTABILIZADO, items: [{ itemEmbarqueId: 1, cantidad: 6 }] },
        ],
      }),
    ]);
    expect(filas).toEqual([{ productoId: P1, cantidad: 6 }]);
  });

  it("mapea ItemDespacho→producto vía itemEmbarqueId; ids desconocidos se ignoran", () => {
    const filas = derivarNacionalizado([
      embarque({
        items: [
          { id: 1, productoId: P1, cantidad: 5 },
          { id: 2, productoId: P2, cantidad: 5 },
        ],
        despachos: [
          {
            estado: DespachoEstado.CONTABILIZADO,
            items: [
              { itemEmbarqueId: 2, cantidad: 5 },
              { itemEmbarqueId: 99, cantidad: 5 },
            ],
          },
        ],
      }),
    ]);
    expect(filas).toEqual([{ productoId: P2, cantidad: 5 }]);
  });
});
