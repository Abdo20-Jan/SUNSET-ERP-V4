import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { desconsolidar } from "@/lib/services/desconsolidacion";
import { createTestDb, type TestDb } from "./db";

// PR 3.2 — service de desconsolidación (core, D4 + gate D9). Transación corta
// con lock pesimista (FOR UPDATE) sobre el contenedor: graba el físico,
// detecta divergencia, mueve stock consolidado por SKU al depósito fiscal
// (aplicarIngresoSPD reusado) y genera el asiento principal de transferencia
// de subcuenta (TRASLADO ZPA→DF, vía helper de PR 3.1). Si hay divergencia,
// bloquea el asiento/stock y deja el contenedor AGUARDANDO_INVESTIGACAO.

const FECHA = new Date("2025-06-15T12:00:00.000Z");
const TIPO_CAMBIO = "1000.000000"; // 1 USD = 1000 ARS

const TABLAS = [
  "DivergenciaItem",
  "DivergenciaInvestigacion",
  "Desconsolidacion",
  "MovimientoStock",
  "StockPorDeposito",
  "ItemContenedor",
  "Contenedor",
  "ItemEmbarque",
  "Embarque",
  "Producto",
  "Proveedor",
  "Deposito",
  "Asiento",
  "LineaAsiento",
  "CuentaContable",
  "PeriodoContable",
] as const;

interface SeedItem {
  itemContenedorId: number;
  productoId: string;
  cantidadDeclarada: number;
  costoFCUnitario: string; // USD
}

interface Seed {
  contenedorId: string;
  depositoFiscalId: string;
  items: SeedItem[];
}

