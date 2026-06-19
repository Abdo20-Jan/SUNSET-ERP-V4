import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// Saldos por proveedor (aging) — saldo USD nativo (monedaOrigen=USD,
// invariante a TC) + montoNativo por factura. Verifica que el agregado
// multimoneda no usa ÷tc ciego: la parte USD-nata se expone como saldoTotalUsd
// y cada factura lleva su pendiente nativo (revertido por el TC de emisión).

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

import { getSaldosPorProveedorConAging } from "@/lib/services/cuentas-a-pagar";

const FECHA = new Date("2025-06-15T12:00:00.000Z");
const VENC = new Date("2025-07-15T12:00:00.000Z");
const TC = "1200.000000";

describe("saldos por proveedor — saldo USD nativo + montoNativo", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    h.setClient(db.prisma);
  });

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    await db.reset([
      "AplicacionPagoCompra",
      "LineaAsiento",
      "Asiento",
      "ItemCompra",
      "Compra",
      "Proveedor",
      "PeriodoContable",
      "CuentaContable",
    ]);
  });

  async function seedBase() {
    const periodo = await db.prisma.periodoContable.create({
      data: {
        codigo: "2025-06",
        nombre: "Junio 2025",
        fechaInicio: new Date("2025-06-01T00:00:00.000Z"),
        fechaFin: new Date("2025-06-30T00:00:00.000Z"),
        estado: "ABIERTO",
      },
    });
    const cuentaProv = await db.prisma.cuentaContable.create({
      data: {
        codigo: "2.1.1.01",
        nombre: "PROVEEDOR",
        tipo: "ANALITICA",
        categoria: "PASIVO",
        nivel: 4,
      },
    });
    const cuentaMerc = await db.prisma.cuentaContable.create({
      data: {
        codigo: "1.1.7.01",
        nombre: "MERCADERIA",
        tipo: "ANALITICA",
        categoria: "ACTIVO",
        nivel: 4,
      },
    });
    const proveedor = await db.prisma.proveedor.create({
      data: {
        nombre: "PROVEEDOR LOCAL",
        tipoProveedor: "MERCADERIA_LOCAL",
        pais: "AR",
        cuentaContableId: cuentaProv.id,
      },
    });
    return { periodo, cuentaProv, cuentaMerc, proveedor };
  }

  async function crearCompraConAsiento(opts: {
    periodoId: number;
    proveedorId: string;
    cuentaProvId: number;
    cuentaMercId: number;
    numero: string;
    moneda: "ARS" | "USD";
    totalNativo: string;
    haberArs: string;
    usd?: string;
    asientoNumero: number;
  }) {
    await db.prisma.compra.create({
      data: {
        numero: opts.numero,
        proveedorId: opts.proveedorId,
        fecha: FECHA,
        fechaVencimiento: VENC,
        moneda: opts.moneda,
        tipoCambio: opts.moneda === "USD" ? TC : "1",
        subtotal: opts.totalNativo,
        iva: "0",
        total: opts.totalNativo,
        estado: "EMITIDA",
      },
    });
    await db.prisma.asiento.create({
      data: {
        numero: opts.asientoNumero,
        fecha: FECHA,
        descripcion: `Compra ${opts.numero}`,
        estado: "CONTABILIZADO",
        origen: "MANUAL",
        moneda: "ARS",
        tipoCambio: "1",
        totalDebe: opts.haberArs,
        totalHaber: opts.haberArs,
        periodoId: opts.periodoId,
        lineas: {
          create: [
            {
              cuentaId: opts.cuentaMercId,
              debe: opts.haberArs,
              haber: 0,
              descripcion: "Mercadería",
            },
            {
              cuentaId: opts.cuentaProvId,
              debe: 0,
              haber: opts.haberArs,
              descripcion: `Compra ${opts.numero}`,
              ...(opts.usd
                ? { monedaOrigen: "USD", montoOrigen: opts.usd, tipoCambioOrigen: TC }
                : {}),
            },
          ],
        },
      },
    });
  }

  it("compra USD → saldoTotalUsd + factura.montoNativo (÷TC emisión)", async () => {
    const b = await seedBase();
    await crearCompraConAsiento({
      periodoId: b.periodo.id,
      proveedorId: b.proveedor.id,
      cuentaProvId: b.cuentaProv.id,
      cuentaMercId: b.cuentaMerc.id,
      numero: "C-USD-1",
      moneda: "USD",
      totalNativo: "1000.00",
      haberArs: "1200000.00",
      usd: "1000.00",
      asientoNumero: 1,
    });

    const saldos = await getSaldosPorProveedorConAging();
    const prov = saldos.find((p) => p.proveedorId === b.proveedor.id);
    expect(prov).toBeDefined();
    expect(prov?.saldoTotal).toBe("1200000.00"); // contable ARS (la verdad)
    expect(prov?.saldoTotalUsd).toBe("1000.00"); // USD nativo via monedaOrigen
    const f = prov?.facturas.find((x) => x.numero === "C-USD-1");
    expect(f?.moneda).toBe("USD");
    expect(f?.monto).toBe("1200000.00"); // ARS legado
    expect(f?.montoNativo).toBe("1000.00"); // 1.200.000 / 1200
  });

  it("compra ARS → saldoTotalUsd ausente + montoNativo == monto", async () => {
    const b = await seedBase();
    await crearCompraConAsiento({
      periodoId: b.periodo.id,
      proveedorId: b.proveedor.id,
      cuentaProvId: b.cuentaProv.id,
      cuentaMercId: b.cuentaMerc.id,
      numero: "C-ARS-1",
      moneda: "ARS",
      totalNativo: "750000.00",
      haberArs: "750000.00",
      asientoNumero: 2,
    });

    const saldos = await getSaldosPorProveedorConAging();
    const prov = saldos.find((p) => p.proveedorId === b.proveedor.id);
    expect(prov?.saldoTotal).toBe("750000.00");
    expect(prov?.saldoTotalUsd).toBeUndefined();
    const f = prov?.facturas.find((x) => x.numero === "C-ARS-1");
    expect(f?.moneda).toBe("ARS");
    expect(f?.montoNativo).toBe("750000.00");
  });
});
