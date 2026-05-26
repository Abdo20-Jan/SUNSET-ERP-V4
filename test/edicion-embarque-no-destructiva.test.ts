import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// Gap #3 — Edición de embarque no destructiva.
//
// guardarEmbarqueAction hacía deleteMany(ItemEmbarque) + deleteMany(EmbarqueCosto)
// y recreaba con NUEVOS ids en cada edición. Como ItemContenedor.itemEmbarque es
// onDelete:SetNull, toda edición orfanaba el packing list (itemEmbarqueId → NULL),
// y borrar una EmbarqueCosto EMITIDA (con asientoId) orfanaba/duplicaba su asiento.
//
// Fix: reconciliar ItemEmbarque por productoId (preserva ids → el link
// ItemContenedor sobrevive) y NUNCA borrar facturas EMITIDA/LEGACY_BUNDLED/ANULADA.

const h = vi.hoisted(() => {
  let client: PrismaClient | undefined;
  return {
    setClient: (c: PrismaClient) => {
      client = c;
    },
    dbProxy: new Proxy(
      {},
      {
        get(_t, prop) {
          const target = client as unknown as Record<string | symbol, unknown> | undefined;
          const value = target?.[prop];
          return typeof value === "function"
            ? (value as (...args: unknown[]) => unknown).bind(client)
            : value;
        },
      },
    ),
  };
});

vi.mock("@/lib/db", () => ({ db: h.dbProxy }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "user-uuid" } })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { guardarEmbarqueAction, type GuardarEmbarqueInput } from "@/lib/actions/embarques";
import { crearAsientoEmbarqueCosto } from "@/lib/services/asiento-automatico";

