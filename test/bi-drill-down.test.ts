import { beforeEach, describe, expect, it, vi } from "vitest";

// F0-FND-7 — resolvedor de drill-down asiento → documento de origen.
// `bi-drill-down.ts` importa `server-only` (stub vía vitest.config) y usa el
// singleton `@/lib/db`; mockeamos sólo `asiento.findMany` para asertar el batch
// (1 sola consulta = sin N+1) sin necesidad de Postgres real.

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { asiento: { findMany } } }));

import {
  type ClavesOrigenAsiento,
  documentoOrigen,
  documentosOrigenPorAsiento,
  resolverDocumentoOrigen,
} from "@/lib/services/bi-drill-down";

beforeEach(() => {
  findMany.mockReset();
});

// ---- Forma cruda de un asiento devuelto por el select del batch ----
type RelId = { id: string | number } | null;
type AsientoRow = {
  id: string;
  venta: RelId;
  compra: RelId;
  embarqueCierre: RelId;
  embarqueZonaPrimaria: RelId;
  despacho: { id: string; embarqueId: string } | null;
  embarqueCosto: { id: number; embarqueId: string } | null;
  movimiento: RelId;
  gasto: RelId;
  gastoFijoRegistro: RelId;
  prestamo: RelId;
  chequeRecibidoCobro: RelId;
  entregaVenta: RelId;
  anticipoProveedor: RelId;
  aplicacionAnticipo: RelId;
  divergenciaAjuste: RelId;
};

function asientoVacio(id: string): AsientoRow {
  return {
    id,
    venta: null,
    compra: null,
    embarqueCierre: null,
    embarqueZonaPrimaria: null,
    despacho: null,
    embarqueCosto: null,
    movimiento: null,
    gasto: null,
    gastoFijoRegistro: null,
    prestamo: null,
    chequeRecibidoCobro: null,
    entregaVenta: null,
    anticipoProveedor: null,
    aplicacionAnticipo: null,
    divergenciaAjuste: null,
  };
}

describe("resolverDocumentoOrigen (helper síncrono puro)", () => {
  it("venta → /ventas/{id}", () => {
    const doc = resolverDocumentoOrigen({ ventaId: "V1" });
    expect(doc).toEqual({ tipo: "venta", id: "V1", href: "/ventas/V1", etiqueta: "Venta" });
  });

  it("compra → /compras/{id}", () => {
    const doc = resolverDocumentoOrigen({ compraId: "C1" });
    expect(doc).toEqual({ tipo: "compra", id: "C1", href: "/compras/C1", etiqueta: "Compra" });
  });

  it("embarque → /comex/embarques/{id}", () => {
    const doc = resolverDocumentoOrigen({ embarqueId: "E1" });
    expect(doc).toEqual({
      tipo: "embarque",
      id: "E1",
      href: "/comex/embarques/E1",
      etiqueta: "Embarque",
    });
  });

  it("pago (movimiento) → /tesoreria/movimientos/{id}", () => {
    const doc = resolverDocumentoOrigen({ movimientoId: "M1" });
    expect(doc).toEqual({
      tipo: "pago",
      id: "M1",
      href: "/tesoreria/movimientos/M1",
      etiqueta: "Pago",
    });
  });

  it("gasto → /gastos/{id}", () => {
    const doc = resolverDocumentoOrigen({ gastoId: "G1" });
    expect(doc?.href).toBe("/gastos/G1");
  });

  it("despacho → href del embarque-padre (NO /comex/despachos)", () => {
    const doc = resolverDocumentoOrigen({ despachoId: "D1", despachoEmbarqueId: "E9" });
    expect(doc).toEqual({
      tipo: "despacho",
      id: "D1",
      href: "/comex/embarques/E9",
      etiqueta: "Despacho",
    });
    expect(doc?.href).not.toContain("/despachos");
  });

  it("embarque-costo → href del embarque-padre", () => {
    const doc = resolverDocumentoOrigen({ embarqueCostoId: "77", embarqueCostoEmbarqueId: "E5" });
    expect(doc).toEqual({
      tipo: "embarque-costo",
      id: "77",
      href: "/comex/embarques/E5",
      etiqueta: "Costo embarque",
    });
  });

  it("anticipo → /tesoreria/anticipos (índice, sin /{id})", () => {
    const doc = resolverDocumentoOrigen({ anticipoProveedorId: "A1" });
    expect(doc?.tipo).toBe("anticipo");
    expect(doc?.href).toBe("/tesoreria/anticipos");
    expect(doc?.href).not.toMatch(/anticipos\/A1$/);
  });

  it("préstamo/gasto-fijo/entrega → índices existentes", () => {
    expect(resolverDocumentoOrigen({ prestamoId: "P1" })?.href).toBe("/tesoreria/prestamos");
    expect(resolverDocumentoOrigen({ gastoFijoRegistroId: "GF1" })?.href).toBe("/gastos-fijos");
    expect(resolverDocumentoOrigen({ entregaVentaId: "EN1" })?.href).toBe("/entregas");
  });

  it("sin ninguna relación → null", () => {
    expect(resolverDocumentoOrigen({})).toBeNull();
  });

  it("cheque-cobro / divergencia (sin ruta) → null", () => {
    expect(resolverDocumentoOrigen({ chequeRecibidoCobroId: "CH1" })).toBeNull();
    expect(resolverDocumentoOrigen({ divergenciaAjusteId: "DV1" })).toBeNull();
  });

  it("despacho sin embarque-padre → null (defensivo, no inventa ruta)", () => {
    expect(resolverDocumentoOrigen({ despachoId: "D1" })).toBeNull();
  });

  it("prioridad determinística: venta vence a compra/embarque", () => {
    const claves: ClavesOrigenAsiento = { ventaId: "V1", compraId: "C1", embarqueId: "E1" };
    expect(resolverDocumentoOrigen(claves)?.tipo).toBe("venta");
  });

  it("no-vácuo: cambiar el id cambia el href", () => {
    expect(resolverDocumentoOrigen({ ventaId: "V1" })?.href).toBe("/ventas/V1");
    expect(resolverDocumentoOrigen({ ventaId: "V2" })?.href).toBe("/ventas/V2");
  });
});

