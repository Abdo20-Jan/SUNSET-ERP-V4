import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// Integración del flujo de PAGO con retención de Ganancias (RG 830).
//
// Verifica que `crearMovimientoTesoreriaAction`, con la flag prendida y un
// proveedor sujeto, produzca:
//   - asiento DEBE proveedor (bruto) / HABER banco (neto) / HABER 2.1.3.07 (ret.)
//   - MovimientoTesoreria.monto = neto (salida real de caja)
//   - RetencionPracticada con snapshot + certificado + AuditLog
//   - proveedor cancelado por el BRUTO (AplicacionPago = bruto)
// y que, con la flag apagada o proveedor no sujeto, el flujo sea idéntico
// al actual (sin retención, sin registros nuevos).

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

import { crearMovimientoTesoreriaAction } from "@/lib/actions/movimientos-tesoreria";
import { anularRetencionGananciasAction } from "@/lib/actions/retenciones";
import { anularAsiento } from "@/lib/services/asiento-automatico";

const FECHA = new Date("2026-06-09T12:00:00.000Z");

interface Seed {
  cuentaBancariaId: string;
  cuentaBancoId: number;
  cuentaProveedorId: number;
  proveedorId: string;
  compraId: string;
}

const RESET_TABLES = [
  "AuditLog",
  "RetencionPracticada",
  "ParametroRetencion",
  "AplicacionPagoCompra",
  "AplicacionPagoEmbarqueCosto",
  "AplicacionPagoGasto",
  "MovimientoTesoreria",
  "LineaAsiento",
  "Asiento",
  "ItemCompra",
  "Compra",
  "CuentaBancaria",
  "Proveedor",
  "PeriodoContable",
  "CuentaContable",
  "User",
] as const;