describe("desconsolidacion (PR 3.2, D4 + gate D9)", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    await db.reset(TABLAS);
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

  /**
   * Semea un contenedor en EN_DEPOSITO_FISCAL con FC cerrado y N SKUs.
   * `defs`: [{ codigo, declarada, fc }].
   */
  async function seed(
    defs: Array<{ codigo: string; declarada: number; fc: string }> = [
      { codigo: "SKU-1", declarada: 100, fc: "10.0000" },
    ],
    estado: "EN_DEPOSITO_FISCAL" | "DESCONSOLIDADO" | "EN_ZONA_PRIMARIA" = "EN_DEPOSITO_FISCAL",
    conArribo = true,
  ): Promise<Seed> {
    const proveedor = await db.prisma.proveedor.create({ data: { nombre: "Exterior SA" } });
    const depositoFiscal = await db.prisma.deposito.create({
      data: { nombre: "DF Buenos Aires", tipo: "ZONA_PRIMARIA", subtipo: "DEPOSITO_FISCAL" },
    });
    const embarque = await db.prisma.embarque.create({
      data: {
        codigo: "EMB-3.2",
        proveedorId: proveedor.id,
        moneda: "USD",
        tipoCambio: TIPO_CAMBIO,
      },
    });
    // El arribo a zona primaria (debita 1.1.5.04) debe haber corrido antes de
    // desconsolidar — lo marcamos con un asiento mínimo y el FK del embarque.
    if (conArribo) {
      const periodo = await db.prisma.periodoContable.findFirstOrThrow();
      const arribo = await db.prisma.asiento.create({
        data: {
          numero: 1,
          fecha: FECHA,
          descripcion: `Arribo ZP ${embarque.codigo}`,
          estado: "CONTABILIZADO",
          origen: "COMEX",
          moneda: "ARS",
          tipoCambio: "1",
          totalDebe: "0",
          totalHaber: "0",
          periodoId: periodo.id,
        },
      });
      await db.prisma.embarque.update({
        where: { id: embarque.id },
        data: { asientoZonaPrimariaId: arribo.id },
      });
    }
    const contenedor = await db.prisma.contenedor.create({
      data: {
        embarqueId: embarque.id,
        numeroContenedor: "MSCU0000002",
        estado,
        depositoFiscalId: depositoFiscal.id,
      },
    });
    const items: SeedItem[] = [];
    for (const def of defs) {
      const producto = await db.prisma.producto.create({
        data: { codigo: def.codigo, nombre: `Producto ${def.codigo}` },
      });
      const ie = await db.prisma.itemEmbarque.create({
        data: {
          embarqueId: embarque.id,
          productoId: producto.id,
          cantidad: def.declarada,
          precioUnitarioFob: "10.00",
        },
      });
      const it = await db.prisma.itemContenedor.create({
        data: {
          contenedorId: contenedor.id,
          itemEmbarqueId: ie.id,
          productoId: producto.id,
          cantidadDeclarada: def.declarada,
          costoFCUnitario: def.fc,
        },
      });
      items.push({
        itemContenedorId: it.id,
        productoId: producto.id,
        cantidadDeclarada: def.declarada,
        costoFCUnitario: def.fc,
      });
    }
    return { contenedorId: contenedor.id, depositoFiscalId: depositoFiscal.id, items };
  }

  async function lineasDe(asientoId: string) {
    const lineas = await db.prisma.lineaAsiento.findMany({
      where: { asientoId },
      include: { cuenta: { select: { codigo: true } } },
      orderBy: { id: "asc" },
    });
    return lineas.map((l) => ({
      codigo: l.cuenta.codigo,
      debe: l.debe.toFixed(2),
      haber: l.haber.toFixed(2),
    }));
  }

  // ---- happy path (sin divergencia) ------------------------------------

  describe("sin divergencia", () => {
    it("setea counters, mueve stock por SKU y genera el asiento TRASLADO 1.1.5.05/1.1.5.04", async () => {
      const s = await seed();
      const out = await desconsolidar(
        {
          contenedorId: s.contenedorId,
          conferencia: [{ itemContenedorId: s.items[0]!.itemContenedorId, cantidadFisica: 100 }],
          fecha: FECHA,
        },
        db.prisma,
      );

      expect(out.divergencia).toBe(false);
      expect(out.contenedor.estado).toBe("DESCONSOLIDADO");
      expect(out.asiento).not.toBeNull();

      // counters
      const item = await db.prisma.itemContenedor.findUniqueOrThrow({
        where: { id: s.items[0]!.itemContenedorId },
      });
      expect(item.cantidadFisica).toBe(100);
      expect(item.cantidadDisponible).toBe(100);
      expect(item.cantidadEnDespacho).toBe(0);
      expect(item.cantidadDespachada).toBe(0);

      // movimiento de stock consolidado (1 por SKU) — ARS = FC × TC = 10000
      const movs = await db.prisma.movimientoStock.findMany({
        where: { desconsolidacionId: out.desconsolidacion.id },
      });
      expect(movs).toHaveLength(1);
      expect(movs[0]?.cantidad).toBe(100);
      expect(movs[0]?.costoUnitario.toFixed(2)).toBe("10000.00");
      expect(movs[0]?.depositoId).toBe(s.depositoFiscalId);
      expect(movs[0]?.contenedorId).toBe(s.contenedorId);

      // SPD del depósito fiscal
      const spd = await db.prisma.stockPorDeposito.findUniqueOrThrow({
        where: {
          productoId_depositoId: {
            productoId: s.items[0]!.productoId,
            depositoId: s.depositoFiscalId,
          },
        },
      });
      expect(spd.cantidadFisica).toBe(100);
      expect(spd.costoPromedio.toFixed(2)).toBe("10000.00");

      // asiento principal: Σ FC × cant × TC = 100 × 10 × 1000 = 1 000 000
      expect(await lineasDe(out.asiento!.id)).toEqual([
        { codigo: "1.1.5.05", debe: "1000000.00", haber: "0.00" },
        { codigo: "1.1.5.04", debe: "0.00", haber: "1000000.00" },
      ]);

      // header
      expect(out.desconsolidacion.cantidadDeclaradaTotal).toBe(100);
      expect(out.desconsolidacion.cantidadFisicaTotal).toBe(100);
    });

    it("consolida múltiples SKUs (1 movimiento por SKU, asiento sumado)", async () => {
      const s = await seed([
        { codigo: "SKU-1", declarada: 100, fc: "10.0000" },
        { codigo: "SKU-2", declarada: 40, fc: "5.0000" },
      ]);
      const out = await desconsolidar({ contenedorId: s.contenedorId, fecha: FECHA }, db.prisma);

      const movs = await db.prisma.movimientoStock.findMany({
        where: { desconsolidacionId: out.desconsolidacion.id },
      });
      expect(movs).toHaveLength(2);

      // 100×10×1000 + 40×5×1000 = 1 000 000 + 200 000 = 1 200 000
      expect(await lineasDe(out.asiento!.id)).toEqual([
        { codigo: "1.1.5.05", debe: "1200000.00", haber: "0.00" },
        { codigo: "1.1.5.04", debe: "0.00", haber: "1200000.00" },
      ]);
    });

    it("sin conferencia explícita asume físico == declarado (sin divergencia)", async () => {
      const s = await seed();
      const out = await desconsolidar({ contenedorId: s.contenedorId, fecha: FECHA }, db.prisma);
      expect(out.divergencia).toBe(false);
      expect(out.contenedor.estado).toBe("DESCONSOLIDADO");
    });
  });

  // ---- gate D9 (con divergencia) ---------------------------------------

  describe("con divergencia (gate D9)", () => {
    it("graba físico, crea header y deja AGUARDANDO_INVESTIGACAO sin asiento ni stock", async () => {
      // El camino con divergencia NO postea el traslado, así que no requiere
      // arribo — sembramos sin él para mantener la cuenta de asientos en 0.
      const s = await seed(undefined, "EN_DEPOSITO_FISCAL", false);
      const out = await desconsolidar(
        {
          contenedorId: s.contenedorId,
          conferencia: [{ itemContenedorId: s.items[0]!.itemContenedorId, cantidadFisica: 90 }],
          fecha: FECHA,
        },
        db.prisma,
      );

      expect(out.divergencia).toBe(true);
      expect(out.asiento).toBeNull();
      expect(out.contenedor.estado).toBe("AGUARDANDO_INVESTIGACAO");

      // físico grabado (para que abrirInvestigacion del 3.3 lo lea)
      const item = await db.prisma.itemContenedor.findUniqueOrThrow({
        where: { id: s.items[0]!.itemContenedorId },
      });
      expect(item.cantidadFisica).toBe(90);
      // counters NO se tocan en el camino bloqueado
      expect(item.cantidadDisponible).toBe(0);

      // header existe (para enganchar la investigación)
      expect(out.desconsolidacion.cantidadFisicaTotal).toBe(90);
      expect(out.desconsolidacion.cantidadDeclaradaTotal).toBe(100);

      // sin movimiento de stock ni asiento
      const movs = await db.prisma.movimientoStock.count({
        where: { desconsolidacionId: out.desconsolidacion.id },
      });
      expect(movs).toBe(0);
      expect(await db.prisma.asiento.count()).toBe(0);

      // diffs reportados
      expect(out.diffs).toEqual([
        expect.objectContaining({
          itemContenedorId: s.items[0]!.itemContenedorId,
          cantidadDeclarada: 100,
          cantidadFisica: 90,
          diferencia: -10,
        }),
      ]);
    });
  });

  // ---- validaciones -----------------------------------------------------

  describe("validaciones", () => {
    it("rechaza contenedor inexistente", async () => {
      await expect(
        desconsolidar({ contenedorId: "no-existe", fecha: FECHA }, db.prisma),
      ).rejects.toMatchObject({ code: "CONTENEDOR_INEXISTENTE" });
    });

    it("rechaza estado != EN_DEPOSITO_FISCAL", async () => {
      const s = await seed(
        [{ codigo: "SKU-1", declarada: 100, fc: "10.0000" }],
        "EN_ZONA_PRIMARIA",
      );
      await expect(
        desconsolidar({ contenedorId: s.contenedorId, fecha: FECHA }, db.prisma),
      ).rejects.toMatchObject({ code: "ESTADO_INVALIDO" });
    });

    it("rechaza re-desconsolidar (ya DESCONSOLIDADO)", async () => {
      const s = await seed([{ codigo: "SKU-1", declarada: 100, fc: "10.0000" }], "DESCONSOLIDADO");
      await expect(
        desconsolidar({ contenedorId: s.contenedorId, fecha: FECHA }, db.prisma),
      ).rejects.toMatchObject({ code: "YA_DESCONSOLIDADO" });
    });

    it("rechaza desconsolidar sin arribo confirmado (zona primaria) — Onda A #3", async () => {
      // Sin asientoZonaPrimariaId el traslado 1.1.5.04 → 1.1.5.05 acreditaría
      // 1.1.5.04 nunca debitada → subcuenta acreedora. Debe bloquearse.
      const s = await seed(undefined, "EN_DEPOSITO_FISCAL", false);
      await expect(
        desconsolidar({ contenedorId: s.contenedorId, fecha: FECHA }, db.prisma),
      ).rejects.toMatchObject({ code: "ARRIBO_PENDIENTE" });
    });

    it("rechaza FC no cerrado (costoFCUnitario null)", async () => {
      const s = await seed();
      await db.prisma.itemContenedor.update({
        where: { id: s.items[0]!.itemContenedorId },
        data: { costoFCUnitario: null },
      });
      await expect(
        desconsolidar({ contenedorId: s.contenedorId, fecha: FECHA }, db.prisma),
      ).rejects.toMatchObject({ code: "FC_NO_CERRADO" });
    });

    it("rechaza cantidadFisica negativa", async () => {
      const s = await seed();
      await expect(
        desconsolidar(
          {
            contenedorId: s.contenedorId,
            conferencia: [{ itemContenedorId: s.items[0]!.itemContenedorId, cantidadFisica: -1 }],
            fecha: FECHA,
          },
          db.prisma,
        ),
      ).rejects.toMatchObject({ code: "CONFERENCIA_INVALIDA" });
    });
  });

  // ---- idempotencia -----------------------------------------------------

  describe("idempotencia", () => {
    it("con la misma idempotencyKey no duplica desconsolidación ni asiento", async () => {
      const s = await seed();
      const first = await desconsolidar(
        { contenedorId: s.contenedorId, fecha: FECHA, idempotencyKey: "key-1" },
        db.prisma,
      );
      const second = await desconsolidar(
        { contenedorId: s.contenedorId, fecha: FECHA, idempotencyKey: "key-1" },
        db.prisma,
      );
      expect(second.desconsolidacion.id).toBe(first.desconsolidacion.id);
      expect(await db.prisma.desconsolidacion.count()).toBe(1);
      // arribo (sembrado) + traslado (1 sólo, idempotente) = 2.
      expect(await db.prisma.asiento.count()).toBe(2);
    });
  });
});
