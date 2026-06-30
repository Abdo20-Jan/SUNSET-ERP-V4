import Decimal from "decimal.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";
import { serializeGolden } from "./golden-serialize";

// ============================================================
// GOLDEN consolidado PR-023-pre (CRIT-05) — despacho landed-cost / memoria
// ============================================================
//
// Congela byte-a-byte, para despachos de referencia (sintéticos, deterministas):
//   - la MEMORIA de cálculo (obtenerMemoriaDespacho → calcularCostoLandedDespacho,
//     READ-ONLY) con su rateio por SKU,
//   - el COSTO CONTABLE (DEBE 1.1.7.01 = landed.costoTotalArs),
//   - el ASIENTO generado (líneas DEBE/HABER por cuenta),
//   - la ENTRADA DE STOCK (StockPorDeposito + Producto + ItemDespacho.costoUnitario).
//
// Cualquier divergencia aquí = regresión del motor de rateio (DO-NOT-TOUCH,
// [[09_COMEX_RATEIO_DO_NOT_TOUCH]]) y exige aprobación PO+Diretor + spec + CR.
// El costo gerencial (con IVA) se OMITE: ninguna función lo computa (D-3).
//
// Anclas (probadas, no sólo congeladas):
//   (1) memoria ANTES de contabilizar (BORRADOR, "Simular") == memoria DESPUÉS
//       (CONTABILIZADO) → la vía read-only es byte-estable en el ciclo de vida.
//   (2) landed.porItem[i].costoUnitarioLandedArs == ItemDespacho.costoUnitario
//       persistido == costo de la entrada de stock NACIONAL.
//   (3) landed.costoTotalArs == DEBE 1.1.7.01 del asiento.

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

import { contabilizarDespachoAction } from "@/lib/actions/despachos";
import { calcularCostoLandedDespacho } from "@/lib/services/despacho-parcial";
import { obtenerMemoriaDespacho } from "@/lib/services/despacho-memoria";

const RESET_TABLES = [
  "LineaAsiento",
  "Asiento",
  "MovimientoStock",
  "Transferencia",
  "StockPorDeposito",
  "VepDespacho",
  "EmbarqueCostoLinea",
  "EmbarqueCosto",
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
] as const;

// ── Config de un despacho cruzado sintético ───────────────────────────────
interface ProductoCfg {
  codigo: string;
  /** costo FC unitario (snapshot del ItemContenedor). */
  costoFC: string;
  /** unidades físicas en el DF (≥ cantidadDespacho). */
  cantidadFisica: number;
  /** unidades a despachar/nacionalizar en este despacho. */
  cantidadDespacho: number;
}
interface FacturaCfg {
  subtotal: string;
  tipoCambio: string;
}
interface CruzadoCfg {
  codigoBase: string;
  periodoCodigo: string;
  fecha: Date;
  embarqueTC: string;
  despachoTC: string;
  die: string;
  tasaEstadistica: string;
  arancelSim: string;
  iva?: string;
  ivaAdicional?: string;
  iibb?: string;
  ganancias?: string;
  productos: ProductoCfg[];
  facturas?: FacturaCfg[];
}

interface SeedResult {
  despachoId: string;
  depFiscalId: string;
  depDestinoId: string;
  productoIds: Map<string, string>;
}

