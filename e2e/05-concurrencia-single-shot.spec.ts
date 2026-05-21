import { expect, test } from "@playwright/test";
import { crearBorrador } from "@/lib/services/despacho-parcial";
import { createE2eDb, type E2eDb } from "./support/db";
import { seedContenedorDesconsolidado, TABLAS_COMEX } from "./support/seed";

// CENÁRIO 5 — Concurrencia (traba single-shot).
//
// Dos despachos compiten por el mismo saldo (60 disponibles, cada uno pide 40).
// La traba es un UPDATE condicional `WHERE cantidadDisponible >= ?` (PR 4.3):
// no hay TOCTOU, así que sólo UNO gana y el otro recibe SALDO_INSUFICIENTE. No
// hay oversell: el disponible final es coherente con un único ganador.

test.describe("CENÁRIO 5 · concurrencia single-shot (sin oversell)", () => {
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

  test("dos borradores concurrentes por 40 sobre 60: gana uno, el otro SALDO_INSUFICIENTE", async () => {
    const s = await seedContenedorDesconsolidado(db.prisma, { disponible: 60 });

    const intento = (cantidad: number) =>
      db.prisma.$transaction((t) =>
        crearBorrador(
          {
            userId: "user-uuid",
            embarqueId: s.embarqueId,
            lineas: [{ itemContenedorId: s.itemContenedorId, cantidad }],
          },
          t,
        ),
      );

    // 40 + 40 = 80 > 60: sólo uno puede ganar.
    const res = await Promise.allSettled([intento(40), intento(40)]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);

    const rechazado = res.find((r) => r.status === "rejected");
    expect(rechazado).toBeDefined();
    expect((rechazado as PromiseRejectedResult).reason).toMatchObject({
      code: "SALDO_INSUFICIENTE",
    });

    // Sin oversell: un solo ganador trabó 40 → 20 disponibles, 40 en despacho.
    const ic = await db.prisma.itemContenedor.findUniqueOrThrow({
      where: { id: s.itemContenedorId },
    });
    expect(ic.cantidadDisponible).toBe(20);
    expect(ic.cantidadEnDespacho).toBe(40);

    // Un solo borrador materializado.
    expect(await db.prisma.despachoBorrador.count()).toBe(1);
  });

  test("sobregiro en una sola línea (61 sobre 60) se rechaza sin tocar counters", async () => {
    const s = await seedContenedorDesconsolidado(db.prisma, { disponible: 60 });

    await expect(
      crearBorrador(
        {
          userId: "user-uuid",
          embarqueId: s.embarqueId,
          lineas: [{ itemContenedorId: s.itemContenedorId, cantidad: 61 }],
        },
        db.prisma,
      ),
    ).rejects.toMatchObject({ code: "SALDO_INSUFICIENTE" });

    const ic = await db.prisma.itemContenedor.findUniqueOrThrow({
      where: { id: s.itemContenedorId },
    });
    expect(ic.cantidadDisponible).toBe(60); // intacto
    expect(ic.cantidadEnDespacho).toBe(0);
  });
});
