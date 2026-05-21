import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cerrarCostosContenedor, ContenedorError } from "@/lib/services/contenedor";
import { createTestDb, type TestDb } from "./db";

// Ponte PR B — cerrar costos del contenedor: deriva costoFCUnitario (USD, 4
// decimales) por SKU reusando calcularRateioZonaPrimaria (ARS/unidad) ÷ el
// tipoCambio del embarque, mapeando ItemEmbarque→ItemContenedor por productoId.
// Acepta override manual, bloqueo optimista por updatedAt y exige que todos los
// items queden con costoFCUnitario != null (gate D3 de la desconsolidación).

describe("cerrarCostosContenedor (Ponte PR B)", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    await db.reset([
      "ItemContenedor",
      "Contenedor",
      "ItemEmbarque",
      "Embarque",
      "Producto",
      "Proveedor",
    ]);
  });

  // FOB 1000 USD @ TC 1000 → base rateable 1.000.000 ARS, sin flete/seguro/ZP.
  // A: 60 u × FOB 10 (600) ; B: 40 u × FOB 10 (400). Proporción FOB → cada SKU
  // ratea 10.000 ARS/u ÷ TC 1000 = 10,0000 USD/u (limpio, sin residuo).
  async function seed() {
    const prov = await db.prisma.proveedor.create({ data: { nombre: "Exterior SA" } });
    const prodA = await db.prisma.producto.create({ data: { codigo: "A-1", nombre: "Prod A" } });
    const prodB = await db.prisma.producto.create({ data: { codigo: "B-1", nombre: "Prod B" } });
    const embarque = await db.prisma.embarque.create({
      data: {
        codigo: "EMB-1",
        proveedorId: prov.id,
        moneda: "USD",
        tipoCambio: "1000.000000",
        fobTotal: "1000.00",
      },
    });
    const ieA = await db.prisma.itemEmbarque.create({
      data: { embarqueId: embarque.id, productoId: prodA.id, cantidad: 60, precioUnitarioFob: "10.00" },
    });
    const ieB = await db.prisma.itemEmbarque.create({
      data: { embarqueId: embarque.id, productoId: prodB.id, cantidad: 40, precioUnitarioFob: "10.00" },
    });
    const cont = await db.prisma.contenedor.create({
      data: { embarqueId: embarque.id, numeroContenedor: "MSCU-1", estado: "BORRADOR" },
    });
    await db.prisma.itemContenedor.createMany({
      data: [
        { contenedorId: cont.id, itemEmbarqueId: ieA.id, productoId: prodA.id, cantidadDeclarada: 60 },
        { contenedorId: cont.id, itemEmbarqueId: ieB.id, productoId: prodB.id, cantidadDeclarada: 40 },
      ],
    });
    const fresh = await db.prisma.contenedor.findUniqueOrThrow({ where: { id: cont.id } });
    return { embarqueId: embarque.id, contenedorId: cont.id, prodAId: prodA.id, prodBId: prodB.id, updatedAt: fresh.updatedAt };
  }

  it("deriva costoFCUnitario del rateio ÷ TC para cada SKU", async () => {
    const s = await seed();
    await cerrarCostosContenedor(
      { contenedorId: s.contenedorId, expectedUpdatedAt: s.updatedAt },
      db.prisma,
    );
    const items = await db.prisma.itemContenedor.findMany({
      where: { contenedorId: s.contenedorId },
      orderBy: { id: "asc" },
    });
    expect(items).toHaveLength(2);
    for (const it of items) {
      expect(it.costoFCUnitario).not.toBeNull();
      expect(Number(it.costoFCUnitario)).toBeCloseTo(10, 4);
      // Reconciliación: costoFCUnitario × TC == costoUnitario rateado (ARS).
      expect(Number(it.costoFCUnitario) * 1000).toBeCloseTo(10000, 2);
    }
  });

  it("el override manual pisa el valor derivado de ese SKU", async () => {
    const s = await seed();
    await cerrarCostosContenedor(
      {
        contenedorId: s.contenedorId,
        expectedUpdatedAt: s.updatedAt,
        overrides: [{ productoId: s.prodAId, costoFCUnitario: "15.5" }],
      },
      db.prisma,
    );
    const items = await db.prisma.itemContenedor.findMany({
      where: { contenedorId: s.contenedorId },
    });
    const a = items.find((i) => i.productoId === s.prodAId);
    const b = items.find((i) => i.productoId === s.prodBId);
    expect(Number(a?.costoFCUnitario)).toBeCloseTo(15.5, 4);
    expect(Number(b?.costoFCUnitario)).toBeCloseTo(10, 4);
  });

  it("rechaza si el contenedor ya está en depósito fiscal (ESTADO_NO_EDITABLE)", async () => {
    const s = await seed();
    await db.prisma.contenedor.update({
      where: { id: s.contenedorId },
      data: { estado: "EN_DEPOSITO_FISCAL" },
    });
    const fresh = await db.prisma.contenedor.findUniqueOrThrow({ where: { id: s.contenedorId } });
    await expect(
      cerrarCostosContenedor(
        { contenedorId: s.contenedorId, expectedUpdatedAt: fresh.updatedAt },
        db.prisma,
      ),
    ).rejects.toMatchObject({ code: "ESTADO_NO_EDITABLE" });
  });

  it("rechaza con CONCURRENCIA cuando el token updatedAt está desactualizado", async () => {
    const s = await seed();
    await expect(
      cerrarCostosContenedor(
        { contenedorId: s.contenedorId, expectedUpdatedAt: new Date("2000-01-01T00:00:00.000Z") },
        db.prisma,
      ),
    ).rejects.toMatchObject({ code: "CONCURRENCIA" });
  });

  it("rechaza con COSTOS_INCOMPLETOS si algún item queda sin costo derivable ni override", async () => {
    const s = await seed();
    // Item huérfano: productoId sin ItemEmbarque correspondiente (estado
    // inconsistente que el gate debe atrapar antes de la desconsolidación).
    const prodC = await db.prisma.producto.create({ data: { codigo: "C-1", nombre: "Prod C" } });
    await db.prisma.itemContenedor.create({
      data: { contenedorId: s.contenedorId, productoId: prodC.id, cantidadDeclarada: 5 },
    });
    const fresh = await db.prisma.contenedor.findUniqueOrThrow({ where: { id: s.contenedorId } });
    await expect(
      cerrarCostosContenedor(
        { contenedorId: s.contenedorId, expectedUpdatedAt: fresh.updatedAt },
        db.prisma,
      ),
    ).rejects.toMatchObject({ code: "COSTOS_INCOMPLETOS" });
    expect(ContenedorError).toBeDefined();
  });
});
