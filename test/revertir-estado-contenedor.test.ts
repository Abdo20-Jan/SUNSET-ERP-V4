import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  avanzarEstadoContenedor,
  ContenedorError,
  revertirEstadoContenedor,
} from "@/lib/services/contenedor";
import { createTestDb, type TestDb } from "./db";

// Gap #6 — revertir el estado físico/aduanero del contenedor + guard de
// costoFCUnitario antes de pasar a EN_DEPOSITO_FISCAL.
//
// `revertirEstadoContenedor` deshace una fase: vuelve a un estado de rank menor
// y limpia la fecha de la fase abandonada. Prohibido si el contenedor ya está
// DESCONSOLIDADO o tiene MovimientoStock/Desconsolidacion ligados (REVERSION_INVALIDA).
//
// El guard en `avanzarEstadoContenedor` exige que todos los ItemContenedor
// tengan costoFCUnitario != null antes de EN_DEPOSITO_FISCAL (COSTOS_INCOMPLETOS).

describe("revertirEstadoContenedor + guard costoFC (gap #6)", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    await db.reset([
      "MovimientoStock",
      "Desconsolidacion",
      "ItemContenedor",
      "Contenedor",
      "ItemEmbarque",
      "Embarque",
      "Producto",
      "Deposito",
      "Proveedor",
    ]);
  });

  const FECHA = new Date("2026-05-21T12:00:00.000Z");

  async function seed(opts?: { conCostoFC?: boolean }) {
    const prov = await db.prisma.proveedor.create({ data: { nombre: "Exterior SA" } });
    const dZp = await db.prisma.deposito.create({ data: { nombre: "Zona Primaria" } });
    const dDf = await db.prisma.deposito.create({ data: { nombre: "Depósito Fiscal" } });
    const prod = await db.prisma.producto.create({
      data: { codigo: "P-A", nombre: "Neumático A" },
    });
    const embarque = await db.prisma.embarque.create({
      data: {
        codigo: "EMB-1",
        proveedorId: prov.id,
        moneda: "USD",
        tipoCambio: "1000.000000",
        items: { create: [{ productoId: prod.id, cantidad: 10, precioUnitarioFob: "10.00" }] },
      },
    });
    const cont = await db.prisma.contenedor.create({
      data: {
        embarqueId: embarque.id,
        numeroContenedor: "MSCU-1",
        estado: "BORRADOR",
        items: {
          create: [
            {
              productoId: prod.id,
              cantidadDeclarada: 10,
              cantidadDisponible: 0,
              cantidadEnDespacho: 0,
              cantidadDespachada: 0,
              costoFCUnitario: opts?.conCostoFC ? "5.0000" : undefined,
            },
          ],
        },
      },
    });
    return {
      contenedorId: cont.id,
      embarqueId: embarque.id,
      productoId: prod.id,
      dZpId: dZp.id,
      dDfId: dDf.id,
    };
  }

  // ---- Guard costoFC antes de EN_DEPOSITO_FISCAL --------------------------

  it("avanzar a EN_DEPOSITO_FISCAL con algún costoFCUnitario null → COSTOS_INCOMPLETOS", async () => {
    const s = await seed({ conCostoFC: false });
    await avanzarEstadoContenedor(
      { contenedorId: s.contenedorId, targetEstado: "TRASLADO_DEPOSITO_FISCAL", fecha: FECHA },
      db.prisma,
    );
    await expect(
      avanzarEstadoContenedor(
        {
          contenedorId: s.contenedorId,
          targetEstado: "EN_DEPOSITO_FISCAL",
          fecha: FECHA,
          depositoFiscalId: s.dDfId,
        },
        db.prisma,
      ),
    ).rejects.toMatchObject({ code: "COSTOS_INCOMPLETOS" });
  });

  it("avanzar a EN_DEPOSITO_FISCAL con todos los costoFCUnitario cargados → ok", async () => {
    const s = await seed({ conCostoFC: true });
    await avanzarEstadoContenedor(
      { contenedorId: s.contenedorId, targetEstado: "TRASLADO_DEPOSITO_FISCAL", fecha: FECHA },
      db.prisma,
    );
    const c = await avanzarEstadoContenedor(
      {
        contenedorId: s.contenedorId,
        targetEstado: "EN_DEPOSITO_FISCAL",
        fecha: FECHA,
        depositoFiscalId: s.dDfId,
      },
      db.prisma,
    );
    expect(c.estado).toBe("EN_DEPOSITO_FISCAL");
  });

  // ---- Revertir válido ----------------------------------------------------

  it("revertir EN_ZONA_PRIMARIA → ARRIBADO_PUERTO vuelve el estado y zera fechaIngresoZpa", async () => {
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
    const before = await db.prisma.contenedor.findUniqueOrThrow({
      where: { id: s.contenedorId },
    });
    expect(before.fechaIngresoZpa).not.toBeNull();

    const c = await revertirEstadoContenedor(
      { contenedorId: s.contenedorId, targetEstado: "ARRIBADO_PUERTO" },
      db.prisma,
    );
    expect(c.estado).toBe("ARRIBADO_PUERTO");
    expect(c.fechaIngresoZpa).toBeNull();
  });

  // ---- Revertir inválido: target rank >= actual ---------------------------

  it("revertir al mismo estado o adelante → ESTADO_TRANSICION_INVALIDA", async () => {
    const s = await seed();
    await avanzarEstadoContenedor(
      { contenedorId: s.contenedorId, targetEstado: "ARRIBADO_PUERTO", fecha: FECHA },
      db.prisma,
    );
    // mismo estado
    await expect(
      revertirEstadoContenedor(
        { contenedorId: s.contenedorId, targetEstado: "ARRIBADO_PUERTO" },
        db.prisma,
      ),
    ).rejects.toMatchObject({ code: "ESTADO_TRANSICION_INVALIDA" });
    // adelante
    await expect(
      revertirEstadoContenedor(
        { contenedorId: s.contenedorId, targetEstado: "EN_ZONA_PRIMARIA" },
        db.prisma,
      ),
    ).rejects.toMatchObject({ code: "ESTADO_TRANSICION_INVALIDA" });
    expect(ContenedorError).toBeDefined();
  });

  // ---- Revertir inválido: contenedor con desconsolidación / stock ---------

  it("revertir un contenedor DESCONSOLIDADO con MovimientoStock → REVERSION_INVALIDA", async () => {
    const s = await seed({ conCostoFC: true });
    await db.prisma.contenedor.update({
      where: { id: s.contenedorId },
      data: { estado: "DESCONSOLIDADO", depositoFiscalId: s.dDfId },
    });
    const desc = await db.prisma.desconsolidacion.create({
      data: {
        contenedorId: s.contenedorId,
        depositoFiscalId: s.dDfId,
      },
    });
    await db.prisma.movimientoStock.create({
      data: {
        productoId: s.productoId,
        depositoId: s.dDfId,
        tipo: "INGRESO",
        cantidad: 10,
        costoUnitario: "5000.00",
        contenedorId: s.contenedorId,
        desconsolidacionId: desc.id,
      },
    });

    await expect(
      revertirEstadoContenedor(
        { contenedorId: s.contenedorId, targetEstado: "EN_DEPOSITO_FISCAL" },
        db.prisma,
      ),
    ).rejects.toMatchObject({ code: "REVERSION_INVALIDA" });
  });
});
