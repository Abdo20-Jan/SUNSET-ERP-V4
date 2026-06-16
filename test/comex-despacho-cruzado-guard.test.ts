import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { crearAsientoDespachoCruzado } from "@/lib/services/asiento-automatico";
import { createTestDb, type TestDb } from "./db";

// Onda A #1 — guard de coherencia de camino en el despacho cruzado.
// El cruzado credita 1.1.5.05 (depósito fiscal) al nacionalizar. Esa subcuenta
// SÓLO está financiada si la desconsolidación corrió antes (traslado
// 1.1.5.04 → 1.1.5.05) — lo que deja el contenedor en DESCONSOLIDADO.
// Nacionalizar (HABER 1.1.5.05) sin ese traslado deja la subcuenta DF con
// saldo ACREEDOR: es la raíz de la anomalía de 1.1.5.05 (−34M en prod).

const FECHA = new Date("2025-06-15T12:00:00.000Z");

describe("crearAsientoDespachoCruzado — guard de coherencia (Onda A #1)", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    await db.reset([
      "LineaAsiento",
      "Asiento",
      "MovimientoStock",
      "StockPorDeposito",
      "ItemDespacho",
      "Despacho",
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
        codigo: "2025-06",
        nombre: "Junio 2025",
        fechaInicio: new Date("2025-06-01T00:00:00.000Z"),
        fechaFin: new Date("2025-06-30T00:00:00.000Z"),
        estado: "ABIERTO",
      },
    });
  });

  async function seed(
    estadoContenedor: "DESCONSOLIDADO" | "EN_DEPOSITO_FISCAL",
  ): Promise<string> {
    const prov = await db.prisma.proveedor.create({ data: { nombre: "Exterior SA" } });
    const prod = await db.prisma.producto.create({
      data: { codigo: "SKU-1", nombre: "Neumático" },
    });
    const depFiscal = await db.prisma.deposito.create({
      data: { nombre: "DF Aduana", tipo: "ZONA_PRIMARIA" },
    });
    const embarque = await db.prisma.embarque.create({
      data: { codigo: "EMB-X", proveedorId: prov.id, moneda: "USD", tipoCambio: "1000.000000" },
    });
    const ie = await db.prisma.itemEmbarque.create({
      data: {
        embarqueId: embarque.id,
        productoId: prod.id,
        cantidad: 100,
        precioUnitarioFob: "10.00",
      },
    });
    const contenedor = await db.prisma.contenedor.create({
      data: {
        embarqueId: embarque.id,
        numeroContenedor: "MSCU0000001",
        estado: estadoContenedor,
        depositoFiscalId: depFiscal.id,
      },
    });
    const ic = await db.prisma.itemContenedor.create({
      data: {
        contenedorId: contenedor.id,
        itemEmbarqueId: ie.id,
        productoId: prod.id,
        cantidadDeclarada: 60,
        cantidadFisica: 60,
        cantidadDisponible: 60,
        costoFCUnitario: "12.5000",
      },
    });
    const despacho = await db.prisma.despacho.create({
      data: {
        codigo: "EMB-X-D1",
        embarqueId: embarque.id,
        fecha: FECHA,
        estado: "BORRADOR",
        tipoCambio: "1000.000000",
        die: "100.00",
        items: {
          create: [
            {
              itemEmbarqueId: ie.id,
              contenedorId: contenedor.id,
              itemContenedorId: ic.id,
              cantidad: 30,
            },
          ],
        },
      },
      select: { id: true },
    });
    return despacho.id;
  }

  it("rechaza si el contenedor NO está DESCONSOLIDADO (1.1.5.05 sin financiar)", async () => {
    const despachoId = await seed("EN_DEPOSITO_FISCAL");
    await expect(crearAsientoDespachoCruzado(despachoId, db.prisma)).rejects.toThrow(
      /DESCONSOLIDAD/i,
    );
    // No debe haber dejado asiento huérfano ni vinculado el despacho.
    expect(await db.prisma.asiento.count()).toBe(0);
    const desp = await db.prisma.despacho.findUniqueOrThrow({ where: { id: despachoId } });
    expect(desp.asientoId).toBeNull();
  });

  it("acepta cuando el contenedor está DESCONSOLIDADO", async () => {
    const despachoId = await seed("DESCONSOLIDADO");
    const asiento = await crearAsientoDespachoCruzado(despachoId, db.prisma);
    expect(asiento).toBeDefined();
    const desp = await db.prisma.despacho.findUniqueOrThrow({ where: { id: despachoId } });
    expect(desp.asientoId).toBe(asiento.id);
  });
});