describe("crearMovimientoTesoreriaAction — retención Ganancias (RG 830)", () => {
  let db: TestDb;
  const ENV_PREVIO = process.env.RETENCION_GANANCIAS_ENABLED;

  beforeAll(async () => {
    db = await createTestDb();
    h.setClient(db.prisma);
  });

  afterAll(async () => {
    await db?.stop();
    process.env.RETENCION_GANANCIAS_ENABLED = ENV_PREVIO;
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await db.reset(RESET_TABLES);
  });

  afterEach(() => {
    process.env.RETENCION_GANANCIAS_ENABLED = ENV_PREVIO;
  });

  async function seed(
    over: {
      sujeto?: boolean;
      condicion?: "INSCRIPTO" | "NO_INSCRIPTO" | "MONOTRIBUTO" | "EXENTO";
      concepto?: "BIENES_DE_CAMBIO" | "HONORARIOS" | null;
      conParametro?: boolean;
    } = {},
  ): Promise<Seed> {
    const {
      sujeto = true,
      condicion = "INSCRIPTO",
      concepto = "BIENES_DE_CAMBIO",
      conParametro = true,
    } = over;

    await db.prisma.user.create({
      data: {
        id: "user-uuid",
        username: "tester",
        passwordHash: "x",
        nombre: "Tester",
        role: "ADMIN",
      },
    });

    await db.prisma.periodoContable.create({
      data: {
        codigo: "2026-06",
        nombre: "Junio 2026",
        fechaInicio: new Date("2026-06-01T00:00:00.000Z"),
        fechaFin: new Date("2026-06-30T23:59:59.000Z"),
        estado: "ABIERTO",
      },
    });

    const cuentaBanco = await db.prisma.cuentaContable.create({
      data: {
        codigo: "1.1.2.01",
        nombre: "BANCO SANTANDER ARS",
        tipo: "ANALITICA",
        categoria: "ACTIVO",
        nivel: 4,
      },
    });
    const cuentaProveedor = await db.prisma.cuentaContable.create({
      data: {
        codigo: "2.1.1.10",
        nombre: "PROVEEDOR MERCADERÍA SA",
        tipo: "ANALITICA",
        categoria: "PASIVO",
        nivel: 4,
      },
    });

    const cuentaBancaria = await db.prisma.cuentaBancaria.create({
      data: {
        banco: "Santander",
        tipo: "CUENTA_CORRIENTE",
        moneda: "ARS",
        numero: "0001",
        cuentaContableId: cuentaBanco.id,
      },
    });

    const proveedor = await db.prisma.proveedor.create({
      data: {
        nombre: "MERCADERÍA SA",
        cuit: "30-11111111-7",
        tipoProveedor: "MERCADERIA_LOCAL",
        pais: "AR",
        cuentaContableId: cuentaProveedor.id,
        sujetoRetencionGanancias: sujeto,
        condicionGanancias: condicion,
        conceptoRG830: concepto,
      },
    });

    const compra = await db.prisma.compra.create({
      data: {
        numero: "C-2026-0001",
        proveedorId: proveedor.id,
        fecha: FECHA,
        moneda: "ARS",
        tipoCambio: "1",
        subtotal: "247933.88",
        iva: "52066.12",
        iibb: "0",
        otros: "0",
        total: "300000.00",
        estado: "EMITIDA",
      },
    });

    if (conParametro && concepto) {
      await db.prisma.parametroRetencion.create({
        data: {
          tipo: "GANANCIAS",
          regimen: "RG_830",
          concepto,
          condicion,
          minimoNoSujeto: "224000.00",
          montoFijo: "0",
          alicuota: "2",
          vigenciaDesde: new Date("2024-01-01T00:00:00.000Z"),
          activo: true,
        },
      });
    }

    return {
      cuentaBancariaId: cuentaBancaria.id,
      cuentaBancoId: cuentaBanco.id,
      cuentaProveedorId: cuentaProveedor.id,
      proveedorId: proveedor.id,
      compraId: compra.id,
    };
  }

  async function lineasDe(asientoId: string) {
    return db.prisma.lineaAsiento.findMany({
      where: { asientoId },
      include: { cuenta: { select: { codigo: true, categoria: true } } },
      orderBy: { id: "asc" },
    });
  }

  // ============================================================
  // Caso central — retención aplica
  // ============================================================

  it("paga con retención: bruto a proveedor, neto a banco, retención a 2.1.3.07", async () => {
    process.env.RETENCION_GANANCIAS_ENABLED = "true";
    const s = await seed();

    const res = await crearMovimientoTesoreriaAction({
      tipo: "PAGO",
      cuentaBancariaId: s.cuentaBancariaId,
      fecha: FECHA,
      moneda: "ARS",
      tipoCambio: "1",
      lineas: [
        {
          cuentaContableId: s.cuentaProveedorId,
          monto: "300000.00",
          descripcion: "Pago factura C-2026-0001",
          appliedTo: [{ tipo: "compra", id: s.compraId, montoArs: "300000.00" }],
        },
      ],
      descripcion: "Pago factura C-2026-0001",
    });
    if (!res.ok) throw new Error(`pago falló: ${res.error}`);

    // base 300.000 − mínimo 224.000 = 76.000 × 2% = 1.520 → neto 298.480
    const lineas = await lineasDe(res.asientoId);
    expect(lineas).toHaveLength(3);

    const debeProv = lineas.find((l) => l.cuenta.codigo === "2.1.1.10");
    const haberBanco = lineas.find((l) => l.cuenta.codigo === "1.1.2.01");
    const haberRet = lineas.find((l) => l.cuenta.codigo === "2.1.3.07");

    expect(Number(debeProv?.debe)).toBeCloseTo(300000, 2);
    expect(Number(haberBanco?.haber)).toBeCloseTo(298480, 2);
    expect(Number(haberRet?.haber)).toBeCloseTo(1520, 2);
    expect(haberRet?.cuenta.categoria).toBe("PASIVO");

    // asiento balanceado
    const totalDebe = lineas.reduce((s2, l) => s2 + Number(l.debe), 0);
    const totalHaber = lineas.reduce((s2, l) => s2 + Number(l.haber), 0);
    expect(Math.abs(totalDebe - totalHaber)).toBeLessThan(0.005);

    // movimiento = neto (salida real de caja)
    const mov = await db.prisma.movimientoTesoreria.findUniqueOrThrow({
      where: { id: res.movimientoId },
    });
    expect(Number(mov.monto)).toBeCloseTo(298480, 2);

    // RetencionPracticada
    const ret = await db.prisma.retencionPracticada.findUniqueOrThrow({
      where: { movimientoTesoreriaId: res.movimientoId },
    });
    expect(Number(ret.base)).toBeCloseTo(300000, 2);
    expect(Number(ret.importeRetenido)).toBeCloseTo(1520, 2);
    expect(Number(ret.minimoNoSujeto)).toBeCloseTo(224000, 2);
    expect(Number(ret.alicuota)).toBeCloseTo(2, 4);
    expect(ret.estado).toBe("PENDIENTE_ARCA");
    expect(ret.certificadoNumero).toBe("RET-GAN-2026-000001");
    expect(ret.proveedorId).toBe(s.proveedorId);
    expect(ret.parametrosSnapshot).toBeTruthy();
    // vencimiento ARCA = fecha + 15 días
    expect(ret.fechaVencimientoArca.toISOString().slice(0, 10)).toBe("2026-06-24");

    // proveedor cancelado por el BRUTO (no por el neto)
    const apl = await db.prisma.aplicacionPagoCompra.findFirstOrThrow({
      where: { compraId: s.compraId },
    });
    expect(Number(apl.montoArs)).toBeCloseTo(300000, 2);

    // auditoría
    const audit = await db.prisma.auditLog.findFirst({
      where: { tabla: "RetencionPracticada", accion: "CREATE", registroId: ret.id },
    });
    expect(audit).toBeTruthy();
    expect(audit?.usuarioId).toBe("user-uuid");
  });

  // ============================================================
  // Acumulado mensual
  // ============================================================

  it("acumulado mensual: 1er pago bajo mínimo no retiene; 2do cruza y retiene el excedente", async () => {
    process.env.RETENCION_GANANCIAS_ENABLED = "true";
    const s = await seed();

    // Pago 1: 200.000 < 224.000 → sin retención
    const r1 = await crearMovimientoTesoreriaAction({
      tipo: "PAGO",
      cuentaBancariaId: s.cuentaBancariaId,
      fecha: FECHA,
      moneda: "ARS",
      tipoCambio: "1",
      lineas: [{ cuentaContableId: s.cuentaProveedorId, monto: "200000.00" }],
    });
    if (!r1.ok) throw new Error(r1.error);
    expect(await db.prisma.retencionPracticada.count()).toBe(0);
    const mov1 = await db.prisma.movimientoTesoreria.findUniqueOrThrow({
      where: { id: r1.movimientoId },
    });
    expect(Number(mov1.monto)).toBeCloseTo(200000, 2);

    // Pago 2: +100.000 → acumulado 300.000, excedente 76.000 × 2% = 1.520
    const r2 = await crearMovimientoTesoreriaAction({
      tipo: "PAGO",
      cuentaBancariaId: s.cuentaBancariaId,
      fecha: FECHA,
      moneda: "ARS",
      tipoCambio: "1",
      lineas: [{ cuentaContableId: s.cuentaProveedorId, monto: "100000.00" }],
    });
    if (!r2.ok) throw new Error(r2.error);

    const ret = await db.prisma.retencionPracticada.findUniqueOrThrow({
      where: { movimientoTesoreriaId: r2.movimientoId },
    });
    expect(Number(ret.baseAcumuladaMesPrevio)).toBeCloseTo(200000, 2);
    expect(Number(ret.importeRetenido)).toBeCloseTo(1520, 2);
  });

  // ============================================================
  // No aplica
  // ============================================================

  it("flag ON pero proveedor NO sujeto → sin retención, flujo normal (2 líneas)", async () => {
    process.env.RETENCION_GANANCIAS_ENABLED = "true";
    const s = await seed({ sujeto: false });

    const res = await crearMovimientoTesoreriaAction({
      tipo: "PAGO",
      cuentaBancariaId: s.cuentaBancariaId,
      fecha: FECHA,
      moneda: "ARS",
      tipoCambio: "1",
      lineas: [{ cuentaContableId: s.cuentaProveedorId, monto: "300000.00" }],
    });
    if (!res.ok) throw new Error(res.error);

    expect(await db.prisma.retencionPracticada.count()).toBe(0);
    const lineas = await lineasDe(res.asientoId);
    expect(lineas).toHaveLength(2);
    const mov = await db.prisma.movimientoTesoreria.findUniqueOrThrow({
      where: { id: res.movimientoId },
    });
    expect(Number(mov.monto)).toBeCloseTo(300000, 2);
  });

  it("flag ON, proveedor MONOTRIBUTO → sin retención", async () => {
    process.env.RETENCION_GANANCIAS_ENABLED = "true";
    const s = await seed({ condicion: "MONOTRIBUTO" });

    const res = await crearMovimientoTesoreriaAction({
      tipo: "PAGO",
      cuentaBancariaId: s.cuentaBancariaId,
      fecha: FECHA,
      moneda: "ARS",
      tipoCambio: "1",
      lineas: [{ cuentaContableId: s.cuentaProveedorId, monto: "300000.00" }],
    });
    if (!res.ok) throw new Error(res.error);
    expect(await db.prisma.retencionPracticada.count()).toBe(0);
  });

  it("flag ON pero base bajo el mínimo → sin retención", async () => {
    process.env.RETENCION_GANANCIAS_ENABLED = "true";
    const s = await seed();

    const res = await crearMovimientoTesoreriaAction({
      tipo: "PAGO",
      cuentaBancariaId: s.cuentaBancariaId,
      fecha: FECHA,
      moneda: "ARS",
      tipoCambio: "1",
      lineas: [{ cuentaContableId: s.cuentaProveedorId, monto: "100000.00" }],
    });
    if (!res.ok) throw new Error(res.error);
    expect(await db.prisma.retencionPracticada.count()).toBe(0);
  });

  // ============================================================
  // Regresión — flag OFF byte-idéntico
  // ============================================================

  it("flag OFF: proveedor sujeto pero sin retención (flujo legacy intacto)", async () => {
    process.env.RETENCION_GANANCIAS_ENABLED = "false";
    const s = await seed();

    const res = await crearMovimientoTesoreriaAction({
      tipo: "PAGO",
      cuentaBancariaId: s.cuentaBancariaId,
      fecha: FECHA,
      moneda: "ARS",
      tipoCambio: "1",
      lineas: [{ cuentaContableId: s.cuentaProveedorId, monto: "300000.00" }],
    });
    if (!res.ok) throw new Error(res.error);

    expect(await db.prisma.retencionPracticada.count()).toBe(0);
    const lineas = await lineasDe(res.asientoId);
    expect(lineas).toHaveLength(2);
    const mov = await db.prisma.movimientoTesoreria.findUniqueOrThrow({
      where: { id: res.movimientoId },
    });
    expect(Number(mov.monto)).toBeCloseTo(300000, 2);
    // no se creó la cuenta 2.1.3.07
    const cuentaRet = await db.prisma.cuentaContable.findUnique({
      where: { codigo: "2.1.3.07" },
    });
    expect(cuentaRet).toBeNull();
  });

  it("COBRO con flag ON no dispara retención (sólo PAGO)", async () => {
    process.env.RETENCION_GANANCIAS_ENABLED = "true";
    const s = await seed();

    const res = await crearMovimientoTesoreriaAction({
      tipo: "COBRO",
      cuentaBancariaId: s.cuentaBancariaId,
      fecha: FECHA,
      moneda: "ARS",
      tipoCambio: "1",
      lineas: [{ cuentaContableId: s.cuentaProveedorId, monto: "300000.00" }],
    });
    if (!res.ok) throw new Error(res.error);
    expect(await db.prisma.retencionPracticada.count()).toBe(0);
  });

  // ============================================================
  // Anulación de retención + cascada al anular el asiento de pago
  // ============================================================

  async function pagarConRetencion(s: Seed): Promise<{ movimientoId: string; asientoId: string }> {
    const res = await crearMovimientoTesoreriaAction({
      tipo: "PAGO",
      cuentaBancariaId: s.cuentaBancariaId,
      fecha: FECHA,
      moneda: "ARS",
      tipoCambio: "1",
      lineas: [{ cuentaContableId: s.cuentaProveedorId, monto: "300000.00" }],
    });
    if (!res.ok) throw new Error(res.error);
    return { movimientoId: res.movimientoId, asientoId: res.asientoId };
  }

  it("anular el asiento de pago marca la retención ANULADA (no sobre-reporta a ARCA)", async () => {
    process.env.RETENCION_GANANCIAS_ENABLED = "true";
    const s = await seed();
    const { movimientoId, asientoId } = await pagarConRetencion(s);

    await anularAsiento(asientoId);

    const ret = await db.prisma.retencionPracticada.findUniqueOrThrow({
      where: { movimientoTesoreriaId: movimientoId },
    });
    expect(ret.estado).toBe("ANULADA");
    expect(ret.motivoAnulacion).toMatch(/anulación automática/i);
    // El asiento quedó ANULADO → la línea 2.1.3.07 sale del saldo CONTABILIZADO.
    const asiento = await db.prisma.asiento.findUniqueOrThrow({ where: { id: asientoId } });
    expect(asiento.estado).toBe("ANULADO");
  });

  it("anularRetencionGananciasAction: ADMIN anula PENDIENTE_ARCA + AuditLog", async () => {
    process.env.RETENCION_GANANCIAS_ENABLED = "true";
    const s = await seed();
    const { movimientoId } = await pagarConRetencion(s);
    const ret = await db.prisma.retencionPracticada.findUniqueOrThrow({
      where: { movimientoTesoreriaId: movimientoId },
    });

    const r = await anularRetencionGananciasAction({ id: ret.id, motivo: "Error de carga" });
    expect(r.ok).toBe(true);

    const after = await db.prisma.retencionPracticada.findUniqueOrThrow({ where: { id: ret.id } });
    expect(after.estado).toBe("ANULADA");
    expect(after.motivoAnulacion).toBe("Error de carga");
    // importeRetenido NO se modifica (registro inmutable salvo estado/motivo).
    expect(Number(after.importeRetenido)).toBeCloseTo(Number(ret.importeRetenido), 2);

    const audit = await db.prisma.auditLog.findFirst({
      where: { tabla: "RetencionPracticada", accion: "UPDATE", registroId: ret.id },
    });
    expect(audit?.usuarioId).toBe("user-uuid");
  });

  it("anularRetencionGananciasAction: doble anulación → error YA_ANULADA", async () => {
    process.env.RETENCION_GANANCIAS_ENABLED = "true";
    const s = await seed();
    const { movimientoId } = await pagarConRetencion(s);
    const ret = await db.prisma.retencionPracticada.findUniqueOrThrow({
      where: { movimientoTesoreriaId: movimientoId },
    });

    const r1 = await anularRetencionGananciasAction({ id: ret.id, motivo: "primera" });
    expect(r1.ok).toBe(true);
    const r2 = await anularRetencionGananciasAction({ id: ret.id, motivo: "segunda" });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).toMatch(/ya está anulada/i);
  });

  it("anularRetencionGananciasAction: usuario USER (no admin) es rechazado", async () => {
    process.env.RETENCION_GANANCIAS_ENABLED = "true";
    const s = await seed();
    const { movimientoId } = await pagarConRetencion(s);
    const ret = await db.prisma.retencionPracticada.findUniqueOrThrow({
      where: { movimientoTesoreriaId: movimientoId },
    });
    // Degradar el actor a USER (el gate revalida el rol contra la DB).
    await db.prisma.user.update({ where: { id: "user-uuid" }, data: { role: "USER" } });

    const r = await anularRetencionGananciasAction({ id: ret.id, motivo: "intento" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/administrador/i);
    const after = await db.prisma.retencionPracticada.findUniqueOrThrow({ where: { id: ret.id } });
    expect(after.estado).toBe("PENDIENTE_ARCA");
  });
});
