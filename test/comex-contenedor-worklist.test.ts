import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { obtenerContenedorFicha } from "@/lib/services/contenedor-ficha";
import { listarContenedores } from "@/lib/services/contenedor-worklist";
import { createTestDb, type TestDb } from "./db";

// PR-024 / CX-04 — proyección de SÓLO LECTURA de la worklist global de
// contenedores. Verifica: (1) agrega los counters del packing list por
// contenedor (LEÍDOS, nunca recalculados); (2) con la flag apagada devuelve
// vacío SIN tocar la BD (inercia total); (3) el costo FC NO viaja sin
// `VER_COSTO_LANDED` (anti-leak server-side). Pasamos `db.prisma` como client
// para enrutar a la BD efímera (el singleton `db` apuntaría a otra base).

const FLAG = "CONTENEDOR_DESCONSOLIDACION_ENABLED";

describe("worklist global de contenedores (PR-024 / CX-04)", () => {
  let db: TestDb;
  let embarqueId: string;
  let productoA: string;
  let productoB: string;
  let depositoFiscalId: string;
  let flagPrevio: string | undefined;

  const listar: typeof listarContenedores = (f) => listarContenedores(f, db.prisma);

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    await db?.stop();
    if (flagPrevio === undefined) delete process.env[FLAG];
    else process.env[FLAG] = flagPrevio;
  });

  beforeEach(async () => {
    flagPrevio = process.env[FLAG];
    process.env[FLAG] = "true"; // feature ON por defecto en la suite

    await db.reset([
      "ItemContenedor",
      "Contenedor",
      "ItemEmbarque",
      "Embarque",
      "Producto",
      "Proveedor",
      "Deposito",
    ]);

    const prov = await db.prisma.proveedor.create({ data: { nombre: "Proveedor Test" } });
    const pa = await db.prisma.producto.create({ data: { codigo: "P-A", nombre: "Neumático A" } });
    const pb = await db.prisma.producto.create({ data: { codigo: "P-B", nombre: "Neumático B" } });
    productoA = pa.id;
    productoB = pb.id;

    const dep = await db.prisma.deposito.create({ data: { nombre: "DF Buenos Aires" } });
    depositoFiscalId = dep.id;

    const emb = await db.prisma.embarque.create({
      data: {
        codigo: "EMB-001",
        proveedorId: prov.id,
        moneda: "USD",
        tipoCambio: "1000.000000",
        items: {
          create: [
            { productoId: pa.id, cantidad: 100, precioUnitarioFob: "10.00" },
            { productoId: pb.id, cantidad: 40, precioUnitarioFob: "20.00" },
          ],
        },
      },
    });
    embarqueId = emb.id;
  });

  // Contenedor con dos SKU y counters + costo poblados (desconsolidado).
  async function crearContenedorPoblado() {
    return db.prisma.contenedor.create({
      data: {
        embarqueId,
        numeroContenedor: "MSCU1000001",
        numeroBL: "BL-1",
        numeroHBL: "HBL-1",
        estado: "EN_DEPOSITO_FISCAL",
        fechaSalidaOrigen: new Date("2026-01-01T00:00:00.000Z"),
        fechaLlegadaPuerto: new Date("2026-02-01T00:00:00.000Z"),
        depositoFiscalId,
        items: {
          create: [
            {
              productoId: productoA,
              cantidadDeclarada: 60,
              cantidadFisica: 58,
              cantidadDisponible: 40,
              cantidadEnDespacho: 10,
              cantidadDespachada: 8,
              costoFCUnitario: "10.0000",
            },
            {
              productoId: productoB,
              cantidadDeclarada: 40,
              cantidadFisica: 40,
              cantidadDisponible: 40,
              cantidadEnDespacho: 0,
              cantidadDespachada: 0,
              costoFCUnitario: "20.0000",
            },
          ],
        },
      },
    });
  }

  it("agrega los counters del packing list por contenedor (LEÍDOS del motor)", async () => {
    await crearContenedorPoblado();

    const { rows, total } = await listar({ verCosto: true });
    expect(total).toBe(1);
    const row = rows.find((r) => r.numeroContenedor === "MSCU1000001");
    expect(row).toBeDefined();
    expect(row).toMatchObject({
      numeroBL: "BL-1",
      numeroHBL: "HBL-1",
      estado: "EN_DEPOSITO_FISCAL",
      depositoFiscal: "DF Buenos Aires",
      embarqueCodigo: "EMB-001",
      proveedorNombre: "Proveedor Test",
      cantidadDeclarada: 100, // 60 + 40
      cantidadFisica: 98, //     58 + 40
      cantidadDisponible: 80, // 40 + 40
      cantidadEnDespacho: 10, // 10 + 0
      cantidadDespachada: 8, //   8 + 0
    });
    // Costo FC total (USD) = 10×60 + 20×40 = 1400 (agregación de valores almacenados).
    expect(row?.costoFCTotal).toBe("1400.00");
    expect(row?.fechaSalidaOrigen).toBe("2026-01-01T00:00:00.000Z");
  });

  it("counters en 0 y costo null cuando el contenedor no tiene items", async () => {
    await db.prisma.contenedor.create({
      data: { embarqueId, numeroContenedor: "SIN-ITEMS" },
    });

    const { rows } = await listar({ verCosto: true });
    const row = rows.find((r) => r.numeroContenedor === "SIN-ITEMS");
    expect(row).toMatchObject({
      cantidadDeclarada: 0,
      cantidadFisica: 0,
      cantidadDisponible: 0,
      cantidadEnDespacho: 0,
      cantidadDespachada: 0,
      costoFCTotal: null, // sin costoFCUnitario poblado
    });
  });

  it("omite el costo (server-side) sin VER_COSTO_LANDED", async () => {
    await crearContenedorPoblado();

    const { rows } = await listar({ verCosto: false });
    expect(rows.length).toBeGreaterThan(0);
    // El costo NUNCA viaja sin permiso: null en todas las filas.
    for (const row of rows) {
      expect(row.costoFCTotal).toBeNull();
    }
  });

  it("con la flag APAGADA devuelve vacío sin tocar la BD (inercia total)", async () => {
    await crearContenedorPoblado();
    process.env[FLAG] = "false";

    const { rows, total } = await listar({ verCosto: true });
    // A pesar de existir un contenedor, el short-circuit corta antes de cualquier query.
    expect(rows).toEqual([]);
    expect(total).toBe(0);
  });

  it("filtra por estado y por proveedor", async () => {
    await crearContenedorPoblado(); // EN_DEPOSITO_FISCAL
    await db.prisma.contenedor.create({
      data: { embarqueId, numeroContenedor: "BORRADOR-1", estado: "BORRADOR" },
    });

    const porEstado = await listar({ verCosto: false, estado: "BORRADOR" });
    expect(porEstado.rows.map((r) => r.numeroContenedor)).toEqual(["BORRADOR-1"]);

    const otroProveedor = await db.prisma.proveedor.create({ data: { nombre: "Otro" } });
    const porProveedor = await listar({ verCosto: false, proveedorId: otroProveedor.id });
    expect(porProveedor.rows).toEqual([]); // ningún contenedor de ese proveedor
  });

  describe("obtenerContenedorFicha (PR-024b)", () => {
    it("proyecta items, divergencia y costo (con permiso)", async () => {
      const c = await crearContenedorPoblado();

      const ficha = await obtenerContenedorFicha(c.id, true, db.prisma);
      expect(ficha).not.toBeNull();
      expect(ficha).toMatchObject({
        numeroContenedor: "MSCU1000001",
        estado: "EN_DEPOSITO_FISCAL",
        embarqueCodigo: "EMB-001",
        proveedorNombre: "Proveedor Test",
        depositoFiscal: "DF Buenos Aires",
      });
      expect(ficha?.items).toHaveLength(2);
      const itemA = ficha?.items.find((i) => i.productoCodigo === "P-A");
      expect(itemA?.divergencia).toBe(-2); // física 58 − declarada 60
      expect(Number(itemA?.costoFCUnitario)).toBe(10);
      expect(ficha?.costoFCTotal).toBe("1400.00"); // 10×60 + 20×40
      expect(ficha?.despachos).toEqual([]); // sin despachos que lo consuman
    });

    it("oculta el costo sin VER_COSTO_LANDED", async () => {
      const c = await crearContenedorPoblado();

      const ficha = await obtenerContenedorFicha(c.id, false, db.prisma);
      expect(ficha).not.toBeNull();
      expect(ficha?.costoFCTotal).toBeNull();
      for (const item of ficha?.items ?? []) {
        expect(item.costoFCUnitario).toBeNull();
      }
    });

    it("devuelve null con la flag apagada", async () => {
      const c = await crearContenedorPoblado();
      process.env[FLAG] = "false";

      const ficha = await obtenerContenedorFicha(c.id, true, db.prisma);
      expect(ficha).toBeNull();
    });
  });
});
