import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// Gap #7 — Guard de tipoCambio USD. El embarque puede guardarse con
// tipoCambio USD = 1 sin validación, corrompiendo el asiento de arribo y el
// cerrar costos (el costo unitario explota). Hoy sólo ARS está validado
// (ARS ⇒ TC=1). USD aceptaba cualquier valor, incl. 1. Validamos USD ⇒ TC > 1
// en el zod del server, en el form del client, y como defensa en profundidad
// dentro de crearAsientoArriboComex.

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

import { embarqueInputSchema } from "@/lib/actions/embarques";
import { AsientoError, crearAsientoArriboComex } from "@/lib/services/asiento-automatico";

const FECHA_ISO = "2026-05-21T12:00:00.000Z";

const PROVEEDOR_ID = "11111111-1111-4111-8111-111111111111";
const DEPOSITO_ID = "22222222-2222-4222-8222-222222222222";
const PRODUCTO_ID = "33333333-3333-4333-8333-333333333333";
const PROVEEDOR_FACTURA_ID = "44444444-4444-4444-8444-444444444444";

function baseEmbarqueInput(overrides: Record<string, unknown> = {}) {
  return {
    codigo: "EMB-TC",
    proveedorId: PROVEEDOR_ID,
    depositoDestinoId: DEPOSITO_ID,
    moneda: "USD" as const,
    tipoCambio: "1382",
    estado: "BORRADOR",
    die: "0",
    tasaEstadistica: "0",
    arancelSim: "0",
    iva: "0",
    ivaAdicional: "0",
    ganancias: "0",
    iibb: "0",
    items: [
      {
        productoId: PRODUCTO_ID,
        cantidad: 10,
        precioUnitarioFob: "10.00",
      },
    ],
    costos: [],
    ...overrides,
  };
}

describe("guard tipoCambio USD — zod del embarque (gap #7)", () => {
  it("rechaza USD con TC = 1", () => {
    const res = embarqueInputSchema.safeParse(baseEmbarqueInput({ tipoCambio: "1" }));
    expect(res.success).toBe(false);
    if (!res.success) {
      const issue = res.error.issues.find((i) => i.path.join(".") === "tipoCambio");
      expect(issue).toBeDefined();
    }
  });

  it("acepta USD con TC = 1382", () => {
    const res = embarqueInputSchema.safeParse(baseEmbarqueInput({ tipoCambio: "1382" }));
    expect(res.success).toBe(true);
  });

  it("acepta ARS con TC = 1", () => {
    const res = embarqueInputSchema.safeParse(
      baseEmbarqueInput({ moneda: "ARS", tipoCambio: "1" }),
    );
    expect(res.success).toBe(true);
  });

  it("rechaza una factura USD con TC = 1", () => {
    const res = embarqueInputSchema.safeParse(
      baseEmbarqueInput({
        costos: [
          {
            proveedorId: PROVEEDOR_FACTURA_ID,
            moneda: "USD",
            tipoCambio: "1",
            momento: "ZONA_PRIMARIA",
            iva: "0",
            iibb: "0",
            otros: "0",
            lineas: [
              {
                tipo: "GASTOS_PORTUARIOS",
                cuentaContableGastoId: 1,
                subtotal: "100.00",
              },
            ],
          },
        ],
      }),
    );
    expect(res.success).toBe(false);
    if (!res.success) {
      const issue = res.error.issues.find((i) => i.path.join(".") === "costos.0.tipoCambio");
      expect(issue).toBeDefined();
    }
  });

  it("acepta una factura USD con TC = 1382", () => {
    const res = embarqueInputSchema.safeParse(
      baseEmbarqueInput({
        costos: [
          {
            proveedorId: PROVEEDOR_FACTURA_ID,
            moneda: "USD",
            tipoCambio: "1382",
            momento: "ZONA_PRIMARIA",
            iva: "0",
            iibb: "0",
            otros: "0",
            lineas: [
              {
                tipo: "GASTOS_PORTUARIOS",
                cuentaContableGastoId: 1,
                subtotal: "100.00",
              },
            ],
          },
        ],
      }),
    );
    expect(res.success).toBe(true);
  });
});

describe("guard tipoCambio USD — defensa en profundidad en crearAsientoArriboComex", () => {
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

  it("embarque USD con TC = 1 → rechaza con DOMINIO_INVALIDO", async () => {
    const prov = await db.prisma.proveedor.create({ data: { nombre: "Exterior SA" } });
    const prod = await db.prisma.producto.create({ data: { codigo: "X-1", nombre: "Prod X" } });
    const embarque = await db.prisma.embarque.create({
      data: {
        codigo: "EMB-TC1",
        proveedorId: prov.id,
        moneda: "USD",
        tipoCambio: "1.000000",
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
      data: { embarqueId: embarque.id, numeroContenedor: "MSCU-X", estado: "EN_TRANSITO" },
    });
    await db.prisma.itemContenedor.create({
      data: {
        contenedorId: cont.id,
        itemEmbarqueId: ie.id,
        productoId: prod.id,
        cantidadDeclarada: 100,
        costoFCUnitario: "10.0000",
      },
    });

    await expect(
      crearAsientoArriboComex(embarque.id, db.prisma, new Date(FECHA_ISO)),
    ).rejects.toThrow(AsientoError);
    await expect(
      crearAsientoArriboComex(embarque.id, db.prisma, new Date(FECHA_ISO)),
    ).rejects.toMatchObject({ code: "DOMINIO_INVALIDO" });
  });
});
