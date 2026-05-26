import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// PR 4.6 — cron de limpieza de borradores expirados. El handler valida el
// Bearer CRON_SECRET (Vercel Cron), respeta la flag (no-op si está apagada) y
// expira los borradores vencidos liberando los counters trabados
// (cantidadEnDespacho → cantidadDisponible) vía expirarBorrador (idempotente).

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

import { GET } from "@/app/api/cron/cleanup-despachos-borrador/route";

const SECRET = "test-cron-secret";

function req(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/cron/cleanup-despachos-borrador", { headers });
}

describe("cron cleanup borradores expirados (PR 4.6)", () => {
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
    process.env.CRON_SECRET = SECRET;
    process.env.CONTENEDOR_DESCONSOLIDACION_ENABLED = "true";
    await db.reset([
      "DespachoBorrador",
      "ItemContenedor",
      "Contenedor",
      "ItemEmbarque",
      "Embarque",
      "Producto",
      "Proveedor",
    ]);
  });

  // Borrador CONFIRMADO_TRABA_COUNTS, vencido, con 30 trabadas sobre un IC que
  // refleja ese traba (enDespacho 30, disponible 0).
  async function seedBorradorVencido(opts?: { vencido?: boolean }): Promise<{
    borradorId: string;
    icId: number;
  }> {
    const vencido = opts?.vencido ?? true;
    const prov = await db.prisma.proveedor.create({ data: { nombre: "Exterior SA" } });
    const prod = await db.prisma.producto.create({
      data: { codigo: "SKU-1", nombre: "Neumático" },
    });
    const embarque = await db.prisma.embarque.create({
      data: { codigo: "EMB-Y", proveedorId: prov.id, moneda: "USD", tipoCambio: "1000.000000" },
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
      data: { embarqueId: embarque.id, numeroContenedor: "MSCU0000002", estado: "DESCONSOLIDADO" },
    });
    const ic = await db.prisma.itemContenedor.create({
      data: {
        contenedorId: contenedor.id,
        itemEmbarqueId: ie.id,
        productoId: prod.id,
        cantidadDeclarada: 60,
        cantidadFisica: 60,
        cantidadDisponible: 0,
        cantidadEnDespacho: 30,
      },
    });
    const borrador = await db.prisma.despachoBorrador.create({
      data: {
        userId: "user-uuid",
        embarqueId: embarque.id,
        estadoActual: "CONFIRMADO_TRABA_COUNTS",
        payloadDiff: { lineas: [{ itemContenedorId: ic.id, cantidad: 30 }] },
        countsTrabados: { [ic.id]: 30 },
        expiresAt: vencido
          ? new Date(Date.now() - 60_000)
          : new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    return { borradorId: borrador.id, icId: ic.id };
  }

  it("rechaza sin Bearer válido (401)", async () => {
    await seedBorradorVencido();
    const sinHeader = await GET(req());
    expect(sinHeader.status).toBe(401);
    const malSecret = await GET(req({ authorization: "Bearer wrong" }));
    expect(malSecret.status).toBe(401);
  });

  it("expira el borrador vencido y libera los counters", async () => {
    const s = await seedBorradorVencido();
    const res = await GET(req({ authorization: `Bearer ${SECRET}` }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cleaned: number };
    expect(body.cleaned).toBe(1);

    const borrador = await db.prisma.despachoBorrador.findUniqueOrThrow({
      where: { id: s.borradorId },
    });
    expect(borrador.estadoActual).toBe("EXPIRADO");

    const ic = await db.prisma.itemContenedor.findUniqueOrThrow({ where: { id: s.icId } });
    expect(ic.cantidadEnDespacho).toBe(0);
    expect(ic.cantidadDisponible).toBe(30);
  });

  it("no toca borradores no vencidos", async () => {
    const s = await seedBorradorVencido({ vencido: false });
    const res = await GET(req({ authorization: `Bearer ${SECRET}` }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cleaned: number };
    expect(body.cleaned).toBe(0);

    const ic = await db.prisma.itemContenedor.findUniqueOrThrow({ where: { id: s.icId } });
    expect(ic.cantidadEnDespacho).toBe(30);
    expect(ic.cantidadDisponible).toBe(0);
  });

  it("flag apagada: no-op aunque haya vencidos", async () => {
    const s = await seedBorradorVencido();
    process.env.CONTENEDOR_DESCONSOLIDACION_ENABLED = "false";
    const res = await GET(req({ authorization: `Bearer ${SECRET}` }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cleaned: number; skipped?: string };
    expect(body.cleaned).toBe(0);

    const ic = await db.prisma.itemContenedor.findUniqueOrThrow({ where: { id: s.icId } });
    expect(ic.cantidadEnDespacho).toBe(30);
  });
});
