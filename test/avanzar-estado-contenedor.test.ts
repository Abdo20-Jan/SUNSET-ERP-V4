import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ContenedorError, avanzarEstadoContenedor } from "@/lib/services/contenedor";
import { createTestDb, type TestDb } from "./db";

// Ponte PR A — transición de estado físico/aduanero del contenedor. Avanza
// Contenedor.estado a lo largo del ciclo (BORRADOR → … → EN_DEPOSITO_FISCAL),
// seteando la fecha de la fase y el depósito cuando corresponde. Sólo avanza
// (nunca retrocede); EN_DEPOSITO_FISCAL exige depositoFiscalId.

describe("avanzarEstadoContenedor (Ponte PR A)", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    await db.reset(["ItemContenedor", "Contenedor", "Embarque", "Deposito", "Proveedor"]);
  });

  async function seed() {
    const prov = await db.prisma.proveedor.create({ data: { nombre: "Exterior SA" } });
    const dZp = await db.prisma.deposito.create({ data: { nombre: "Zona Primaria" } });
    const dDf = await db.prisma.deposito.create({ data: { nombre: "Depósito Fiscal" } });
    const embarque = await db.prisma.embarque.create({
      data: { codigo: "EMB-1", proveedorId: prov.id, moneda: "USD", tipoCambio: "1000.000000" },
    });
    const cont = await db.prisma.contenedor.create({
      data: { embarqueId: embarque.id, numeroContenedor: "MSCU-1", estado: "BORRADOR" },
    });
    return { contenedorId: cont.id, dZpId: dZp.id, dDfId: dDf.id };
  }

  const FECHA = new Date("2026-05-21T12:00:00.000Z");

  it("avança BORRADOR → EN_TRANSITO y setea fechaSalidaOrigen", async () => {
    const s = await seed();
    await avanzarEstadoContenedor(
      { contenedorId: s.contenedorId, targetEstado: "EN_TRANSITO", fecha: FECHA },
      db.prisma,
    );
    const c = await db.prisma.contenedor.findUniqueOrThrow({ where: { id: s.contenedorId } });
    expect(c.estado).toBe("EN_TRANSITO");
    expect(c.fechaSalidaOrigen?.toISOString()).toBe(FECHA.toISOString());
  });

  it("EN_ZONA_PRIMARIA setea fechaIngresoZpa y depositoZonaPrimariaId", async () => {
    const s = await seed();
    await avanzarEstadoContenedor(
      {
        contenedorId: s.contenedorId,
        targetEstado: "EN_ZONA_PRIMARIA",
        fecha: FECHA,
        depositoZonaPrimariaId: s.dZpId,
      },
      db.prisma,
    );
    const c = await db.prisma.contenedor.findUniqueOrThrow({ where: { id: s.contenedorId } });
    expect(c.estado).toBe("EN_ZONA_PRIMARIA");
    expect(c.fechaIngresoZpa?.toISOString()).toBe(FECHA.toISOString());
    expect(c.depositoZonaPrimariaId).toBe(s.dZpId);
  });

  it("EN_DEPOSITO_FISCAL sin depósito fiscal rechaza con DEPOSITO_REQUERIDO", async () => {
    const s = await seed();
    await expect(
      avanzarEstadoContenedor(
        { contenedorId: s.contenedorId, targetEstado: "EN_DEPOSITO_FISCAL", fecha: FECHA },
        db.prisma,
      ),
    ).rejects.toMatchObject({ code: "DEPOSITO_REQUERIDO" });
  });

  it("EN_DEPOSITO_FISCAL con depósito fiscal setea estado + depositoFiscalId", async () => {
    const s = await seed();
    await avanzarEstadoContenedor(
      {
        contenedorId: s.contenedorId,
        targetEstado: "EN_DEPOSITO_FISCAL",
        fecha: FECHA,
        depositoFiscalId: s.dDfId,
      },
      db.prisma,
    );
    const c = await db.prisma.contenedor.findUniqueOrThrow({ where: { id: s.contenedorId } });
    expect(c.estado).toBe("EN_DEPOSITO_FISCAL");
    expect(c.depositoFiscalId).toBe(s.dDfId);
    expect(c.fechaTrasladoDF).toBeNull(); // sólo se setea al pasar por TRASLADO_DEPOSITO_FISCAL
  });

  it("rechaza retroceder o quedarse en el mismo estado", async () => {
    const s = await seed();
    await avanzarEstadoContenedor(
      { contenedorId: s.contenedorId, targetEstado: "EN_ZONA_PRIMARIA", fecha: FECHA },
      db.prisma,
    );
    await expect(
      avanzarEstadoContenedor(
        { contenedorId: s.contenedorId, targetEstado: "EN_TRANSITO", fecha: FECHA },
        db.prisma,
      ),
    ).rejects.toMatchObject({ code: "ESTADO_TRANSICION_INVALIDA" });
    expect(ContenedorError).toBeDefined();
  });
});
