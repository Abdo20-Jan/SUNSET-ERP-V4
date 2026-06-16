import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// Cobertura del flujo VEP/Despacho cruzado (Modelo Y):
//   1) listarVepDespachosPendientes() devuelve los VEP en estado GENERADO
//      tras contabilizar un despacho parcial.
//   2) pagarVepDespachoAction(...) cancela los pasivos tributarios, marca
//      el VEP como PAGADO y crea el MovimientoTesoreria + Asiento.

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
import { listarVepDespachosPendientes, pagarVepDespachoAction } from "@/lib/actions/vep-despacho";

const FECHA = new Date("2025-06-15T12:00:00.000Z");
const FECHA_PAGO = new Date("2025-06-20T12:00:00.000Z");

describe("VEP / Despacho cruzado — lista + pago", () => {
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
    await db.reset([
      "MovimientoTesoreria",
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
      "CuentaBancaria",
      "Deposito",
      "Producto",
      "Proveedor",
      "PeriodoContable",
      "CuentaContable",
    ]);
  });

  interface Seed {
    despachoId: string;
    cuentaBancariaId: string;
    /** Monto total ARS esperado para el VEP del despacho. */
    montoEsperado: string;
  }

  /**
   * Despacho con DIE=100, Tasa=10, Arancel=20, IVA=5, IVAad=3, IIBB=1, Gan=2.
   * TC despacho = 1000. Suma tributos en ARS = 141 × 1000 = 141.000,00.
   */
  async function seed(): Promise<Seed> {
    await db.prisma.periodoContable.create({
      data: {
        codigo: "2025-06",
        nombre: "Junio 2025",
        fechaInicio: new Date("2025-06-01T00:00:00.000Z"),
        fechaFin: new Date("2025-06-30T00:00:00.000Z"),
        estado: "ABIERTO",
      },
    });
    const cuentaBanco = await db.prisma.cuentaContable.create({
      data: {
        codigo: "1.1.2.99",
        nombre: "BANCO TEST ARS",
        tipo: "ANALITICA",
        categoria: "ACTIVO",
        nivel: 4,
      },
    });
    const cuentaBancaria = await db.prisma.cuentaBancaria.create({
      data: {
        banco: "Banco Test",
        tipo: "CUENTA_CORRIENTE",
        moneda: "ARS",
        numero: "0001-0001",
        cuentaContableId: cuentaBanco.id,
      },
    });
    const provExt = await db.prisma.proveedor.create({ data: { nombre: "Exterior SA" } });
    const prod = await db.prisma.producto.create({
      data: { codigo: "SKU-VEP", nombre: "Neumático VEP" },
    });
    const depFiscal = await db.prisma.deposito.create({
      data: { nombre: "DF Aduana VEP", tipo: "ZONA_PRIMARIA" },
    });
    const depDestino = await db.prisma.deposito.create({
      data: { nombre: "Nacional VEP", tipo: "NACIONAL" },
    });
    const embarque = await db.prisma.embarque.create({
      data: {
        codigo: "EMB-VEP",
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
        cantidad: 100,
        precioUnitarioFob: "10.00",
      },
    });
    const contenedor = await db.prisma.contenedor.create({
      data: {
        embarqueId: embarque.id,
        numeroContenedor: "MSCU0VEP0001",
        estado: "DESCONSOLIDADO",
        depositoFiscalId: depFiscal.id,
      },
    });
    const ic = await db.prisma.itemContenedor.create({
      data: {
        contenedorId: contenedor.id,
        itemEmbarqueId: itemEmbarque.id,
        productoId: prod.id,
        cantidadDeclarada: 60,
        cantidadFisica: 60,
        cantidadEnDespacho: 30,
        costoFCUnitario: "12.5000",
      },
    });
    await db.prisma.stockPorDeposito.create({
      data: {
        productoId: prod.id,
        depositoId: depFiscal.id,
        cantidadFisica: 60,
        costoPromedio: "12500.00",
      },
    });
    const despacho = await db.prisma.despacho.create({
      data: {
        codigo: "EMB-VEP-D1",
        embarqueId: embarque.id,
        fecha: FECHA,
        estado: "BORRADOR",
        tipoCambio: "1000.000000",
        die: "100.00",
        tasaEstadistica: "10.00",
        arancelSim: "20.00",
        iva: "5.00",
        ivaAdicional: "3.00",
        iibb: "1.00",
        ganancias: "2.00",
        items: {
          create: [
            {
              itemEmbarqueId: itemEmbarque.id,
              contenedorId: contenedor.id,
              itemContenedorId: ic.id,
              cantidad: 30,
            },
          ],
        },
      },
    });
    return {
      despachoId: despacho.id,
      cuentaBancariaId: cuentaBancaria.id,
      montoEsperado: "141000.00",
    };
  }

  it("listarVepDespachosPendientes() devuelve el VEP GENERADO tras contabilizar el despacho", async () => {
    const s = await seed();
    const cont = await contabilizarDespachoAction(s.despachoId);
    expect(cont.ok).toBe(true);

    const pendientes = await listarVepDespachosPendientes();
    expect(pendientes).toHaveLength(1);
    const vep = pendientes[0];
    expect(vep.despachoId).toBe(s.despachoId);
    expect(vep.despachoCodigo).toBe("EMB-VEP-D1");
    expect(vep.embarqueCodigo).toBe("EMB-VEP");
    expect(vep.proveedorNombre).toBe("Exterior SA");
    expect(vep.estado).toBe("GENERADO");
    expect(Number(vep.montoTotal)).toBeCloseTo(141000, 2);
  });

  it("pagarVepDespachoAction marca PAGADO + crea asiento + MovimientoTesoreria", async () => {
    const s = await seed();
    const cont = await contabilizarDespachoAction(s.despachoId);
    expect(cont.ok).toBe(true);

    const res = await pagarVepDespachoAction({
      despachoId: s.despachoId,
      cuentaBancariaId: s.cuentaBancariaId,
      fecha: FECHA_PAGO,
      numeroVep: "001556692219",
      comprobante: "OP-123",
      referenciaBanco: "REF-XYZ",
    });

    if (!res.ok) throw new Error(`pago falló: ${res.error}`);
    expect(res.ok).toBe(true);
    expect(res.asientoNumero).toBeGreaterThan(0);
    expect(Number(res.montoPagado)).toBeCloseTo(141000, 2);

    // VEP queda PAGADO con sus datos persistidos.
    const vep = await db.prisma.vepDespacho.findUniqueOrThrow({
      where: { despachoId: s.despachoId },
    });
    expect(vep.estado).toBe("PAGADO");
    expect(vep.numero).toBe("001556692219");
    expect(vep.movimientoTesoreriaId).not.toBeNull();
    expect(Number(vep.montoTotal)).toBeCloseTo(141000, 2);

    // MovimientoTesoreria creado por el monto pagado.
    const mov = await db.prisma.movimientoTesoreria.findUniqueOrThrow({
      where: { id: vep.movimientoTesoreriaId! },
    });
    expect(mov.tipo).toBe("PAGO");
    expect(mov.cuentaBancariaId).toBe(s.cuentaBancariaId);
    expect(Number(mov.monto)).toBeCloseTo(141000, 2);
    expect(mov.comprobante).toBe("OP-123");
    expect(mov.referenciaBanco).toBe("REF-XYZ");
    expect(mov.asientoId).not.toBeNull();

    // El VEP ya no aparece como pendiente.
    const pendientesPost = await listarVepDespachosPendientes();
    expect(pendientesPost).toHaveLength(0);
  });

  it("pagarVepDespachoAction es idempotente: VEP ya PAGADO falla con mensaje claro", async () => {
    const s = await seed();
    await contabilizarDespachoAction(s.despachoId);
    const first = await pagarVepDespachoAction({
      despachoId: s.despachoId,
      cuentaBancariaId: s.cuentaBancariaId,
      fecha: FECHA_PAGO,
    });
    expect(first.ok).toBe(true);

    const second = await pagarVepDespachoAction({
      despachoId: s.despachoId,
      cuentaBancariaId: s.cuentaBancariaId,
      fecha: FECHA_PAGO,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error).toMatch(/ya está pagado/i);
    }
  });

  // ============================================================
  // Paridad con `pagarVepEmbarqueAction`: monto editable + crédito
  // ============================================================

  /**
   * Crea un saldo deudor en 1.1.4.13 (CRÉDITO A FAVOR ADUANA) para
   * los escenarios que aplican crédito. Se contabiliza un asiento
   * manual: DEBE 1.1.4.13 / HABER BANCO TEST ARS por el monto pedido.
   *
   * Mantiene el asiento balanceado y deja saldo disponible para
   * `getSaldoCreditoAduana()`.
   */
  async function seedCreditoAFavor(saldo: number): Promise<void> {
    const cuentaCredito = await db.prisma.cuentaContable.create({
      data: {
        codigo: "1.1.5.4.01",
        nombre: "CRÉDITO A FAVOR ADUANA (DIFERENCIA CAMBIARIA)",
        tipo: "ANALITICA",
        categoria: "ACTIVO",
        nivel: 4,
      },
    });
    const cuentaBanco = await db.prisma.cuentaContable.findUniqueOrThrow({
      where: { codigo: "1.1.2.99" },
    });
    const periodo = await db.prisma.periodoContable.findUniqueOrThrow({
      where: { codigo: "2025-06" },
    });
    const asiento = await db.prisma.asiento.create({
      data: {
        fecha: new Date("2025-06-10T12:00:00.000Z"),
        descripcion: "Seed crédito a favor Aduana",
        origen: "TESORERIA",
        moneda: "ARS",
        tipoCambio: "1",
        estado: "CONTABILIZADO",
        numero: 9000,
        totalDebe: saldo.toFixed(2),
        totalHaber: saldo.toFixed(2),
        periodoId: periodo.id,
        lineas: {
          create: [
            { cuentaId: cuentaCredito.id, debe: saldo.toFixed(2), haber: "0" },
            { cuentaId: cuentaBanco.id, debe: "0", haber: saldo.toFixed(2) },
          ],
        },
      },
    });
    void asiento;
  }

  /**
   * Comprueba que el asiento generado por `pagarVepDespachoAction`
   * está balanceado al centavo: Σdebe === Σhaber.
   */
  async function expectAsientoBalanceado(asientoId: string): Promise<void> {
    const lineas = await db.prisma.lineaAsiento.findMany({
      where: { asientoId },
      select: { debe: true, haber: true },
    });
    let totalDebe = 0;
    let totalHaber = 0;
    for (const l of lineas) {
      totalDebe += Number(l.debe);
      totalHaber += Number(l.haber);
    }
    expect(Math.abs(totalDebe - totalHaber)).toBeLessThan(0.005);
  }

  /** Busca el saldo HABER (pasivo) de una cuenta por código. */
  async function saldoHaberPorCodigo(codigo: string): Promise<number> {
    const cuenta = await db.prisma.cuentaContable.findFirst({ where: { codigo } });
    if (!cuenta) return 0;
    const agg = await db.prisma.lineaAsiento.aggregate({
      where: { cuentaId: cuenta.id, asiento: { estado: "CONTABILIZADO" } },
      _sum: { debe: true, haber: true },
    });
    return Number(agg._sum.haber ?? 0) - Number(agg._sum.debe ?? 0);
  }

  /** Busca el saldo DEBE (activo) de una cuenta por código. */
  async function saldoDebePorCodigo(codigo: string): Promise<number> {
    const cuenta = await db.prisma.cuentaContable.findFirst({ where: { codigo } });
    if (!cuenta) return 0;
    const agg = await db.prisma.lineaAsiento.aggregate({
      where: { cuentaId: cuenta.id, asiento: { estado: "CONTABILIZADO" } },
      _sum: { debe: true, haber: true },
    });
    return Number(agg._sum.debe ?? 0) - Number(agg._sum.haber ?? 0);
  }

  it("pago exacto con montoPagado explícito: sin líneas en 1.1.4.13 ni 2.1.5.99", async () => {
    const s = await seed();
    await contabilizarDespachoAction(s.despachoId);

    const res = await pagarVepDespachoAction({
      despachoId: s.despachoId,
      cuentaBancariaId: s.cuentaBancariaId,
      fecha: FECHA_PAGO,
      montoPagado: "141000.00",
    });
    if (!res.ok) throw new Error(`pago falló: ${res.error}`);
    expect(res.tipoDiferencia).toBe("exacto");
    expect(Number(res.diferencia)).toBeCloseTo(0, 2);

    // No deben existir líneas en 1.1.4.13 ni 2.1.5.99.
    const creditoSaldo = await saldoDebePorCodigo("1.1.5.4.01");
    const deudaSaldo = await saldoHaberPorCodigo("2.1.5.99");
    expect(creditoSaldo).toBeCloseTo(0, 2);
    expect(deudaSaldo).toBeCloseTo(0, 2);

    await expectAsientoBalanceado(res.asientoId);
  });

  it("pago con diferencia a MAYOR: genera DEBE en 1.1.4.13 = |diferencia|", async () => {
    const s = await seed();
    await contabilizarDespachoAction(s.despachoId);

    // Pago 141.500 (500 de más): genera crédito a favor 500.
    const res = await pagarVepDespachoAction({
      despachoId: s.despachoId,
      cuentaBancariaId: s.cuentaBancariaId,
      fecha: FECHA_PAGO,
      montoPagado: "141500.00",
    });
    if (!res.ok) throw new Error(`pago falló: ${res.error}`);
    expect(res.tipoDiferencia).toBe("credito");
    expect(Number(res.diferencia)).toBeCloseTo(500, 2);

    // 1.1.4.13 con saldo DEBE = 500 (nuevo crédito a favor).
    const creditoSaldo = await saldoDebePorCodigo("1.1.5.4.01");
    expect(creditoSaldo).toBeCloseTo(500, 2);

    // Sin saldo en 2.1.5.99.
    const deudaSaldo = await saldoHaberPorCodigo("2.1.5.99");
    expect(deudaSaldo).toBeCloseTo(0, 2);

    // Movimiento tesorería por el monto al banco (141.500).
    const vep = await db.prisma.vepDespacho.findUniqueOrThrow({
      where: { despachoId: s.despachoId },
    });
    const mov = await db.prisma.movimientoTesoreria.findUniqueOrThrow({
      where: { id: vep.movimientoTesoreriaId! },
    });
    expect(Number(mov.monto)).toBeCloseTo(141500, 2);

    await expectAsientoBalanceado(res.asientoId);
  });

  it("pago con diferencia a MENOR: genera HABER en 2.1.5.99 = |diferencia|", async () => {
    const s = await seed();
    await contabilizarDespachoAction(s.despachoId);

    // Pago 140.000 (1.000 de menos): genera saldo pendiente Aduana 1.000.
    const res = await pagarVepDespachoAction({
      despachoId: s.despachoId,
      cuentaBancariaId: s.cuentaBancariaId,
      fecha: FECHA_PAGO,
      montoPagado: "140000.00",
    });
    if (!res.ok) throw new Error(`pago falló: ${res.error}`);
    expect(res.tipoDiferencia).toBe("deuda");
    expect(Number(res.diferencia)).toBeCloseTo(1000, 2);

    // 2.1.5.99 con saldo HABER = 1.000.
    const deudaSaldo = await saldoHaberPorCodigo("2.1.5.99");
    expect(deudaSaldo).toBeCloseTo(1000, 2);

    // Sin saldo en 1.1.4.13.
    const creditoSaldo = await saldoDebePorCodigo("1.1.5.4.01");
    expect(creditoSaldo).toBeCloseTo(0, 2);

    // Movimiento tesorería por el monto al banco (140.000).
    const vep = await db.prisma.vepDespacho.findUniqueOrThrow({
      where: { despachoId: s.despachoId },
    });
    const mov = await db.prisma.movimientoTesoreria.findUniqueOrThrow({
      where: { id: vep.movimientoTesoreriaId! },
    });
    expect(Number(mov.monto)).toBeCloseTo(140000, 2);

    await expectAsientoBalanceado(res.asientoId);
  });

  it("crédito aplicado parcialmente: HABER 1.1.4.13 = creditoAplicado, banco = total − crédito", async () => {
    const s = await seed();
    await contabilizarDespachoAction(s.despachoId);
    await seedCreditoAFavor(50000); // saldo previo en 1.1.4.13.

    // Aplicar 20.000 de crédito + 121.000 al banco = 141.000 (exacto).
    const res = await pagarVepDespachoAction({
      despachoId: s.despachoId,
      cuentaBancariaId: s.cuentaBancariaId,
      fecha: FECHA_PAGO,
      montoPagado: "121000.00",
      creditoAplicado: "20000.00",
    });
    if (!res.ok) throw new Error(`pago falló: ${res.error}`);
    expect(res.tipoDiferencia).toBe("exacto");
    expect(Number(res.creditoAplicado)).toBeCloseTo(20000, 2);

    // Saldo 1.1.4.13: 50.000 (seed) − 20.000 (consumido) = 30.000.
    const creditoSaldo = await saldoDebePorCodigo("1.1.5.4.01");
    expect(creditoSaldo).toBeCloseTo(30000, 2);

    // Movimiento tesorería SOLO por monto bancario (121.000).
    const vep = await db.prisma.vepDespacho.findUniqueOrThrow({
      where: { despachoId: s.despachoId },
    });
    const mov = await db.prisma.movimientoTesoreria.findUniqueOrThrow({
      where: { id: vep.movimientoTesoreriaId! },
    });
    expect(Number(mov.monto)).toBeCloseTo(121000, 2);

    await expectAsientoBalanceado(res.asientoId);
  });

  it("crédito aplicado excede saldo: action retorna ok:false con mensaje claro", async () => {
    const s = await seed();
    await contabilizarDespachoAction(s.despachoId);
    await seedCreditoAFavor(5000); // saldo previo = 5.000.

    // Intentar aplicar 10.000 (mayor al saldo disponible).
    const res = await pagarVepDespachoAction({
      despachoId: s.despachoId,
      cuentaBancariaId: s.cuentaBancariaId,
      fecha: FECHA_PAGO,
      montoPagado: "131000.00",
      creditoAplicado: "10000.00",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/excede.*saldo/i);
    }

    // VEP sigue pendiente.
    const vep = await db.prisma.vepDespacho.findUniqueOrThrow({
      where: { despachoId: s.despachoId },
    });
    expect(vep.estado).toBe("GENERADO");
  });

  it("crédito aplicado + diferencia a mayor: neto en 1.1.4.13 = creditoAplicado − sobrante", async () => {
    const s = await seed();
    await contabilizarDespachoAction(s.despachoId);
    await seedCreditoAFavor(50000); // saldo previo = 50.000.

    // Aplicar 30.000 de crédito + 120.000 al banco = 150.000 (9.000 de más
    // sobre total 141.000). Lógica unificada del legacy:
    //   sobranteCredito = 9.000 (diferencia a favor)
    //   netoCredito = 30.000 − 9.000 = 21.000  → HABER 1.1.4.13 = 21.000
    // Saldo final 1.1.4.13: 50.000 − 21.000 = 29.000.
    const res = await pagarVepDespachoAction({
      despachoId: s.despachoId,
      cuentaBancariaId: s.cuentaBancariaId,
      fecha: FECHA_PAGO,
      montoPagado: "120000.00",
      creditoAplicado: "30000.00",
    });
    if (!res.ok) throw new Error(`pago falló: ${res.error}`);
    expect(res.tipoDiferencia).toBe("credito");
    expect(Number(res.diferencia)).toBeCloseTo(9000, 2);
    expect(Number(res.creditoAplicado)).toBeCloseTo(30000, 2);

    const creditoSaldo = await saldoDebePorCodigo("1.1.5.4.01");
    expect(creditoSaldo).toBeCloseTo(29000, 2);

    // 2.1.5.99 sin saldo.
    const deudaSaldo = await saldoHaberPorCodigo("2.1.5.99");
    expect(deudaSaldo).toBeCloseTo(0, 2);

    await expectAsientoBalanceado(res.asientoId);
  });

  it("asiento siempre balanceado: pago exacto con crédito 100% (sin movimiento bancario)", async () => {
    const s = await seed();
    await contabilizarDespachoAction(s.despachoId);
    await seedCreditoAFavor(200000); // saldo previo amplio.

    // Pago 100% con crédito — sin cuenta bancaria.
    const res = await pagarVepDespachoAction({
      despachoId: s.despachoId,
      fecha: FECHA_PAGO,
      montoPagado: "0.00",
      creditoAplicado: "141000.00",
    });
    if (!res.ok) throw new Error(`pago falló: ${res.error}`);
    expect(res.tipoDiferencia).toBe("exacto");
    expect(Number(res.montoPagado)).toBeCloseTo(0, 2);
    expect(Number(res.creditoAplicado)).toBeCloseTo(141000, 2);

    // No se crea MovimientoTesoreria (pago 100% con crédito).
    const vep = await db.prisma.vepDespacho.findUniqueOrThrow({
      where: { despachoId: s.despachoId },
    });
    expect(vep.movimientoTesoreriaId).toBeNull();
    expect(vep.estado).toBe("PAGADO");

    // 1.1.4.13: 200.000 − 141.000 = 59.000.
    const creditoSaldo = await saldoDebePorCodigo("1.1.5.4.01");
    expect(creditoSaldo).toBeCloseTo(59000, 2);

    await expectAsientoBalanceado(res.asientoId);
  });
});
