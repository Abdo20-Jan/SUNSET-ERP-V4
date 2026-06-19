import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// Onda A #6 — guard de reversión de zona primaria (Modelo Y). En el arribo
// comex, confirmar zona primaria DEBITA 1.1.7.04 sin mover stock; el primer
// ingreso de stock (y el traslado 1.1.7.04 → 1.1.7.03) ocurre en la
// desconsolidación. Si después de desconsolidar se permite revertir el arribo,
// la anulación del asiento de arribo borra el DÉBITO 1.1.7.04 pero deja el
// traslado (HABER 1.1.7.04 / DEBE 1.1.7.03) y el stock del DF huérfanos →
// 1.1.7.04 queda en saldo ACREEDOR (negativo). El guard bloquea esa reversión
// mientras exista una desconsolidación viva en algún contenedor del embarque.

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

import { confirmarZonaPrimariaAction, revertirZonaPrimariaAction } from "@/lib/actions/embarques";
import { desconsolidar } from "@/lib/services/desconsolidacion";

const FECHA_ISO = "2026-05-21T12:00:00.000Z";
const FECHA_DESC = new Date("2026-05-22T12:00:00.000Z");

describe("revertir zona primaria — guard de desconsolidación (Onda A #6)", () => {
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
      "Desconsolidacion",
      "MovimientoStock",
      "StockPorDeposito",
      "LineaAsiento",
      "Asiento",
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
        codigo: "2026-05",
        nombre: "Mayo 2026",
        fechaInicio: new Date("2026-05-01T00:00:00.000Z"),
        fechaFin: new Date("2026-05-31T23:59:59.999Z"),
        estado: "ABIERTO",
      },
    });
  });

  /**
   * Saldo neto (Σ debe − Σ haber) de una cuenta por código, contando sólo
   * asientos vivos (excluye ANULADO) — igual que el balance real: anular un
   * asiento no crea contrapartida, sólo lo marca ANULADO y lo saca del saldo.
   */
  async function netoCuenta(codigo: string): Promise<number> {
    const lineas = await db.prisma.lineaAsiento.findMany({
      where: { cuenta: { codigo }, asiento: { estado: { not: "ANULADO" } } },
      select: { debe: true, haber: true },
    });
    return lineas.reduce((acc, l) => acc + Number(l.debe) - Number(l.haber), 0);
  }

  // Modelo Y: FOB 1000 USD @ TC 1000 → base 1.000.000 ARS en 1.1.7.04. Un único
  // contenedor con FC cerrado, listo para arribar y luego desconsolidar.
  async function seedModeloY() {
    const prov = await db.prisma.proveedor.create({ data: { nombre: "Exterior SA" } });
    const prod = await db.prisma.producto.create({ data: { codigo: "A-1", nombre: "Prod A" } });
    const depFiscal = await db.prisma.deposito.create({
      data: { nombre: "DF BsAs", tipo: "ZONA_PRIMARIA", subtipo: "DEPOSITO_FISCAL" },
    });
    const embarque = await db.prisma.embarque.create({
      data: {
        codigo: "EMB-Y",
        proveedorId: prov.id,
        moneda: "USD",
        tipoCambio: "1000.000000",
        fobTotal: "1000.00",
      },
    });
    const ie = await db.prisma.itemEmbarque.create({
      data: {
        embarqueId: embarque.id,
        productoId: prod.id,
        cantidad: 100,
        precioUnitarioFob: "10.00",
      },
    });
    const cont = await db.prisma.contenedor.create({
      data: { embarqueId: embarque.id, numeroContenedor: "MSCU-1", estado: "EN_TRANSITO" },
    });
    const ic = await db.prisma.itemContenedor.create({
      data: {
        contenedorId: cont.id,
        itemEmbarqueId: ie.id,
        productoId: prod.id,
        cantidadDeclarada: 100,
        costoFCUnitario: "10.0000",
      },
    });
    return {
      embarqueId: embarque.id,
      contenedorId: cont.id,
      itemContenedorId: ic.id,
      depFiscalId: depFiscal.id,
    };
  }

  it("tras desconsolidar un contenedor, revertir zona primaria es rechazado (no orfaniza 1.1.7.04)", async () => {
    const s = await seedModeloY();

    // 1) Arribo real (Modelo Y): DEBE 1.1.7.04 = 1.000.000, sin stock.
    const arribo = await confirmarZonaPrimariaAction(s.embarqueId, FECHA_ISO);
    expect(arribo.ok).toBe(true);
    expect(await netoCuenta("1.1.7.04")).toBeCloseTo(1_000_000, 2);

    // 2) Avanzar el contenedor a EN_DEPOSITO_FISCAL y desconsolidar de verdad:
    //    traslado 1.1.7.04 → 1.1.7.03 + stock al DF + registro Desconsolidacion.
    await db.prisma.contenedor.update({
      where: { id: s.contenedorId },
      data: { estado: "EN_DEPOSITO_FISCAL", depositoFiscalId: s.depFiscalId },
    });
    const desc = await desconsolidar(
      { contenedorId: s.contenedorId, fecha: FECHA_DESC },
      db.prisma,
    );
    expect(desc.divergencia).toBe(false);
    expect(desc.asiento).not.toBeNull();
    // Post-desconsolidación coherente: 1.1.7.04 neto 0 (debitó arribo, acreditó
    // traslado) y 1.1.7.03 = 1.000.000.
    expect(await netoCuenta("1.1.7.04")).toBeCloseTo(0, 2);
    expect(await netoCuenta("1.1.7.03")).toBeCloseTo(1_000_000, 2);

    // 3) Revertir zona primaria DEBE ser rechazado.
    const revert = await revertirZonaPrimariaAction(s.embarqueId);
    expect(revert.ok).toBe(false);
    if (!revert.ok) expect(revert.error).toMatch(/desconsolida/i);

    // 4) Nada cambió (transacción revertida): el arribo sigue contabilizado, el
    //    embarque conserva su asiento ZP y 1.1.7.04 NO quedó negativo.
    const embarque = await db.prisma.embarque.findUniqueOrThrow({ where: { id: s.embarqueId } });
    expect(embarque.asientoZonaPrimariaId).not.toBeNull();
    const arriboAsiento = await db.prisma.asiento.findUniqueOrThrow({
      where: { id: embarque.asientoZonaPrimariaId! },
    });
    expect(arriboAsiento.estado).toBe("CONTABILIZADO");
    expect(await netoCuenta("1.1.7.04")).toBeCloseTo(0, 2);
    expect(await netoCuenta("1.1.7.03")).toBeCloseTo(1_000_000, 2);
  });

  it("sin desconsolidación, revertir zona primaria sigue funcionando (control)", async () => {
    const s = await seedModeloY();
    const arribo = await confirmarZonaPrimariaAction(s.embarqueId, FECHA_ISO);
    expect(arribo.ok).toBe(true);
    expect(await netoCuenta("1.1.7.04")).toBeCloseTo(1_000_000, 2);

    const revert = await revertirZonaPrimariaAction(s.embarqueId);
    expect(revert.ok).toBe(true);

    const embarque = await db.prisma.embarque.findUniqueOrThrow({ where: { id: s.embarqueId } });
    expect(embarque.asientoZonaPrimariaId).toBeNull();
    expect(embarque.estado).toBe("EN_PUERTO");
    // El arribo fue anulado → 1.1.7.04 neteado a cero.
    expect(await netoCuenta("1.1.7.04")).toBeCloseTo(0, 2);
  });
});
