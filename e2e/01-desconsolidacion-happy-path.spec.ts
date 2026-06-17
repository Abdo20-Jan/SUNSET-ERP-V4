import { expect, test } from "@playwright/test";
import { desconsolidar } from "@/lib/services/desconsolidacion";
import { createE2eDb, type E2eDb } from "./support/db";
import { crearPeriodoAbierto, seedContenedorEnDF, TABLAS_COMEX } from "./support/seed";

// CENÁRIO 1 — Happy path multi-contenedor.
//
// Un contenedor EN_DEPOSITO_FISCAL con varios SKUs y FC cerrado se desconsolida
// sin divergencia: pasa a DESCONSOLIDADO, ingresa stock al depósito fiscal (1
// MovimientoStock por SKU) y genera el asiento de traslado de subcuenta
// (DEBE 1.1.7.04 / HABER 1.1.7.03). Ejerce el service de producción
// `desconsolidar` contra un Postgres efímero (Testcontainers).

const FECHA = new Date("2025-06-15T12:00:00.000Z");

test.describe("CENÁRIO 1 · desconsolidación happy path multi-contenedor", () => {
  let db: E2eDb;

  test.beforeAll(async () => {
    process.env.CONTENEDOR_DESCONSOLIDACION_ENABLED = "true";
    db = await createE2eDb();
  });

  test.afterAll(async () => {
    await db?.stop();
  });

  test.beforeEach(async () => {
    await db.reset(TABLAS_COMEX);
    await crearPeriodoAbierto(db.prisma);
  });

  test("desconsolida 2 SKUs: DESCONSOLIDADO + stock al DF + asiento traslado sumado", async () => {
    // SKU-1: 100 un × 10 USD; SKU-2: 40 un × 5 USD. TC = 1000.
    const s = await seedContenedorEnDF(db.prisma, [
      { codigo: "SKU-1", declarada: 100, fc: "10.0000" },
      { codigo: "SKU-2", declarada: 40, fc: "5.0000" },
    ]);

    const out = await desconsolidar(
      {
        contenedorId: s.contenedorId,
        conferencia: s.items.map((it) => ({
          itemContenedorId: it.itemContenedorId,
          cantidadFisica: it.cantidadDeclarada,
        })),
        fecha: FECHA,
      },
      db.prisma,
    );

    // Sin divergencia → DESCONSOLIDADO + asiento generado.
    expect(out.divergencia).toBe(false);
    expect(out.contenedor.estado).toBe("DESCONSOLIDADO");
    expect(out.asiento).not.toBeNull();

    // Counters: físico==declarado, todo disponible.
    for (const it of s.items) {
      const ic = await db.prisma.itemContenedor.findUniqueOrThrow({
        where: { id: it.itemContenedorId },
      });
      expect(ic.cantidadFisica).toBe(it.cantidadDeclarada);
      expect(ic.cantidadDisponible).toBe(it.cantidadDeclarada);
      expect(ic.cantidadEnDespacho).toBe(0);
      expect(ic.cantidadDespachada).toBe(0);
    }

    // Un MovimientoStock por SKU al depósito fiscal.
    const movs = await db.prisma.movimientoStock.findMany({
      where: { desconsolidacionId: out.desconsolidacion.id },
    });
    expect(movs).toHaveLength(2);
    for (const m of movs) {
      expect(m.depositoId).toBe(s.depFiscalId);
      expect(m.contenedorId).toBe(s.contenedorId);
    }

    // Stock por depósito en el DF para cada SKU.
    for (const it of s.items) {
      const spd = await db.prisma.stockPorDeposito.findUniqueOrThrow({
        where: {
          productoId_depositoId: { productoId: it.productoId, depositoId: s.depFiscalId },
        },
      });
      expect(spd.cantidadFisica).toBe(it.cantidadDeclarada);
    }

    // Asiento de traslado sumado: 100×10×1000 + 40×5×1000 = 1 200 000 ARS.
    const lineas = await db.prisma.lineaAsiento.findMany({
      where: { asientoId: out.asiento!.id },
      include: { cuenta: { select: { codigo: true } } },
      orderBy: { id: "asc" },
    });
    expect(
      lineas.map((l) => ({
        codigo: l.cuenta.codigo,
        debe: l.debe.toFixed(2),
        haber: l.haber.toFixed(2),
      })),
    ).toEqual([
      // Traslado ZPA → depósito fiscal (códigos RT9): DEBE DF / HABER ZPA.
      { codigo: "1.1.7.04", debe: "1200000.00", haber: "0.00" },
      { codigo: "1.1.7.03", debe: "0.00", haber: "1200000.00" },
    ]);
  });
});