describe("edición de embarque no destructiva (gap #3)", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    h.setClient(db.prisma);
  });

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await db.reset([
      "MovimientoStock",
      "StockPorDeposito",
      "LineaAsiento",
      "Asiento",
      "EmbarqueCostoLinea",
      "EmbarqueCosto",
      "ItemContenedor",
      "Contenedor",
      "ItemEmbarque",
      "Embarque",
      "Deposito",
      "Producto",
      "Proveedor",
      "PeriodoContable",
      "CuentaContable",
    ]);
    await db.prisma.periodoContable.create({
      data: {
        codigo: "2026-05",
        nombre: "Mayo 2026",
        fechaInicio: new Date("2026-05-01T00:00:00.000Z"),
        fechaFin: new Date("2026-05-31T23:59:59.999Z"),
        estado: "ABIERTO",
      },
    });
  });

  async function seedBasico() {
    const prov = await db.prisma.proveedor.create({ data: { nombre: "Exterior SA" } });
    const dep = await db.prisma.deposito.create({ data: { nombre: "Central", tipo: "NACIONAL" } });
    const prodA = await db.prisma.producto.create({ data: { codigo: "A-1", nombre: "Prod A" } });
    const prodB = await db.prisma.producto.create({ data: { codigo: "B-1", nombre: "Prod B" } });
    return { prov, dep, prodA, prodB };
  }

  function baseInput(
    prov: { id: string },
    dep: { id: string },
    items: GuardarEmbarqueInput["items"],
    overrides: Partial<GuardarEmbarqueInput> = {},
  ): GuardarEmbarqueInput {
    return {
      codigo: "EMB-EDIT",
      proveedorId: prov.id,
      depositoDestinoId: dep.id,
      moneda: "USD",
      tipoCambio: "1000",
      estado: "BORRADOR",
      die: "0",
      tasaEstadistica: "0",
      arancelSim: "0",
      iva: "0",
      ivaAdicional: "0",
      ganancias: "0",
      iibb: "0",
      items,
      costos: [],
      ...overrides,
    };
  }

  it("(a) editar el item NO ligado preserva el link ItemContenedor del item ligado", async () => {
    const { prov, dep, prodA, prodB } = await seedBasico();

    // Crear embarque con 2 items.
    const created = await guardarEmbarqueAction(
      baseInput(prov, dep, [
        { productoId: prodA.id, cantidad: 60, precioUnitarioFob: "10.00" },
        { productoId: prodB.id, cantidad: 40, precioUnitarioFob: "10.00" },
      ]),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const itemsAntes = await db.prisma.itemEmbarque.findMany({
      where: { embarqueId: created.id },
      orderBy: { id: "asc" },
    });
    const itemA = itemsAntes.find((i) => i.productoId === prodA.id)!;
    const itemB = itemsAntes.find((i) => i.productoId === prodB.id)!;

    // Contenedor con ItemContenedor ligado al item A (packing list).
    const cont = await db.prisma.contenedor.create({
      data: { embarqueId: created.id, numeroContenedor: "MSCU-1", estado: "EN_TRANSITO" },
    });
    const ic = await db.prisma.itemContenedor.create({
      data: {
        contenedorId: cont.id,
        itemEmbarqueId: itemA.id,
        productoId: prodA.id,
        cantidadDeclarada: 60,
      },
    });
    expect(ic.itemEmbarqueId).toBe(itemA.id);

    // Editar SÓLO la cantidad del item B (no ligado).
    const edit = await guardarEmbarqueAction(
      baseInput(
        prov,
        dep,
        [
          { productoId: prodA.id, cantidad: 60, precioUnitarioFob: "10.00" },
          { productoId: prodB.id, cantidad: 55, precioUnitarioFob: "10.00" },
        ],
        { id: created.id },
      ),
    );
    expect(edit.ok).toBe(true);

    // El item A conserva su id (no fue recreado) y el link sobrevive.
    const itemAdespues = await db.prisma.itemEmbarque.findFirst({
      where: { embarqueId: created.id, productoId: prodA.id },
    });
    expect(itemAdespues?.id).toBe(itemA.id);

    const icDespues = await db.prisma.itemContenedor.findUnique({ where: { id: ic.id } });
    expect(icDespues?.itemEmbarqueId).not.toBeNull();
    expect(icDespues?.itemEmbarqueId).toBe(itemA.id);

    // El item B se actualizó (misma fila, nueva cantidad), no recreado.
    const itemBdespues = await db.prisma.itemEmbarque.findFirst({
      where: { embarqueId: created.id, productoId: prodB.id },
    });
    expect(itemBdespues?.id).toBe(itemB.id);
    expect(itemBdespues?.cantidad).toBe(55);
  });

  it("(b) editar embarque con factura EMITIDA preserva el asiento (mismo asientoId, sin duplicar)", async () => {
    const { prov, dep, prodA } = await seedBasico();
    const ctaPasivo = await db.prisma.cuentaContable.create({
      data: {
        codigo: "2.1.1.99",
        nombre: "Proveedor Local",
        tipo: "ANALITICA",
        categoria: "PASIVO",
        nivel: 4,
      },
    });
    const ctaGasto = await db.prisma.cuentaContable.create({
      data: {
        codigo: "5.4.1.11",
        nombre: "Gastos Portuarios",
        tipo: "ANALITICA",
        categoria: "EGRESO",
        nivel: 4,
      },
    });
    const provLocal = await db.prisma.proveedor.create({
      data: { nombre: "TRP SA", cuentaContableId: ctaPasivo.id },
    });

    const created = await guardarEmbarqueAction(
      baseInput(prov, dep, [{ productoId: prodA.id, cantidad: 100, precioUnitarioFob: "10.00" }]),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // Crear una factura BORRADOR y emitirla (genera asiento standalone).
    const costo = await db.prisma.embarqueCosto.create({
      data: {
        embarqueId: created.id,
        proveedorId: provLocal.id,
        moneda: "USD",
        tipoCambio: "1000.000000",
        momento: "ZONA_PRIMARIA",
        estado: "BORRADOR",
        fechaFactura: new Date("2026-05-10T12:00:00.000Z"),
        lineas: {
          create: [
            { tipo: "GASTOS_PORTUARIOS", cuentaContableGastoId: ctaGasto.id, subtotal: "500.00" },
          ],
        },
      },
    });
    await crearAsientoEmbarqueCosto(costo.id, db.prisma);
    const emitido = await db.prisma.embarqueCosto.findUniqueOrThrow({ where: { id: costo.id } });
    expect(emitido.estado).toBe("EMITIDA");
    const asientoIdOriginal = emitido.asientoId;
    expect(asientoIdOriginal).not.toBeNull();

    const asientosAntes = await db.prisma.asiento.count();

    // Editar el embarque (el form NO manda facturas EMITIDA en el payload).
    const edit = await guardarEmbarqueAction(
      baseInput(prov, dep, [{ productoId: prodA.id, cantidad: 120, precioUnitarioFob: "10.00" }], {
        id: created.id,
      }),
    );
    expect(edit.ok).toBe(true);

    // La factura EMITIDA sigue existiendo, con el MISMO asientoId y estado.
    const costoDespues = await db.prisma.embarqueCosto.findUnique({ where: { id: costo.id } });
    expect(costoDespues).not.toBeNull();
    expect(costoDespues?.estado).toBe("EMITIDA");
    expect(costoDespues?.asientoId).toBe(asientoIdOriginal);

    // No se creó un asiento nuevo.
    const asientosDespues = await db.prisma.asiento.count();
    expect(asientosDespues).toBe(asientosAntes);
  });

  it("(c) remover un item lo elimina; agregar uno nuevo lo crea", async () => {
    const { prov, dep, prodA, prodB } = await seedBasico();
    const prodC = await db.prisma.producto.create({ data: { codigo: "C-1", nombre: "Prod C" } });

    const created = await guardarEmbarqueAction(
      baseInput(prov, dep, [
        { productoId: prodA.id, cantidad: 10, precioUnitarioFob: "10.00" },
        { productoId: prodB.id, cantidad: 20, precioUnitarioFob: "10.00" },
      ]),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // Editar: quita B, agrega C, mantiene A.
    const edit = await guardarEmbarqueAction(
      baseInput(
        prov,
        dep,
        [
          { productoId: prodA.id, cantidad: 10, precioUnitarioFob: "10.00" },
          { productoId: prodC.id, cantidad: 30, precioUnitarioFob: "10.00" },
        ],
        { id: created.id },
      ),
    );
    expect(edit.ok).toBe(true);

    const items = await db.prisma.itemEmbarque.findMany({ where: { embarqueId: created.id } });
    const productos = items.map((i) => i.productoId).sort();
    expect(productos).toEqual([prodA.id, prodC.id].sort());
    expect(items.find((i) => i.productoId === prodB.id)).toBeUndefined();
    expect(items.find((i) => i.productoId === prodC.id)?.cantidad).toBe(30);
  });
});