describe("documentosOrigenPorAsiento (batch)", () => {
  it("resuelve cada tipo y devuelve un Map con una entrada por id", async () => {
    const rows: AsientoRow[] = [
      { ...asientoVacio("as-venta"), venta: { id: "V1" } },
      { ...asientoVacio("as-compra"), compra: { id: "C1" } },
      { ...asientoVacio("as-embarque"), embarqueCierre: { id: "E1" } },
      { ...asientoVacio("as-pago"), movimiento: { id: "M1" } },
      { ...asientoVacio("as-despacho"), despacho: { id: "D1", embarqueId: "E9" } },
      { ...asientoVacio("as-costo"), embarqueCosto: { id: 77, embarqueId: "E5" } },
      { ...asientoVacio("as-cierre") }, // sin documento
    ];
    findMany.mockResolvedValue(rows);

    const map = await documentosOrigenPorAsiento(rows.map((r) => r.id));

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(map.size).toBe(7);
    expect(map.get("as-venta")).toMatchObject({ tipo: "venta", href: "/ventas/V1" });
    expect(map.get("as-compra")).toMatchObject({ tipo: "compra", href: "/compras/C1" });
    expect(map.get("as-embarque")).toMatchObject({ href: "/comex/embarques/E1" });
    expect(map.get("as-pago")).toMatchObject({ href: "/tesoreria/movimientos/M1" });
    expect(map.get("as-despacho")).toMatchObject({ href: "/comex/embarques/E9" });
    expect(map.get("as-costo")).toMatchObject({ tipo: "embarque-costo", id: "77" });
    expect(map.get("as-cierre")).toBeNull();
  });

  it("embarque por zona primaria también resuelve a /comex/embarques/{id}", async () => {
    findMany.mockResolvedValue([
      { ...asientoVacio("as-zp"), embarqueZonaPrimaria: { id: "EZP" } },
    ]);
    const map = await documentosOrigenPorAsiento(["as-zp"]);
    expect(map.get("as-zp")).toMatchObject({ tipo: "embarque", href: "/comex/embarques/EZP" });
  });

  it("una sola consulta para N asientos (sin N+1) y dedup de ids", async () => {
    findMany.mockResolvedValue([
      { ...asientoVacio("a1"), venta: { id: "V1" } },
      { ...asientoVacio("a2"), compra: { id: "C1" } },
    ]);

    await documentosOrigenPorAsiento(["a1", "a2", "a1", "a2", "a1"]);

    expect(findMany).toHaveBeenCalledTimes(1);
    const arg = findMany.mock.calls[0][0];
    expect(arg.where.id.in).toEqual(["a1", "a2"]); // distintos, sin duplicados
  });

  it("id inexistente (no devuelto por la BD) → entrada null en el Map", async () => {
    findMany.mockResolvedValue([]); // la BD no devuelve nada
    const map = await documentosOrigenPorAsiento(["fantasma"]);
    expect(map.size).toBe(1);
    expect(map.get("fantasma")).toBeNull();
  });

  it("lista vacía → Map vacío sin tocar la BD", async () => {
    const map = await documentosOrigenPorAsiento([]);
    expect(map.size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("select mínimo: pide embarqueId para despacho y costo (no include cheio)", async () => {
    findMany.mockResolvedValue([]);
    await documentosOrigenPorAsiento(["x"]);
    const sel = findMany.mock.calls[0][0].select;
    expect(sel.despacho.select).toEqual({ id: true, embarqueId: true });
    expect(sel.embarqueCosto.select).toEqual({ id: true, embarqueId: true });
    expect(sel.venta.select).toEqual({ id: true });
  });
});

describe("documentoOrigen (unitario)", () => {
  it("delega en el batch y devuelve el documento del id", async () => {
    findMany.mockResolvedValue([{ ...asientoVacio("uno"), venta: { id: "V1" } }]);
    const doc = await documentoOrigen("uno");
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(doc).toMatchObject({ tipo: "venta", href: "/ventas/V1" });
  });

  it("asiento sin documento → null", async () => {
    findMany.mockResolvedValue([asientoVacio("dos")]);
    expect(await documentoOrigen("dos")).toBeNull();
  });
});
