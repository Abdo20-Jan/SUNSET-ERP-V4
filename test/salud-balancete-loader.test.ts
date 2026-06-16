import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { detectarAnomaliasBalancete } from "@/lib/services/salud-balancete";
import { cargarSaldosParaSalud } from "@/lib/services/salud-balancete-loader";
import { createTestDb, type TestDb } from "./db";

// e2e del guard de salud: carga saldos reales desde la BD (contenedor) y
// confirma que detecta la anomalía sembrada (ACTIVO con saldo acreedor) y NO
// marca la regularizadora de control (ACTIVO/ACREEDOR con saldo acreedor).

const FECHA = new Date("2025-06-15T12:00:00.000Z");

describe("cargarSaldosParaSalud + detectarAnomaliasBalancete (integración)", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
  }, 180_000);

  afterAll(async () => {
    await db.stop();
  });

  beforeEach(async () => {
    await db.reset(["LineaAsiento", "Asiento", "CuentaContable", "PeriodoContable"]);
  });

  it("detecta la anomalía (1.1.5.03) y omite la regularizadora (1.2.1.09)", async () => {
    const periodo = await db.prisma.periodoContable.create({
      data: {
        codigo: "2025-06",
        nombre: "Junio 2025",
        fechaInicio: new Date("2025-06-01T00:00:00.000Z"),
        fechaFin: new Date("2025-06-30T23:59:59.999Z"),
      },
    });

    const mk = (
      codigo: string,
      categoria: "ACTIVO" | "EGRESO",
      naturaleza: "DEUDOR" | "ACREEDOR",
    ) =>
      db.prisma.cuentaContable.create({
        data: { codigo, nombre: codigo, tipo: "ANALITICA", categoria, nivel: 4, naturaleza },
      });

    const caja = await mk("1.1.1.01", "ACTIVO", "DEUDOR");
    const aEntregar = await mk("1.1.5.03", "ACTIVO", "DEUDOR");
    const deprAcum = await mk("1.2.1.09", "ACTIVO", "ACREEDOR"); // regularizadora
    const deprGasto = await mk("5.9.1.09", "EGRESO", "DEUDOR");

    // Anomalía: DEBE caja 152 / HABER 1.1.5.03 152 → 1.1.5.03 queda en −152.
    await db.prisma.asiento.create({
      data: {
        numero: 1,
        fecha: FECHA,
        descripcion: "anomalia",
        estado: "CONTABILIZADO",
        totalDebe: "152.00",
        totalHaber: "152.00",
        origen: "AJUSTE",
        periodoId: periodo.id,
        lineas: {
          create: [
            { cuentaId: caja.id, debe: "152.00", haber: "0.00" },
            { cuentaId: aEntregar.id, debe: "0.00", haber: "152.00" },
          ],
        },
      },
    });

    // Control: DEBE depr-gasto 100 / HABER depr-acum 100 → regularizadora +100 (sano).
    await db.prisma.asiento.create({
      data: {
        numero: 2,
        fecha: FECHA,
        descripcion: "regularizadora",
        estado: "CONTABILIZADO",
        totalDebe: "100.00",
        totalHaber: "100.00",
        origen: "AJUSTE",
        periodoId: periodo.id,
        lineas: {
          create: [
            { cuentaId: deprGasto.id, debe: "100.00", haber: "0.00" },
            { cuentaId: deprAcum.id, debe: "0.00", haber: "100.00" },
          ],
        },
      },
    });

    const saldos = await cargarSaldosParaSalud(db.prisma);
    const anomalias = detectarAnomaliasBalancete(saldos);

    expect(anomalias).toHaveLength(1);
    expect(anomalias[0].codigo).toBe("1.1.5.03");
    expect(anomalias[0].saldo).toBe("-152.00");
  });
});
