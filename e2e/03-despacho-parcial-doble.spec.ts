import { expect, test } from "@playwright/test";
import {
  contabilizarBorrador,
  crearBorrador,
  materializarDespachoCruzado,
} from "@/lib/services/despacho-parcial";
import { createE2eDb, type E2eDb } from "./support/db";
import { seedContenedorDesconsolidado, TABLAS_COMEX } from "./support/seed";

// CENÁRIO 3 — Despacho parcial 2× sobre el mismo contenedor.
//
// Contenedor con 25 disponibles. Se nacionaliza 16 en un despacho cruzado
// (vía borrador: traba→materializa), quedando 9 de saldo. Un segundo despacho
// directo por las 9 deja el contenedor TOTALMENTE_DESPACHADO sin oversell.
// La invariante: la suma de despachados nunca supera el disponible inicial y
// los counters cierran exactos (disponible 0, despachada 25).

const FECHA = new Date("2025-06-15T12:00:00.000Z");

test.describe("CENÁRIO 3 · despacho parcial doble (16 + 9 = 25)", () => {
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

  test("dos despachos parciales (16 nacional, 9 sobra→despacho) cierran el saldo", async () => {
    const s = await seedContenedorDesconsolidado(db.prisma, { disponible: 25 });

    // --- Despacho 1: 16 unidades vía borrador (traba single-shot → materializa).
    const borrador = await crearBorrador(
      {
        userId: "user-uuid",
        embarqueId: s.embarqueId,
        lineas: [{ itemContenedorId: s.itemContenedorId, cantidad: 16 }],
      },
      db.prisma,
    );
    expect(borrador.estadoActual).toBe("CONFIRMADO_TRABA_COUNTS");

    // Tras trabar: 9 disponibles, 16 en despacho.
    const icTrabado = await db.prisma.itemContenedor.findUniqueOrThrow({
      where: { id: s.itemContenedorId },
    });
    expect(icTrabado.cantidadDisponible).toBe(9);
    expect(icTrabado.cantidadEnDespacho).toBe(16);

    const { despachoId: despacho1 } = await contabilizarBorrador(
      { borradorId: borrador.id, fecha: FECHA },
      db.prisma,
    );

    // Tras materializar el primer despacho: 9 disponibles, 16 despachadas.
    const icDespacho1 = await db.prisma.itemContenedor.findUniqueOrThrow({
      where: { id: s.itemContenedorId },
    });
    expect(icDespacho1.cantidadDisponible).toBe(9);
    expect(icDespacho1.cantidadEnDespacho).toBe(0);
    expect(icDespacho1.cantidadDespachada).toBe(16);
    expect(
      (await db.prisma.contenedor.findUniqueOrThrow({ where: { id: s.contenedorId } })).estado,
    ).toBe("PARCIALMENTE_DESPACHADO");

    // --- Despacho 2: las 9 de sobra (camino directo).
    const { despachoId: despacho2 } = await db.prisma.$transaction((t) =>
      materializarDespachoCruzado(t, {
        embarqueId: s.embarqueId,
        fecha: FECHA,
        fuente: "DIRECTO",
        lineas: [{ itemContenedorId: s.itemContenedorId, cantidad: 9 }],
      }),
    );

    // Saldo cerrado: 0 disponibles, 25 despachadas; contenedor TOTALMENTE_DESPACHADO.
    const icFinal = await db.prisma.itemContenedor.findUniqueOrThrow({
      where: { id: s.itemContenedorId },
    });
    expect(icFinal.cantidadDisponible).toBe(0);
    expect(icFinal.cantidadEnDespacho).toBe(0);
    expect(icFinal.cantidadDespachada).toBe(25);
    expect(
      (await db.prisma.contenedor.findUniqueOrThrow({ where: { id: s.contenedorId } })).estado,
    ).toBe("TOTALMENTE_DESPACHADO");

    // Dos despachos distintos, cada uno con su ItemDespacho cruzado.
    expect(despacho1).not.toBe(despacho2);
    const items1 = await db.prisma.itemDespacho.findMany({ where: { despachoId: despacho1 } });
    const items2 = await db.prisma.itemDespacho.findMany({ where: { despachoId: despacho2 } });
    expect(items1).toHaveLength(1);
    expect(items1[0]?.cantidad).toBe(16);
    expect(items2).toHaveLength(1);
    expect(items2[0]?.cantidad).toBe(9);
  });

  test("el segundo despacho no puede sobrepasar el saldo remanente (sin oversell)", async () => {
    const s = await seedContenedorDesconsolidado(db.prisma, { disponible: 25 });

    // Primer despacho directo por 16 → quedan 9.
    await db.prisma.$transaction((t) =>
      materializarDespachoCruzado(t, {
        embarqueId: s.embarqueId,
        fecha: FECHA,
        fuente: "DIRECTO",
        lineas: [{ itemContenedorId: s.itemContenedorId, cantidad: 16 }],
      }),
    );

    // Intentar despachar 10 (> 9 remanente) debe fallar sin tocar counters.
    await expect(
      db.prisma.$transaction((t) =>
        materializarDespachoCruzado(t, {
          embarqueId: s.embarqueId,
          fecha: FECHA,
          fuente: "DIRECTO",
          lineas: [{ itemContenedorId: s.itemContenedorId, cantidad: 10 }],
        }),
      ),
    ).rejects.toMatchObject({ code: "SALDO_INSUFICIENTE" });

    const ic = await db.prisma.itemContenedor.findUniqueOrThrow({
      where: { id: s.itemContenedorId },
    });
    expect(ic.cantidadDisponible).toBe(9);
    expect(ic.cantidadDespachada).toBe(16);
  });
});
