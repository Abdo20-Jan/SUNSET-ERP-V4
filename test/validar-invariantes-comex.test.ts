import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { validarComex } from "../prisma/validar-invariantes-stock";
import { createTestDb, type TestDb } from "./db";

// PR 6.2 — invariantes comex del validador de stock. Cubre las 3 nuevas
// checagens (4/5/6) con un caso OK y un caso de violación detectada cada una,
// contra una BD real efímera (Testcontainers).

const TABLAS = [
  "DespachoBorrador",
  "Desconsolidacion",
  "ItemContenedor",
  "Contenedor",
  "ItemEmbarque",
  "Embarque",
  "Producto",
  "Proveedor",
] as const;

const TC = "1000.000000";

describe("validarComex (PR 6.2 — invariantes comex)", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    await db.reset(TABLAS);
  });

  /** Crea proveedor + producto + embarque + item de embarque base. */
  async function seedBase(codigo: string) {
    const proveedor = await db.prisma.proveedor.create({ data: { nombre: "Exterior SA" } });
    const producto = await db.prisma.producto.create({
      data: { codigo, nombre: `Neumático ${codigo}` },
    });
    const embarque = await db.prisma.embarque.create({
      data: { codigo: `EMB-${codigo}`, proveedorId: proveedor.id, moneda: "USD", tipoCambio: TC },
    });
    const itemEmbarque = await db.prisma.itemEmbarque.create({
      data: {
        embarqueId: embarque.id,
        productoId: producto.id,
        cantidad: 100,
        precioUnitarioFob: "10.00",
      },
    });
    return { producto, embarque, itemEmbarque };
  }

  // -----------------------------------------------------------------
  // Invariante 4: counters de ItemContenedor consistentes con cantidadFisica
  // -----------------------------------------------------------------

  it("invariante 4: OK cuando Σ counters == cantidadFisica", async () => {
    const { producto, embarque, itemEmbarque } = await seedBase("SKU-4OK");
    const contenedor = await db.prisma.contenedor.create({
      data: { embarqueId: embarque.id, numeroContenedor: "MSCU0040001", estado: "DESCONSOLIDADO" },
    });
    await db.prisma.itemContenedor.create({
      data: {
        contenedorId: contenedor.id,
        itemEmbarqueId: itemEmbarque.id,
        productoId: producto.id,
        cantidadDeclarada: 100,
        cantidadFisica: 100,
        cantidadDisponible: 70,
        cantidadEnDespacho: 20,
        cantidadDespachada: 10,
      },
    });
    const violaciones = await validarComex(db.prisma);
    expect(violaciones.filter((v) => v.invariante.startsWith("4"))).toHaveLength(0);
  });

  it("invariante 4: detecta divergencia de counters (suma != cantidadFisica)", async () => {
    const { producto, embarque, itemEmbarque } = await seedBase("SKU-4BAD");
    const contenedor = await db.prisma.contenedor.create({
      data: { embarqueId: embarque.id, numeroContenedor: "MSCU0040002", estado: "DESCONSOLIDADO" },
    });
    await db.prisma.itemContenedor.create({
      data: {
        contenedorId: contenedor.id,
        itemEmbarqueId: itemEmbarque.id,
        productoId: producto.id,
        cantidadDeclarada: 100,
        cantidadFisica: 100,
        cantidadDisponible: 70,
        cantidadEnDespacho: 20,
        cantidadDespachada: 5, // 70+20+5 = 95 != 100 → violación
      },
    });
    const violaciones = await validarComex(db.prisma);
    const v4 = violaciones.filter((v) => v.invariante.startsWith("4"));
    expect(v4).toHaveLength(1);
    expect(v4[0]?.detalle).toContain("suma=95");
  });

  it("invariante 4: ignora items AGUARDANDO_INVESTIGACAO (counts trabados a 0)", async () => {
    const { producto, embarque, itemEmbarque } = await seedBase("SKU-4INV");
    const contenedor = await db.prisma.contenedor.create({
      data: {
        embarqueId: embarque.id,
        numeroContenedor: "MSCU0040003",
        estado: "AGUARDANDO_INVESTIGACAO",
      },
    });
    // cantidadFisica grabada pero counters en 0 (gate D9): NO debe alertar.
    await db.prisma.itemContenedor.create({
      data: {
        contenedorId: contenedor.id,
        itemEmbarqueId: itemEmbarque.id,
        productoId: producto.id,
        cantidadDeclarada: 100,
        cantidadFisica: 90,
        cantidadDisponible: 0,
        cantidadEnDespacho: 0,
        cantidadDespachada: 0,
      },
    });
    const violaciones = await validarComex(db.prisma);
    expect(violaciones.filter((v) => v.invariante.startsWith("4"))).toHaveLength(0);
  });

  // -----------------------------------------------------------------
  // Invariante 5: borrador vencido con counters trabados sin revertir
  // -----------------------------------------------------------------

  it("invariante 5: OK cuando el borrador vencido ya está EXPIRADO", async () => {
    const { embarque } = await seedBase("SKU-5OK");
    await db.prisma.despachoBorrador.create({
      data: {
        userId: "user-uuid",
        embarqueId: embarque.id,
        estadoActual: "EXPIRADO", // ya revertido por el cron
        payloadDiff: { lineas: [] },
        countsTrabados: { "1": 30 },
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
    const violaciones = await validarComex(db.prisma);
    expect(violaciones.filter((v) => v.invariante.startsWith("5"))).toHaveLength(0);
  });

  it("invariante 5: detecta borrador vencido aún CONFIRMADO_TRABA_COUNTS", async () => {
    const { embarque } = await seedBase("SKU-5BAD");
    await db.prisma.despachoBorrador.create({
      data: {
        userId: "user-uuid",
        embarqueId: embarque.id,
        estadoActual: "CONFIRMADO_TRABA_COUNTS",
        payloadDiff: { lineas: [{ itemContenedorId: 1, cantidad: 30 }] },
        countsTrabados: { "1": 30 },
        expiresAt: new Date(Date.now() - 60_000), // venció y sigue trabado
      },
    });
    const violaciones = await validarComex(db.prisma);
    const v5 = violaciones.filter((v) => v.invariante.startsWith("5"));
    expect(v5).toHaveLength(1);
    expect(v5[0]?.detalle).toContain("countsTrabados");
  });

  it("invariante 5: ignora borrador CONFIRMADO no vencido", async () => {
    const { embarque } = await seedBase("SKU-5VIG");
    await db.prisma.despachoBorrador.create({
      data: {
        userId: "user-uuid",
        embarqueId: embarque.id,
        estadoActual: "CONFIRMADO_TRABA_COUNTS",
        payloadDiff: { lineas: [] },
        countsTrabados: { "1": 30 },
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    const violaciones = await validarComex(db.prisma);
    expect(violaciones.filter((v) => v.invariante.startsWith("5"))).toHaveLength(0);
  });

  // -----------------------------------------------------------------
  // Invariante 6: Desconsolidacion AGUARDANDO_INVESTIGACAO > 7 días
  // -----------------------------------------------------------------

  it("invariante 6: OK cuando la investigación lleva menos de 7 días", async () => {
    const { embarque } = await seedBase("SKU-6OK");
    const contenedor = await db.prisma.contenedor.create({
      data: {
        embarqueId: embarque.id,
        numeroContenedor: "MSCU0060001",
        estado: "AGUARDANDO_INVESTIGACAO",
      },
    });
    await db.prisma.desconsolidacion.create({
      data: {
        contenedorId: contenedor.id,
        fecha: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 días
      },
    });
    const violaciones = await validarComex(db.prisma);
    expect(violaciones.filter((v) => v.invariante.startsWith("6"))).toHaveLength(0);
  });

  it("invariante 6: detecta investigación parada hace más de 7 días", async () => {
    const { embarque } = await seedBase("SKU-6BAD");
    const contenedor = await db.prisma.contenedor.create({
      data: {
        embarqueId: embarque.id,
        numeroContenedor: "MSCU0060002",
        estado: "AGUARDANDO_INVESTIGACAO",
      },
    });
    await db.prisma.desconsolidacion.create({
      data: {
        contenedorId: contenedor.id,
        fecha: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 días
      },
    });
    const violaciones = await validarComex(db.prisma);
    const v6 = violaciones.filter((v) => v.invariante.startsWith("6"));
    expect(v6).toHaveLength(1);
    expect(v6[0]?.productoId).toBe(contenedor.id);
  });

  it("invariante 6: ignora desconsolidación cuyo contenedor ya salió de investigación", async () => {
    const { embarque } = await seedBase("SKU-6CERR");
    const contenedor = await db.prisma.contenedor.create({
      data: {
        embarqueId: embarque.id,
        numeroContenedor: "MSCU0060003",
        estado: "DESCONSOLIDADO", // investigación concluida
      },
    });
    await db.prisma.desconsolidacion.create({
      data: {
        contenedorId: contenedor.id,
        fecha: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      },
    });
    const violaciones = await validarComex(db.prisma);
    expect(violaciones.filter((v) => v.invariante.startsWith("6"))).toHaveLength(0);
  });
});
