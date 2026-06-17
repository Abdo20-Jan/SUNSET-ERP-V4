import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import {
  type AsientoTransferenciaSubcuentaInput,
  crearAsientoDivergencia,
  crearAsientoTransferenciaSubcuenta,
} from "@/lib/services/asiento-automatico";
import { createTestDb, type TestDb } from "./db";

// PR 3.1 — helpers de asiento Comex (transferencia entre subcuentas + D9).
// Los helpers aceptan `tx?`; al pasarles la transacción del PrismaClient del
// contenedor, todo se enruta a la BD efímera (el singleton `db` nunca se toca).

const FECHA = new Date("2025-06-15T12:00:00.000Z");

describe("asientos comex ZPA (PR 3.1)", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    await db.reset(["Asiento", "LineaAsiento", "CuentaContable", "PeriodoContable"]);
    // Período abierto que contiene FECHA (resolverPeriodo lo exige).
    await db.prisma.periodoContable.create({
      data: {
        codigo: "2025-06",
        nombre: "Junio 2025",
        fechaInicio: new Date("2025-06-01T00:00:00.000Z"),
        fechaFin: new Date("2025-06-30T00:00:00.000Z"),
        estado: "ABIERTO",
      },
    });
  });

  /** Ejecuta un helper dentro de una transacción del client del contenedor. */
  function tx<T>(fn: (t: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return db.prisma.$transaction(fn);
  }

  /** Líneas del asiento como [{ codigo, debe, haber }], ordenadas por id. */
  async function lineasDe(asientoId: string) {
    const lineas = await db.prisma.lineaAsiento.findMany({
      where: { asientoId },
      include: { cuenta: { select: { codigo: true } } },
      orderBy: { id: "asc" },
    });
    return lineas.map((l) => ({
      codigo: l.cuenta.codigo,
      debe: l.debe.toFixed(2),
      haber: l.haber.toFixed(2),
    }));
  }

  describe("crearAsientoTransferenciaSubcuenta", () => {
    const casos: Array<{
      flujo: AsientoTransferenciaSubcuentaInput["flujo"];
      debe: string;
      haber: string;
    }> = [
      { flujo: "ARRIBO_ZONA_PRIMARIA", debe: "1.1.7.03", haber: "1.1.7.02" },
      { flujo: "TRASLADO_DEPOSITO_FISCAL", debe: "1.1.7.04", haber: "1.1.7.03" },
      { flujo: "NACIONALIZACION_VIA_DF", debe: "1.1.7.01", haber: "1.1.7.04" },
      { flujo: "NACIONALIZACION_DIRECTA", debe: "1.1.7.01", haber: "1.1.7.03" },
    ];

    for (const caso of casos) {
      it(`${caso.flujo}: DEBE ${caso.debe} / HABER ${caso.haber}`, async () => {
        const asiento = await tx((t) =>
          crearAsientoTransferenciaSubcuenta(
            { flujo: caso.flujo, monto: "1000.00", fecha: FECHA },
            t,
          ),
        );

        expect(asiento.totalDebe.toFixed(2)).toBe("1000.00");
        expect(asiento.totalHaber.toFixed(2)).toBe("1000.00");
        expect(asiento.origen).toBe("COMEX");

        const lineas = await lineasDe(asiento.id);
        expect(lineas).toEqual([
          { codigo: caso.debe, debe: "1000.00", haber: "0.00" },
          { codigo: caso.haber, debe: "0.00", haber: "1000.00" },
        ]);
      });
    }

    it("crea las subcuentas lazy si no existían", async () => {
      expect(await db.prisma.cuentaContable.count()).toBe(0);
      await tx((t) =>
        crearAsientoTransferenciaSubcuenta(
          { flujo: "TRASLADO_DEPOSITO_FISCAL", monto: "500", fecha: FECHA },
          t,
        ),
      );
      const codigos = (await db.prisma.cuentaContable.findMany({ select: { codigo: true } })).map(
        (c) => c.codigo,
      );
      expect(codigos).toContain("1.1.7.03");
      expect(codigos).toContain("1.1.7.04");
    });

    it("rechaza monto <= 0", async () => {
      await expect(
        tx((t) =>
          crearAsientoTransferenciaSubcuenta(
            { flujo: "ARRIBO_ZONA_PRIMARIA", monto: "0", fecha: FECHA },
            t,
          ),
        ),
      ).rejects.toMatchObject({ code: "LINEA_INVALIDA" });
    });
  });

  describe("crearAsientoDivergencia (D9)", () => {
    const base = { fecha: FECHA } as const;

    it("SOBRA: DEBE subcuenta DF / HABER 4.2.2.01", async () => {
      const asiento = await tx((t) =>
        crearAsientoDivergencia(
          { ...base, sobraMonto: "750.00", causa: "NAO_IDENTIFICADA", ubicacion: "DEPOSITO_FISCAL" },
          t,
        ),
      );
      expect(await lineasDe(asiento.id)).toEqual([
        { codigo: "1.1.7.04", debe: "750.00", haber: "0.00" },
        { codigo: "4.2.2.01", debe: "0.00", haber: "750.00" },
      ]);
    });

    it("FALTA sin responsable: DEBE 5.1.1.02 / HABER subcuenta ZPA", async () => {
      const asiento = await tx((t) =>
        crearAsientoDivergencia(
          { ...base, faltaMonto: "750.00", causa: "NAO_IDENTIFICADA", ubicacion: "ZONA_PRIMARIA" },
          t,
        ),
      );
      expect(await lineasDe(asiento.id)).toEqual([
        { codigo: "5.1.1.02", debe: "750.00", haber: "0.00" },
        { codigo: "1.1.7.03", debe: "0.00", haber: "750.00" },
      ]);
    });

    it("FALTA con responsable: DEBE cuenta a cobrar / HABER subcuenta DF", async () => {
      // Cuenta a cobrar pre-creada (simula crédito al proveedor/transportista).
      const porCobrar = await db.prisma.cuentaContable.create({
        data: {
          codigo: "1.1.2.99",
          nombre: "DEUDORES POR DIFERENCIAS COMEX",
          tipo: "ANALITICA",
          categoria: "ACTIVO",
          nivel: 4,
        },
      });
      const asiento = await tx((t) =>
        crearAsientoDivergencia(
          {
            ...base,
            faltaMonto: "750.00",
            causa: "TRANSPORTE",
            ubicacion: "DEPOSITO_FISCAL",
            cuentaPorCobrarId: porCobrar.id,
          },
          t,
        ),
      );
      expect(await lineasDe(asiento.id)).toEqual([
        { codigo: "1.1.2.99", debe: "750.00", haber: "0.00" },
        { codigo: "1.1.7.04", debe: "0.00", haber: "750.00" },
      ]);
    });

    it("FALTA + SOBRA simultáneos: asiento compuesto de 4 líneas, BRUTO sin netear", async () => {
      const asiento = await tx((t) =>
        crearAsientoDivergencia(
          {
            ...base,
            faltaMonto: "300.00",
            sobraMonto: "500.00",
            causa: "NAO_IDENTIFICADA",
            ubicacion: "DEPOSITO_FISCAL",
          },
          t,
        ),
      );
      // Sobrante bruto (500) primero, faltante bruto (300) después; el stock
      // 1.1.7.04 aparece 2× (DEBE por la sobra, HABER por la falta). El
      // ingreso (500) y la merma (300) reciben el BRUTO, no el neto (200).
      expect(await lineasDe(asiento.id)).toEqual([
        { codigo: "1.1.7.04", debe: "500.00", haber: "0.00" },
        { codigo: "4.2.2.01", debe: "0.00", haber: "500.00" },
        { codigo: "5.1.1.02", debe: "300.00", haber: "0.00" },
        { codigo: "1.1.7.04", debe: "0.00", haber: "300.00" },
      ]);
    });

    it("FALTA con responsable sin cuentaPorCobrarId: error CUENTA_INVALIDA", async () => {
      await expect(
        tx((t) =>
          crearAsientoDivergencia(
            { ...base, faltaMonto: "750.00", causa: "FABRICA_ORIGEM", ubicacion: "DEPOSITO_FISCAL" },
            t,
          ),
        ),
      ).rejects.toMatchObject({ code: "CUENTA_INVALIDA" });
    });

    it("rechaza sin faltante ni sobrante (ambos <= 0)", async () => {
      await expect(
        tx((t) =>
          crearAsientoDivergencia(
            {
              causa: "NAO_IDENTIFICADA",
              ubicacion: "ZONA_PRIMARIA",
              faltaMonto: "0",
              sobraMonto: "-10",
              fecha: FECHA,
            },
            t,
          ),
        ),
      ).rejects.toMatchObject({ code: "LINEA_INVALIDA" });
    });

    it("ubicacion ZONA_PRIMARIA usa 1.1.7.03 en SOBRA", async () => {
      const asiento = await tx((t) =>
        crearAsientoDivergencia(
          { ...base, sobraMonto: "750.00", causa: "NAO_IDENTIFICADA", ubicacion: "ZONA_PRIMARIA" },
          t,
        ),
      );
      const lineas = await lineasDe(asiento.id);
      expect(lineas[0]?.codigo).toBe("1.1.7.03");
    });
  });
});
