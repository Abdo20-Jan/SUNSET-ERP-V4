import { expect, test } from "@playwright/test";
import { desconsolidar } from "@/lib/services/desconsolidacion";
import {
  abrirInvestigacion,
  concluirInvestigacion,
  diagnosticarCausa,
} from "@/lib/services/divergencia-investigacion";
import { createE2eDb, type E2eDb } from "./support/db";
import { crearPeriodoAbierto, seedContenedorEnDF, TABLAS_COMEX } from "./support/seed";

// CENÁRIO 4 — Divergencia D9 por causa.
//
// Conferencia física con diferencia (declarado 100, físico 90): la
// desconsolidación BLOQUEA el asiento y el stock y deja el contenedor en
// AGUARDANDO_INVESTIGACAO. Luego se abre la investigación, se diagnostica la
// causa (FABRICA_ORIGEM → responsable FORNECEDOR) y al concluir se genera el
// asiento de ajuste D9 y el contenedor vuelve a DESCONSOLIDADO.

const FECHA = new Date("2025-06-15T12:00:00.000Z");

test.describe("CENÁRIO 4 · divergencia D9 por causa", () => {
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
    await crearPeriodoAbierto(db.prisma);
  });

  test("físico < declarado bloquea asiento/stock; concluir investigación genera el ajuste", async () => {
    // SKU-1: declarado 100, FC 10 USD. Físico conferido = 90 (falta de 10).
    const s = await seedContenedorEnDF(
      db.prisma,
      [{ codigo: "SKU-1", declarada: 100, fc: "10.0000" }],
      // Camino de divergencia: no postea traslado → no requiere arribo y mantiene
      // asiento.count()===0.
      { conArribo: false },
    );
    const item = s.items[0]!;

    // --- Desconsolidación con divergencia: gate D9 bloquea.
    const desc = await desconsolidar(
      {
        contenedorId: s.contenedorId,
        conferencia: [{ itemContenedorId: item.itemContenedorId, cantidadFisica: 90 }],
        fecha: FECHA,
      },
      db.prisma,
    );

    expect(desc.divergencia).toBe(true);
    expect(desc.asiento).toBeNull();
    expect(desc.contenedor.estado).toBe("AGUARDANDO_INVESTIGACAO");

    // Físico grabado, counters NO tocados (camino bloqueado), sin asiento ni stock.
    const icBloqueado = await db.prisma.itemContenedor.findUniqueOrThrow({
      where: { id: item.itemContenedorId },
    });
    expect(icBloqueado.cantidadFisica).toBe(90);
    expect(icBloqueado.cantidadDisponible).toBe(0);
    expect(await db.prisma.asiento.count()).toBe(0);
    expect(
      await db.prisma.movimientoStock.count({
        where: { desconsolidacionId: desc.desconsolidacion.id },
      }),
    ).toBe(0);

    // --- Abrir investigación: deriva DivergenciaItem de los counters.
    const investigacion = await abrirInvestigacion(
      { desconsolidacionId: desc.desconsolidacion.id },
      db.prisma,
    );
    expect(investigacion.estado).toBe("EM_ANALISE");
    const divItems = await db.prisma.divergenciaItem.findMany({
      where: { divergenciaInvestigacionId: investigacion.id },
    });
    expect(divItems).toHaveLength(1);
    expect(divItems[0]?.diferenciaUnidades).toBe(-10);

    // --- Diagnóstico de causa: FABRICA_ORIGEM exige responsable FORNECEDOR.
    const diagnosticada = await diagnosticarCausa(
      investigacion.id,
      { causa: "FABRICA_ORIGEM", responsavelTipo: "FORNECEDOR" },
      db.prisma,
    );
    expect(diagnosticada.causaIdentificada).toBe("FABRICA_ORIGEM");
    expect(diagnosticada.responsavelTipo).toBe("FORNECEDOR");

    // --- Concluir: una FALTA con responsable exige una cuenta a cobrar (crédito
    // contra el responsable). Genera el asiento de ajuste D9 y libera el contenedor.
    const cuentaCobrar = await db.prisma.cuentaContable.create({
      data: {
        codigo: "1.1.2.99",
        nombre: "DEUDORES POR DIFERENCIAS COMEX",
        tipo: "ANALITICA",
        categoria: "ACTIVO",
        nivel: 4,
      },
    });
    const { investigacion: concluida, asiento } = await concluirInvestigacion(
      investigacion.id,
      {
        fecha: FECHA,
        cuentaPorCobrarId: cuentaCobrar.id,
        descripcion: "Falta de fábrica confirmada (e2e)",
      },
      db.prisma,
    );
    expect(concluida.estado).not.toBe("EM_ANALISE");
    expect(asiento).not.toBeNull();

    // Contenedor vuelve a DESCONSOLIDADO tras concluir.
    const contenedor = await db.prisma.contenedor.findUniqueOrThrow({
      where: { id: s.contenedorId },
    });
    expect(contenedor.estado).toBe("DESCONSOLIDADO");
  });

  test("diagnóstico con responsable incoherente para la causa es rechazado", async () => {
    const s = await seedContenedorEnDF(
      db.prisma,
      [{ codigo: "SKU-1", declarada: 100, fc: "10.0000" }],
      // Camino de divergencia: no postea traslado → no requiere arribo y mantiene
      // asiento.count()===0.
      { conArribo: false },
    );
    const item = s.items[0]!;
    const desc = await desconsolidar(
      {
        contenedorId: s.contenedorId,
        conferencia: [{ itemContenedorId: item.itemContenedorId, cantidadFisica: 90 }],
        fecha: FECHA,
      },
      db.prisma,
    );
    const investigacion = await abrirInvestigacion(
      { desconsolidacionId: desc.desconsolidacion.id },
      db.prisma,
    );

    // FABRICA_ORIGEM exige FORNECEDOR, no TRANSPORTADOR → CAUSA_INCOHERENTE.
    await expect(
      diagnosticarCausa(
        investigacion.id,
        { causa: "FABRICA_ORIGEM", responsavelTipo: "TRANSPORTADOR" },
        db.prisma,
      ),
    ).rejects.toMatchObject({ code: "CAUSA_INCOHERENTE" });
  });
});