describe("GOLDEN despacho cruzado — memoria + costo contable + asiento + stock", () => {
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
    process.env.CONTENEDOR_DESCONSOLIDACION_ENABLED = "true";
    await db.reset(RESET_TABLES);
  });

  async function seedCruzado(cfg: CruzadoCfg): Promise<SeedResult> {
    await db.prisma.periodoContable.create({
      data: {
        codigo: cfg.periodoCodigo,
        nombre: cfg.periodoCodigo,
        fechaInicio: new Date(`${cfg.periodoCodigo}-01T00:00:00.000Z`),
        fechaFin: new Date(`${cfg.periodoCodigo}-28T00:00:00.000Z`),
        estado: "ABIERTO",
      },
    });
    const provExt = await db.prisma.proveedor.create({
      data: { nombre: `Exterior ${cfg.codigoBase}` },
    });
    const depFiscal = await db.prisma.deposito.create({
      data: { nombre: `DF ${cfg.codigoBase}`, tipo: "ZONA_PRIMARIA" },
    });
    const depDestino = await db.prisma.deposito.create({
      data: { nombre: `Nacional ${cfg.codigoBase}`, tipo: "NACIONAL" },
    });
    const embarque = await db.prisma.embarque.create({
      data: {
        codigo: `EMB-${cfg.codigoBase}`,
        proveedorId: provExt.id,
        moneda: "USD",
        tipoCambio: cfg.embarqueTC,
        depositoDestinoId: depDestino.id,
      },
    });
    const contenedor = await db.prisma.contenedor.create({
      data: {
        embarqueId: embarque.id,
        numeroContenedor: `MSCU${cfg.codigoBase}`,
        estado: "DESCONSOLIDADO",
        depositoFiscalId: depFiscal.id,
      },
    });

    const productoIds = new Map<string, string>();
    const itemsDespacho: {
      itemEmbarqueId: number;
      contenedorId: string;
      itemContenedorId: number;
      cantidad: number;
    }[] = [];

    for (const p of cfg.productos) {
      const prod = await db.prisma.producto.create({
        data: { codigo: p.codigo, nombre: `Prod ${p.codigo}` },
      });
      productoIds.set(p.codigo, prod.id);
      const itemEmbarque = await db.prisma.itemEmbarque.create({
        data: {
          embarqueId: embarque.id,
          productoId: prod.id,
          cantidad: p.cantidadFisica,
          precioUnitarioFob: p.costoFC,
        },
      });
      const ic = await db.prisma.itemContenedor.create({
        data: {
          contenedorId: contenedor.id,
          itemEmbarqueId: itemEmbarque.id,
          productoId: prod.id,
          cantidadDeclarada: p.cantidadFisica,
          cantidadFisica: p.cantidadFisica,
          cantidadEnDespacho: p.cantidadDespacho,
          costoFCUnitario: p.costoFC,
        },
      });
      // Stock ya en el DF (lo ingresó la desconsolidación): costo FC en ARS.
      await db.prisma.stockPorDeposito.create({
        data: {
          productoId: prod.id,
          depositoId: depFiscal.id,
          cantidadFisica: p.cantidadFisica,
          costoPromedio: new Decimal(p.costoFC).times(cfg.embarqueTC).toFixed(2),
        },
      });
      itemsDespacho.push({
        itemEmbarqueId: itemEmbarque.id,
        contenedorId: contenedor.id,
        itemContenedorId: ic.id,
        cantidad: p.cantidadDespacho,
      });
    }

    const despacho = await db.prisma.despacho.create({
      data: {
        codigo: `${cfg.codigoBase}-D1`,
        embarqueId: embarque.id,
        fecha: cfg.fecha,
        estado: "BORRADOR",
        tipoCambio: cfg.despachoTC,
        die: cfg.die,
        tasaEstadistica: cfg.tasaEstadistica,
        arancelSim: cfg.arancelSim,
        iva: cfg.iva ?? "0",
        ivaAdicional: cfg.ivaAdicional ?? "0",
        iibb: cfg.iibb ?? "0",
        ganancias: cfg.ganancias ?? "0",
        items: { create: itemsDespacho },
      },
    });

    if (cfg.facturas?.length) {
      const cuentaProv = await db.prisma.cuentaContable.create({
        data: {
          codigo: `2.1.1.${cfg.codigoBase}`,
          nombre: `PROV DESPACHANTE ${cfg.codigoBase}`,
          tipo: "ANALITICA",
          categoria: "PASIVO",
          nivel: 4,
        },
      });
      const cuentaGasto = await db.prisma.cuentaContable.create({
        data: {
          codigo: `5.7.2.${cfg.codigoBase}`,
          nombre: `GASTO DESPACHO ${cfg.codigoBase}`,
          tipo: "ANALITICA",
          categoria: "EGRESO",
          nivel: 4,
        },
      });
      const provDesp = await db.prisma.proveedor.create({
        data: { nombre: `Despachante ${cfg.codigoBase}`, cuentaContableId: cuentaProv.id },
      });
      for (const [idx, f] of cfg.facturas.entries()) {
        await db.prisma.embarqueCosto.create({
          data: {
            embarqueId: embarque.id,
            proveedorId: provDesp.id,
            despachoId: despacho.id,
            moneda: "USD",
            tipoCambio: f.tipoCambio,
            momento: "DESPACHO",
            estado: "BORRADOR",
            facturaNumero: `F-${cfg.codigoBase}-${idx + 1}`,
            iva: "0",
            iibb: "0",
            otros: "0",
            lineas: {
              create: [
                {
                  tipo: "HONORARIOS_DESPACHANTE",
                  cuentaContableGastoId: cuentaGasto.id,
                  descripcion: "Honorarios despachante",
                  subtotal: f.subtotal,
                },
              ],
            },
          },
        });
      }
    }

    return {
      despachoId: despacho.id,
      depFiscalId: depFiscal.id,
      depDestinoId: depDestino.id,
      productoIds,
    };
  }

  // Extrae el asiento de forma determinista: líneas {codigo, debe, haber}
  // ordenadas por (codigo, debe, haber).
  async function extraerAsiento(asientoId: string) {
    const lineas = await db.prisma.lineaAsiento.findMany({
      where: { asientoId },
      include: { cuenta: { select: { codigo: true } } },
    });
    return lineas
      .map((l) => ({ codigo: l.cuenta.codigo, debe: l.debe, haber: l.haber }))
      .sort(
        (a, b) =>
          a.codigo.localeCompare(b.codigo) ||
          a.debe.comparedTo(b.debe) ||
          a.haber.comparedTo(b.haber),
      );
  }

  // Extrae la entrada de stock de forma determinista.
  async function extraerStock(despachoId: string) {
    const spd = await db.prisma.stockPorDeposito.findMany({
      include: {
        producto: { select: { codigo: true } },
        deposito: { select: { nombre: true, tipo: true } },
      },
    });
    const porDeposito = spd
      .map((s) => ({
        producto: s.producto.codigo,
        deposito: s.deposito.nombre,
        tipo: s.deposito.tipo,
        cantidadFisica: s.cantidadFisica,
        costoPromedio: s.costoPromedio,
      }))
      .sort((a, b) => a.producto.localeCompare(b.producto) || a.deposito.localeCompare(b.deposito));
    const productos = (
      await db.prisma.producto.findMany({
        select: { codigo: true, stockActual: true, costoPromedio: true },
      })
    )
      .map((p) => ({
        codigo: p.codigo,
        stockActual: p.stockActual,
        costoPromedio: p.costoPromedio,
      }))
      .sort((a, b) => a.codigo.localeCompare(b.codigo));
    const itemsDespacho = (
      await db.prisma.itemDespacho.findMany({
        where: { despachoId },
        orderBy: { id: "asc" },
        select: { cantidad: true, costoUnitario: true },
      })
    ).map((i) => ({ cantidad: i.cantidad, costoUnitario: i.costoUnitario }));
    return { porDeposito, productos, itemsDespacho };
  }

  // Corre el ciclo completo: memoria(BORRADOR) → contabilizar → memoria(CONT.)
  // + asiento + stock. Prueba las 3 anclas y devuelve los snapshots crudos.
  async function correr(seed: SeedResult) {
    const memoriaAntes = await obtenerMemoriaDespacho(seed.despachoId);
    if (memoriaAntes?.tipo !== "CRUZADO") throw new Error("se esperaba memoria CRUZADO");

    const res = await contabilizarDespachoAction(seed.despachoId);
    expect(res.ok).toBe(true);

    const memoriaDespues = await obtenerMemoriaDespacho(seed.despachoId);
    if (memoriaDespues?.tipo !== "CRUZADO") throw new Error("se esperaba memoria CRUZADO");
    // Ancla (1): la MEMORIA de rateio (salida del motor + TCs + base) es
    // byte-estable antes/después de contabilizar. El único campo que cambia es
    // `estado` (BORRADOR → CONTABILIZADO), que es metadato, no parte del cálculo.
    const sinEstado = (m: typeof memoriaAntes) => ({
      tipo: m.tipo,
      tipoCambioEmbarque: m.tipoCambioEmbarque,
      tipoCambioDespacho: m.tipoCambioDespacho,
      baseRateio: m.baseRateio,
      landed: m.landed,
    });
    expect(serializeGolden(sinEstado(memoriaDespues))).toEqual(
      serializeGolden(sinEstado(memoriaAntes)),
    );

    const despacho = await db.prisma.despacho.findUniqueOrThrow({
      where: { id: seed.despachoId },
    });
    const asiento = await extraerAsiento(despacho.asientoId!);
    const stock = await extraerStock(seed.despachoId);

    // Ancla (2): costo unitario landed == ItemDespacho.costoUnitario persistido.
    for (let i = 0; i < memoriaAntes.landed.porItem.length; i++) {
      const unitMem = memoriaAntes.landed.porItem[i].costoUnitarioLandedArs.toFixed(2);
      const unitDb = new Decimal(stock.itemsDespacho[i].costoUnitario.toString()).toFixed(2);
      expect(unitDb).toBe(unitMem);
    }
    // Ancla (3): landed.costoTotalArs == DEBE 1.1.7.01.
    const debe11701 = asiento.find((l) => l.codigo === "1.1.7.01")?.debe;
    expect(debe11701?.toFixed(2)).toBe(memoriaAntes.landed.costoTotalArs.toFixed(2));
    // Partida doble.
    const totalDebe = asiento.reduce((a, l) => a.plus(l.debe.toString()), new Decimal(0));
    const totalHaber = asiento.reduce((a, l) => a.plus(l.haber.toString()), new Decimal(0));
    expect(totalDebe.toFixed(2)).toBe(totalHaber.toFixed(2));

    return {
      memoria: serializeGolden(memoriaAntes),
      asiento: serializeGolden(asiento),
      stock: serializeGolden(stock),
    };
  }

  // ── Arquetipo A · CRUZADO total simple (caso verbatim DO_NOT_TOUCH 70/30) ──
  it("A · total simple 70/30 (DIE 20): A→84000, B→36000", async () => {
    const seed = await seedCruzado({
      codigoBase: "A",
      periodoCodigo: "2025-06",
      fecha: new Date("2025-06-15T12:00:00.000Z"),
      embarqueTC: "1000.000000",
      despachoTC: "1000.000000",
      die: "20.00",
      tasaEstadistica: "0",
      arancelSim: "0",
      productos: [
        { codigo: "SKU-A", costoFC: "70.0000", cantidadFisica: 1, cantidadDespacho: 1 },
        { codigo: "SKU-B", costoFC: "30.0000", cantidadFisica: 1, cantidadDespacho: 1 },
      ],
    });
    const snap = await correr(seed);

    expect(snap.memoria).toEqual({
      tipo: "CRUZADO",
      despachoId: seed.despachoId,
      codigo: "A-D1",
      estado: "BORRADOR",
      tipoCambioEmbarque: "1000",
      tipoCambioDespacho: "1000",
      baseRateio: "FOB",
      landed: {
        nacionalizadoArs: "100000",
        tributosCapitalizablesArs: "20000",
        facturasCapitalizablesArs: "0",
        capitalizablesArs: "20000",
        costoTotalArs: "120000",
        porItem: [
          {
            itemDespachoId: 1,
            productoId: seed.productoIds.get("SKU-A"),
            cantidad: 1,
            costoFcUnitarioArs: "70000",
            capitalizablesItemArs: "14000",
            costoTotalArs: "84000",
            costoUnitarioLandedArs: "84000",
          },
          {
            itemDespachoId: 2,
            productoId: seed.productoIds.get("SKU-B"),
            cantidad: 1,
            costoFcUnitarioArs: "30000",
            capitalizablesItemArs: "6000",
            costoTotalArs: "36000",
            costoUnitarioLandedArs: "36000",
          },
        ],
        costoUnitarioLandedPorItem: { "1": "84000", "2": "36000" },
      },
    });

    expect(snap.asiento).toEqual([
      { codigo: "1.1.7.01", debe: "120000", haber: "0" },
      { codigo: "1.1.7.03", debe: "0", haber: "100000" },
      { codigo: "2.1.3.4.01", debe: "0", haber: "20000" },
    ]);
    expect(snap.stock).toEqual({
      porDeposito: [
        {
          producto: "SKU-A",
          deposito: "DF A",
          tipo: "ZONA_PRIMARIA",
          cantidadFisica: 0,
          costoPromedio: "70000",
        },
        {
          producto: "SKU-A",
          deposito: "Nacional A",
          tipo: "NACIONAL",
          cantidadFisica: 1,
          costoPromedio: "84000",
        },
        {
          producto: "SKU-B",
          deposito: "DF A",
          tipo: "ZONA_PRIMARIA",
          cantidadFisica: 0,
          costoPromedio: "30000",
        },
        {
          producto: "SKU-B",
          deposito: "Nacional A",
          tipo: "NACIONAL",
          cantidadFisica: 1,
          costoPromedio: "36000",
        },
      ],
      productos: [
        { codigo: "SKU-A", stockActual: 1, costoPromedio: "84000" },
        { codigo: "SKU-B", stockActual: 1, costoPromedio: "36000" },
      ],
      itemsDespacho: [
        { cantidad: 1, costoUnitario: "84000" },
        { cantidad: 1, costoUnitario: "36000" },
      ],
    });
  });

  // ── Arquetipo B · CRUZADO parcial + factura DESPACHO ──────────────────────
  // 30 de 60 u.; DIE 100 / Tasa 10 / Arancel 20 ; factura 40 (TC 1000).
  it("B · parcial + factura DESPACHO (landed 18166.67)", async () => {
    const seed = await seedCruzado({
      codigoBase: "B",
      periodoCodigo: "2025-06",
      fecha: new Date("2025-06-15T12:00:00.000Z"),
      embarqueTC: "1000.000000",
      despachoTC: "1000.000000",
      die: "100.00",
      tasaEstadistica: "10.00",
      arancelSim: "20.00",
      iva: "5.00",
      ivaAdicional: "3.00",
      iibb: "1.00",
      ganancias: "2.00",
      productos: [
        { codigo: "SKU-B1", costoFC: "12.5000", cantidadFisica: 60, cantidadDespacho: 30 },
      ],
      facturas: [{ subtotal: "40.00", tipoCambio: "1000.000000" }],
    });
    const snap = await correr(seed);

    expect(snap.memoria).toEqual({
      tipo: "CRUZADO",
      despachoId: seed.despachoId,
      codigo: "B-D1",
      estado: "BORRADOR",
      tipoCambioEmbarque: "1000",
      tipoCambioDespacho: "1000",
      baseRateio: "FOB",
      landed: {
        nacionalizadoArs: "375000",
        tributosCapitalizablesArs: "130000",
        facturasCapitalizablesArs: "40000",
        capitalizablesArs: "170000",
        costoTotalArs: "545000",
        porItem: [
          {
            itemDespachoId: 1,
            productoId: seed.productoIds.get("SKU-B1"),
            cantidad: 30,
            costoFcUnitarioArs: "12500",
            capitalizablesItemArs: "170000",
            costoTotalArs: "545000",
            costoUnitarioLandedArs: "18166.6667",
          },
        ],
        costoUnitarioLandedPorItem: { "1": "18166.6667" },
      },
    });

    // Asiento: capitalizables al DEBE 1.1.7.01 (no a egreso); IVA/IVAad/IIBB/Gan
    // de aduana como crédito fiscal (DEBE 1.1.4.x) con su contrapartida por pagar.
    expect(snap.asiento).toEqual([
      { codigo: "1.1.4.1.03", debe: "5000", haber: "0" },
      { codigo: "1.1.4.1.04", debe: "3000", haber: "0" },
      { codigo: "1.1.4.2.01", debe: "1000", haber: "0" },
      { codigo: "1.1.4.3.01", debe: "2000", haber: "0" },
      { codigo: "1.1.7.01", debe: "545000", haber: "0" },
      { codigo: "1.1.7.03", debe: "0", haber: "375000" },
      { codigo: "2.1.1.B", debe: "0", haber: "40000" },
      { codigo: "2.1.3.2.01", debe: "0", haber: "1000" },
      { codigo: "2.1.3.4.01", debe: "0", haber: "100000" },
      { codigo: "2.1.3.4.02", debe: "0", haber: "10000" },
      { codigo: "2.1.3.4.03", debe: "0", haber: "20000" },
      { codigo: "2.1.3.4.04", debe: "0", haber: "8000" },
      { codigo: "2.1.3.4.05", debe: "0", haber: "2000" },
    ]);
    expect(snap.stock).toEqual({
      porDeposito: [
        {
          producto: "SKU-B1",
          deposito: "DF B",
          tipo: "ZONA_PRIMARIA",
          cantidadFisica: 30,
          costoPromedio: "12500",
        },
        {
          producto: "SKU-B1",
          deposito: "Nacional B",
          tipo: "NACIONAL",
          cantidadFisica: 30,
          costoPromedio: "18166.67",
        },
      ],
      productos: [{ codigo: "SKU-B1", stockActual: 30, costoPromedio: "18166.67" }],
      itemsDespacho: [{ cantidad: 30, costoUnitario: "18166.67" }],
    });
  });

  // ── Arquetipo C · CRUZADO TC decimal 1399.5 + 3 ítems (resíduo último) ────
  // Regresión piloto AR-251223036CN-D4.
  it("C · TC decimal 1399.5, 3 ítems, resíduo en el último", async () => {
    const seed = await seedCruzado({
      codigoBase: "C",
      periodoCodigo: "2025-12",
      fecha: new Date("2025-12-23T12:00:00.000Z"),
      embarqueTC: "1382.000000",
      despachoTC: "1399.500000",
      die: "1768.25",
      tasaEstadistica: "331.55",
      arancelSim: "10.00",
      productos: [
        { codigo: "SKU-C1", costoFC: "123.0709", cantidadFisica: 30, cantidadDespacho: 30 },
        { codigo: "SKU-C2", costoFC: "123.0709", cantidadFisica: 50, cantidadDespacho: 50 },
        { codigo: "SKU-C3", costoFC: "123.0709", cantidadFisica: 20, cantidadDespacho: 20 },
      ],
      facturas: [{ subtotal: "40.00", tipoCambio: "1399.500000" }],
    });
    const snap = await correr(seed);

    expect(snap.memoria).toEqual({
      tipo: "CRUZADO",
      despachoId: seed.despachoId,
      codigo: "C-D1",
      estado: "BORRADOR",
      tipoCambioEmbarque: "1382",
      tipoCambioDespacho: "1399.5",
      baseRateio: "FOB",
      landed: {
        nacionalizadoArs: "17008398",
        tributosCapitalizablesArs: "2952665.11",
        facturasCapitalizablesArs: "55980",
        capitalizablesArs: "3008645.11",
        costoTotalArs: "20017043.11",
        porItem: [
          {
            itemDespachoId: 1,
            productoId: seed.productoIds.get("SKU-C1"),
            cantidad: 30,
            costoFcUnitarioArs: "170083.98",
            capitalizablesItemArs: "902593.53",
            costoTotalArs: "6005112.93",
            costoUnitarioLandedArs: "200170.431",
          },
          {
            itemDespachoId: 2,
            productoId: seed.productoIds.get("SKU-C2"),
            cantidad: 50,
            costoFcUnitarioArs: "170083.98",
            capitalizablesItemArs: "1504322.56",
            costoTotalArs: "10008521.56",
            costoUnitarioLandedArs: "200170.4312",
          },
          {
            itemDespachoId: 3,
            productoId: seed.productoIds.get("SKU-C3"),
            cantidad: 20,
            costoFcUnitarioArs: "170083.98",
            capitalizablesItemArs: "601729.02",
            costoTotalArs: "4003408.62",
            costoUnitarioLandedArs: "200170.431",
          },
        ],
        costoUnitarioLandedPorItem: {
          "1": "200170.431",
          "2": "200170.4312",
          "3": "200170.431",
        },
      },
    });

    // Resíduo: cada tributo round2(×TCdsp) por separado (DIE 2474665.88,
    // Tasa 464004.23, Arancel 13995) — el asiento balancea al centavo.
    expect(snap.asiento).toEqual([
      { codigo: "1.1.7.01", debe: "20017043.11", haber: "0" },
      { codigo: "1.1.7.03", debe: "0", haber: "17008398" },
      { codigo: "2.1.1.C", debe: "0", haber: "55980" },
      { codigo: "2.1.3.4.01", debe: "0", haber: "2474665.88" },
      { codigo: "2.1.3.4.02", debe: "0", haber: "464004.23" },
      { codigo: "2.1.3.4.03", debe: "0", haber: "13995" },
    ]);
    expect(snap.stock).toEqual({
      porDeposito: [
        {
          producto: "SKU-C1",
          deposito: "DF C",
          tipo: "ZONA_PRIMARIA",
          cantidadFisica: 0,
          costoPromedio: "170083.98",
        },
        {
          producto: "SKU-C1",
          deposito: "Nacional C",
          tipo: "NACIONAL",
          cantidadFisica: 30,
          costoPromedio: "200170.43",
        },
        {
          producto: "SKU-C2",
          deposito: "DF C",
          tipo: "ZONA_PRIMARIA",
          cantidadFisica: 0,
          costoPromedio: "170083.98",
        },
        {
          producto: "SKU-C2",
          deposito: "Nacional C",
          tipo: "NACIONAL",
          cantidadFisica: 50,
          costoPromedio: "200170.43",
        },
        {
          producto: "SKU-C3",
          deposito: "DF C",
          tipo: "ZONA_PRIMARIA",
          cantidadFisica: 0,
          costoPromedio: "170083.98",
        },
        {
          producto: "SKU-C3",
          deposito: "Nacional C",
          tipo: "NACIONAL",
          cantidadFisica: 20,
          costoPromedio: "200170.43",
        },
      ],
      productos: [
        { codigo: "SKU-C1", stockActual: 30, costoPromedio: "200170.43" },
        { codigo: "SKU-C2", stockActual: 50, costoPromedio: "200170.43" },
        { codigo: "SKU-C3", stockActual: 20, costoPromedio: "200170.43" },
      ],
      itemsDespacho: [
        { cantidad: 30, costoUnitario: "200170.43" },
        { cantidad: 50, costoUnitario: "200170.43" },
        { cantidad: 20, costoUnitario: "200170.43" },
      ],
    });
  });

  // ── Arquetipo E · LEGACY (sin itemContenedor): no hay memoria de rateio ────
  it("E · despacho legacy → obtenerMemoriaDespacho devuelve tipo LEGACY", async () => {
    const provExt = await db.prisma.proveedor.create({ data: { nombre: "Exterior Legacy" } });
    const depDestino = await db.prisma.deposito.create({
      data: { nombre: "Nacional Legacy", tipo: "NACIONAL" },
    });
    const prod = await db.prisma.producto.create({ data: { codigo: "SKU-LEG", nombre: "Legacy" } });
    const embarque = await db.prisma.embarque.create({
      data: {
        codigo: "EMB-LEG",
        proveedorId: provExt.id,
        moneda: "USD",
        tipoCambio: "1000.000000",
        depositoDestinoId: depDestino.id,
      },
    });
    const itemEmbarque = await db.prisma.itemEmbarque.create({
      data: {
        embarqueId: embarque.id,
        productoId: prod.id,
        cantidad: 10,
        precioUnitarioFob: "5.00",
      },
    });
    const despacho = await db.prisma.despacho.create({
      data: {
        codigo: "EMB-LEG-D1",
        embarqueId: embarque.id,
        fecha: new Date("2025-06-15T12:00:00.000Z"),
        estado: "BORRADOR",
        tipoCambio: "1000.000000",
        die: "0",
        tasaEstadistica: "0",
        arancelSim: "0",
        // Línea legacy: itemEmbarque, SIN itemContenedor.
        items: {
          create: [{ itemEmbarqueId: itemEmbarque.id, cantidad: 10, costoUnitario: "5000.00" }],
        },
      },
    });

    const memoria = await obtenerMemoriaDespacho(despacho.id);
    expect(memoria).toEqual({
      tipo: "LEGACY",
      despachoId: despacho.id,
      codigo: "EMB-LEG-D1",
      estado: "BORRADOR",
    });
  });

  // ── Fallback FOB=0 (muestras) → rateio por CANTIDAD (motor, read-only) ─────
  it("F · base FOB 0 (muestras) → prorrateo por cantidad (DIE 100, TC 1000)", async () => {
    // Pure-function: cubre la rama de fallback sin un e2e con nacionalizado 0.
    const r = calcularCostoLandedDespacho({
      tipoCambioEmbarque: "1000",
      tipoCambioDespacho: "1000",
      die: "100.00",
      tasaEstadistica: "0",
      arancelSim: "0",
      facturasDespacho: [],
      items: [
        { itemDespachoId: 1, productoId: "m1", cantidad: 3, costoFCUnitario: "0" },
        { itemDespachoId: 2, productoId: "m2", cantidad: 1, costoFCUnitario: "0" },
      ],
    });
    // capitalizables 100000; prorrateo por cantidad 3:1 → 75000 / 25000 (resíduo
    // en el último). Unitarios: 75000/3 = 25000 ; 25000/1 = 25000.
    expect(serializeGolden(r)).toEqual({
      nacionalizadoArs: "0",
      tributosCapitalizablesArs: "100000",
      facturasCapitalizablesArs: "0",
      capitalizablesArs: "100000",
      costoTotalArs: "100000",
      porItem: [
        {
          itemDespachoId: 1,
          productoId: "m1",
          cantidad: 3,
          costoFcUnitarioArs: "0",
          capitalizablesItemArs: "75000",
          costoTotalArs: "75000",
          costoUnitarioLandedArs: "25000",
        },
        {
          itemDespachoId: 2,
          productoId: "m2",
          cantidad: 1,
          costoFcUnitarioArs: "0",
          capitalizablesItemArs: "25000",
          costoTotalArs: "25000",
          costoUnitarioLandedArs: "25000",
        },
      ],
      costoUnitarioLandedPorItem: { "1": "25000", "2": "25000" },
    });
  });
});
