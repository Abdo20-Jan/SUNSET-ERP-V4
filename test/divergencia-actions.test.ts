import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// PR 3.5 — actions de la investigación de divergencia. Verifica gate (flag),
// abrir/conferencia(evidencias)/diagnóstico/archivar sobre BD real (el service
// subyacente ya tiene 19 tests; acá se cubre la capa de action + mapError +
// la persistencia de las URLs de evidencia, lo nuevo del 3.5).

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

import {
  abrirInvestigacionAction,
  arquivarInvestigacionAction,
  diagnosticarCausaAction,
  registrarConferenciaAction,
} from "@/lib/actions/divergencia";

describe("actions investigación divergencia (PR 3.5)", () => {
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
      "DivergenciaItem",
      "DivergenciaInvestigacion",
      "Desconsolidacion",
      "ItemContenedor",
      "Contenedor",
      "ItemEmbarque",
      "Embarque",
      "Producto",
      "Proveedor",
    ]);
  });

  async function seed(): Promise<{ contenedorId: string }> {
    const prov = await db.prisma.proveedor.create({ data: { nombre: "Exterior SA" } });
    const prod = await db.prisma.producto.create({
      data: { codigo: "SKU-1", nombre: "Neumático" },
    });
    const embarque = await db.prisma.embarque.create({
      data: { codigo: "EMB-DV", proveedorId: prov.id, moneda: "USD", tipoCambio: "1000.000000" },
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
      data: { embarqueId: embarque.id, numeroContenedor: "MSCU0000001", estado: "DESCONSOLIDADO" },
    });
    // Físico 55 vs declarado 60 → falta de 5 (divergencia).
    await db.prisma.itemContenedor.create({
      data: {
        contenedorId: contenedor.id,
        itemEmbarqueId: ie.id,
        productoId: prod.id,
        cantidadDeclarada: 60,
        cantidadFisica: 55,
        costoFCUnitario: "10.0000",
      },
    });
    await db.prisma.desconsolidacion.create({ data: { contenedorId: contenedor.id } });
    return { contenedorId: contenedor.id };
  }

  it("gate: con la flag OFF rechaza", async () => {
    const s = await seed();
    process.env.CONTENEDOR_DESCONSOLIDACION_ENABLED = "false";
    const res = await abrirInvestigacionAction({ contenedorId: s.contenedorId });
    expect(res.ok).toBe(false);
  });

  it("abre la investigación y deja el contenedor en AGUARDANDO_INVESTIGACAO", async () => {
    const s = await seed();
    const res = await abrirInvestigacionAction({ contenedorId: s.contenedorId });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.investigacionId).toBeTruthy();
    const cont = await db.prisma.contenedor.findUniqueOrThrow({ where: { id: s.contenedorId } });
    expect(cont.estado).toBe("AGUARDANDO_INVESTIGACAO");
  });

  it("rechaza abrir dos veces (duplicada)", async () => {
    const s = await seed();
    await abrirInvestigacionAction({ contenedorId: s.contenedorId });
    const res = await abrirInvestigacionAction({ contenedorId: s.contenedorId });
    expect(res.ok).toBe(false);
  });

  it("registra la conferencia física con evidencias (fotos/documentos)", async () => {
    const s = await seed();
    const abrir = await abrirInvestigacionAction({ contenedorId: s.contenedorId });
    if (!abrir.ok) throw new Error("no abrió");
    const res = await registrarConferenciaAction({
      investigacionId: abrir.investigacionId,
      contenedorId: s.contenedorId,
      pesoContenedorKg: "1200.500",
      lacreOrigemOk: false,
      lacreOrigemObs: "Lacre violado",
      fotosUrls: ["https://blob.example.com/foto-abc.jpg"],
      documentosUrls: ["https://blob.example.com/acta-xyz.pdf"],
    });
    expect(res.ok).toBe(true);
    const inv = await db.prisma.divergenciaInvestigacion.findUniqueOrThrow({
      where: { id: abrir.investigacionId },
    });
    expect(inv.fotosUrls).toEqual(["https://blob.example.com/foto-abc.jpg"]);
    expect(inv.documentosUrls).toEqual(["https://blob.example.com/acta-xyz.pdf"]);
    expect(inv.lacreOrigemOk).toBe(false);
    expect(inv.pesoContenedorKg?.toString()).toBe("1200.5");
  });

  it("diagnostica causa coherente y rechaza la incoherente", async () => {
    const s = await seed();
    const abrir = await abrirInvestigacionAction({ contenedorId: s.contenedorId });
    if (!abrir.ok) throw new Error("no abrió");

    const incoherente = await diagnosticarCausaAction({
      investigacionId: abrir.investigacionId,
      contenedorId: s.contenedorId,
      causa: "FABRICA_ORIGEM",
      responsavelTipo: "TRANSPORTADOR", // esperado: FORNECEDOR
    });
    expect(incoherente.ok).toBe(false);

    const coherente = await diagnosticarCausaAction({
      investigacionId: abrir.investigacionId,
      contenedorId: s.contenedorId,
      causa: "FABRICA_ORIGEM",
      responsavelTipo: "FORNECEDOR",
    });
    expect(coherente.ok).toBe(true);
  });

  it("archiva la investigación y devuelve el contenedor a DESCONSOLIDADO", async () => {
    const s = await seed();
    const abrir = await abrirInvestigacionAction({ contenedorId: s.contenedorId });
    if (!abrir.ok) throw new Error("no abrió");
    const res = await arquivarInvestigacionAction({
      investigacionId: abrir.investigacionId,
      contenedorId: s.contenedorId,
      motivo: "Diferencia tolerable",
    });
    expect(res.ok).toBe(true);
    const cont = await db.prisma.contenedor.findUniqueOrThrow({ where: { id: s.contenedorId } });
    expect(cont.estado).toBe("DESCONSOLIDADO");
  });
});
