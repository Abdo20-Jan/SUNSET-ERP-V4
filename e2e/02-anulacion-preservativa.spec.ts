import { expect, test } from "@playwright/test";
import {
  materializarDespachoCruzado,
  revertirCountersDespacho,
} from "@/lib/services/despacho-parcial";
import { createE2eDb, type E2eDb } from "./support/db";
import { seedContenedorDesconsolidado, TABLAS_COMEX } from "./support/seed";

// CENÁRIO 2 — Anulación preservativa (reversión atómica).
//
// Sobre un despacho cruzado materializado (counters movidos
// disponible→despachada), la anulación revierte los counters en la MISMA
// transacción: despachada→disponible y el contenedor vuelve de
// TOTALMENTE/PARCIALMENTE_DESPACHADO a un estado con saldo. La invariante clave
// es la atomicidad y la conservación: lo que entra se devuelve exacto.
//
// Ejerce los primitivos de service `materializarDespachoCruzado` (DIRECTO) y
// `revertirCountersDespacho` dentro de `$transaction`, que es el núcleo que la
// server action `anularDespachoAction` envuelve (más asiento + stock recalc,
// cubiertos por la suite vitest `anular-despacho-cruzado.test.ts`).

const FECHA = new Date("2025-06-15T12:00:00.000Z");

test.describe("CENÁRIO 2 · anulación preservativa de despacho cruzado", () => {
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
  });

  test("revierte counters despachada→disponible y restituye el estado del contenedor", async () => {
    // Contenedor con 60 disponibles.
    const s = await seedContenedorDesconsolidado(db.prisma, { disponible: 60 });

    // Materializa un despacho cruzado por 40 (camino DIRECTO: disponible→despachada).
    const { despachoId } = await db.prisma.$transaction((t) =>
      materializarDespachoCruzado(t, {
        embarqueId: s.embarqueId,
        fecha: FECHA,
        fuente: "DIRECTO",
        lineas: [{ itemContenedorId: s.itemContenedorId, cantidad: 40 }],
      }),
    );

    // Pre-condición: 20 disponibles, 40 despachadas; contenedor PARCIALMENTE_DESPACHADO.
    const icPre = await db.prisma.itemContenedor.findUniqueOrThrow({
      where: { id: s.itemContenedorId },
    });
    expect(icPre.cantidadDisponible).toBe(20);
    expect(icPre.cantidadDespachada).toBe(40);
    const contenedorPre = await db.prisma.contenedor.findUniqueOrThrow({
      where: { id: s.contenedorId },
    });
    expect(contenedorPre.estado).toBe("PARCIALMENTE_DESPACHADO");

    // Anulación preservativa: revierte counters en una sola transacción y marca
    // el despacho ANULADO (como hace anularDespachoAction).
    await db.prisma.$transaction(async (t) => {
      await revertirCountersDespacho(t, despachoId);
      await t.despacho.update({ where: { id: despachoId }, data: { estado: "ANULADO" } });
    });

    // Counters conservados: 40 vuelven a disponible (60 total), 0 despachadas.
    const icPost = await db.prisma.itemContenedor.findUniqueOrThrow({
      where: { id: s.itemContenedorId },
    });
    expect(icPost.cantidadDisponible).toBe(60);
    expect(icPost.cantidadDespachada).toBe(0);
    expect(icPost.cantidadEnDespacho).toBe(0);

    // Estado del contenedor restituido (vuelve a DESCONSOLIDADO: sin nada despachado).
    const contenedorPost = await db.prisma.contenedor.findUniqueOrThrow({
      where: { id: s.contenedorId },
    });
    expect(contenedorPost.estado).toBe("DESCONSOLIDADO");

    // Despacho ANULADO.
    const despacho = await db.prisma.despacho.findUniqueOrThrow({ where: { id: despachoId } });
    expect(despacho.estado).toBe("ANULADO");
  });

  test("la reversión es atómica: un fallo (guard de saldo) deja TODO intacto", async () => {
    const s = await seedContenedorDesconsolidado(db.prisma, { disponible: 60 });
    const { despachoId } = await db.prisma.$transaction((t) =>
      materializarDespachoCruzado(t, {
        embarqueId: s.embarqueId,
        fecha: FECHA,
        fuente: "DIRECTO",
        lineas: [{ itemContenedorId: s.itemContenedorId, cantidad: 40 }],
      }),
    );

    // Corrompemos el counter para forzar el guard `cantidadDespachada >= cantidad`
    // a fallar (despachada 40 < 40 requeridas + 1). Simula un estado inconsistente.
    await db.prisma.itemContenedor.update({
      where: { id: s.itemContenedorId },
      data: { cantidadDespachada: 10 },
    });

    // La reversión debe lanzar y revertir TODA la transacción (atómico).
    await expect(
      db.prisma.$transaction(async (t) => {
        await revertirCountersDespacho(t, despachoId);
        await t.despacho.update({ where: { id: despachoId }, data: { estado: "ANULADO" } });
      }),
    ).rejects.toMatchObject({ code: "SALDO_INSUFICIENTE" });

    // El despacho NO quedó ANULADO (rollback total).
    const despacho = await db.prisma.despacho.findUniqueOrThrow({ where: { id: despachoId } });
    expect(despacho.estado).not.toBe("ANULADO");
  });
});
