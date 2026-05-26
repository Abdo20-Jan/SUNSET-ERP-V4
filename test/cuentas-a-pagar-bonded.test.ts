import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// GAP #5 — CxP "por factura" debe incluir las facturas EMITIDA de embarques
// que NO están CERRADO (flujo bonded: el embarque queda EN_ZONA_PRIMARIA pero
// la factura ZP ya tiene asiento standalone + CxP en el proveedor).
//
// Las dos queries que alimentan la pantalla ("Pago por factura") filtran ahora
// por `EmbarqueCosto.estado IN (EMITIDA, LEGACY_BUNDLED)` en lugar de por el
// estado del embarque. EMITIDA = factura contabilizada (cualquier estado de
// embarque); LEGACY_BUNDLED = legado contabilizado en el cierre. BORRADOR
// (sin asiento) y ANULADA (cancelada) quedan fuera.

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

import {
  getCuentasAPagarPorEmbarque,
  getSaldosPorProveedorConAging,
  listarProveedoresParaIntermediario,
} from "@/lib/services/cuentas-a-pagar";

describe("CxP por factura — facturas EMITIDA en embarques no cerrados (gap #5)", () => {
  let db: TestDb;
  // Secuencia determinística para códigos únicos (evita Math.random — Codacy lo
  // marca como RNG criptográficamente débil, aunque acá sea sólo data de prueba).
  let embSeq = 0;

  beforeAll(async () => {
    db = await createTestDb();
    h.setClient(db.prisma);
  });

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    await db.reset([
      "LineaAsiento",
      "Asiento",
      "EmbarqueCostoLinea",
      "EmbarqueCosto",
      "Embarque",
      "Proveedor",
      "CuentaContable",
      "PeriodoContable",
    ]);
  });

  // Helpers de seed mínimos --------------------------------------------------

  async function seedPeriodo() {
    return db.prisma.periodoContable.create({
      data: {
        codigo: "2026-05",
        nombre: "Mayo 2026",
        fechaInicio: new Date("2026-05-01"),
        fechaFin: new Date("2026-05-31"),
        estado: "ABIERTO",
      },
    });
  }

  async function seedCuenta(codigo: string, categoria: "PASIVO" | "EGRESO") {
    return db.prisma.cuentaContable.create({
      data: {
        codigo,
        nombre: `Cuenta ${codigo}`,
        tipo: "ANALITICA",
        categoria,
        nivel: 4,
      },
    });
  }

  async function seedProveedor(cuentaPasivoId: number) {
    return db.prisma.proveedor.create({
      data: {
        nombre: "Despachante SA",
        tipoProveedor: "DESPACHANTE",
        cuentaContableId: cuentaPasivoId,
      },
    });
  }

  async function seedEmbarque(proveedorId: string, estado: "EN_ZONA_PRIMARIA" | "CERRADO") {
    return db.prisma.embarque.create({
      data: {
        codigo: `EMB-${estado}-${(++embSeq).toString().padStart(5, "0")}`,
        proveedorId,
        moneda: "ARS",
        tipoCambio: "1.000000",
        estado,
      },
    });
  }

  /**
   * Crea un EmbarqueCosto con 1 línea de gasto (subtotal 1000 ARS, sin
   * impuestos → totalArs 1000). Si `emitida`, además crea el asiento standalone
   * que ACREDITA al proveedor (HABER 1000) y debita el gasto — así el saldo
   * vivo de la cuenta del proveedor es 1000 (haber − debe) y la factura
   * aparece en getSaldosPorProveedorConAging.
   */
  async function seedCosto(opts: {
    embarqueId: string;
    proveedorId: string;
    cuentaPasivoId: number;
    cuentaGastoId: number;
    estado: "BORRADOR" | "EMITIDA" | "ANULADA" | "LEGACY_BUNDLED";
    facturaNumero: string;
    periodoId: number;
    asientoNumero: number;
  }) {
    let asientoId: string | undefined;
    // EMITIDA: asiento standalone contabilizado (DEBE gasto / HABER proveedor).
    // LEGACY_BUNDLED: en producción se contabiliza en el cierre; para que su
    // saldo exista en el ledger del proveedor lo modelamos igual con un asiento
    // contabilizado que acredita al proveedor (no setea asientoId en el costo).
    if (opts.estado === "EMITIDA" || opts.estado === "LEGACY_BUNDLED") {
      const asiento = await db.prisma.asiento.create({
        data: {
          numero: opts.asientoNumero,
          fecha: new Date("2026-05-10"),
          descripcion: `Factura ${opts.facturaNumero}`,
          estado: "CONTABILIZADO",
          totalDebe: "1000.00",
          totalHaber: "1000.00",
          origen: "COMEX",
          periodoId: opts.periodoId,
          lineas: {
            create: [
              {
                cuentaId: opts.cuentaGastoId,
                debe: "1000.00",
                haber: "0",
                descripcion: "Gasto ZP",
              },
              {
                cuentaId: opts.cuentaPasivoId,
                debe: "0",
                haber: "1000.00",
                descripcion: `Proveedor — ${opts.facturaNumero}`,
              },
            ],
          },
        },
      });
      // Sólo EMITIDA enlaza el asiento standalone (asientoId @unique).
      if (opts.estado === "EMITIDA") asientoId = asiento.id;
    }

    return db.prisma.embarqueCosto.create({
      data: {
        embarqueId: opts.embarqueId,
        proveedorId: opts.proveedorId,
        moneda: "ARS",
        tipoCambio: "1.000000",
        facturaNumero: opts.facturaNumero,
        fechaFactura: new Date("2026-05-10"),
        estado: opts.estado,
        asientoId,
        lineas: {
          create: [
            {
              tipo: "HONORARIOS_DESPACHANTE",
              cuentaContableGastoId: opts.cuentaGastoId,
              subtotal: "1000.00",
              descripcion: "Honorarios ZP",
            },
          ],
        },
      },
    });
  }

  it("EMITIDA en embarque EN_ZONA_PRIMARIA aparece en ambas vistas (bonded)", async () => {
    const periodo = await seedPeriodo();
    const ctaPasivo = await seedCuenta("2.1.1.01", "PASIVO");
    const ctaGasto = await seedCuenta("1.1.5.04", "EGRESO");
    const prov = await seedProveedor(ctaPasivo.id);
    const emb = await seedEmbarque(prov.id, "EN_ZONA_PRIMARIA");
    await seedCosto({
      embarqueId: emb.id,
      proveedorId: prov.id,
      cuentaPasivoId: ctaPasivo.id,
      cuentaGastoId: ctaGasto.id,
      estado: "EMITIDA",
      facturaNumero: "FC-A-0001",
      periodoId: periodo.id,
      asientoNumero: 1,
    });

    // getCuentasAPagarPorEmbarque
    const porEmbarque = await getCuentasAPagarPorEmbarque();
    const grupo = porEmbarque.find((g) => g.embarqueId === emb.id);
    expect(grupo).toBeDefined();
    expect(grupo?.facturas.map((f) => f.numero)).toContain("FC-A-0001");

    // getSaldosPorProveedorConAging (facturas por proveedor)
    const porProveedor = await getSaldosPorProveedorConAging();
    const pv = porProveedor.find((p) => p.proveedorId === prov.id);
    expect(pv).toBeDefined();
    expect(pv?.facturas.map((f) => f.numero)).toContain("FC-A-0001");
  });

  it("BORRADOR no aparece en ninguna vista", async () => {
    const periodo = await seedPeriodo();
    const ctaPasivo = await seedCuenta("2.1.1.01", "PASIVO");
    const ctaGasto = await seedCuenta("1.1.5.04", "EGRESO");
    const prov = await seedProveedor(ctaPasivo.id);
    const emb = await seedEmbarque(prov.id, "EN_ZONA_PRIMARIA");
    await seedCosto({
      embarqueId: emb.id,
      proveedorId: prov.id,
      cuentaPasivoId: ctaPasivo.id,
      cuentaGastoId: ctaGasto.id,
      estado: "BORRADOR",
      facturaNumero: "FC-B-0001",
      periodoId: periodo.id,
      asientoNumero: 1,
    });

    const porEmbarque = await getCuentasAPagarPorEmbarque();
    expect(porEmbarque.flatMap((g) => g.facturas.map((f) => f.numero))).not.toContain("FC-B-0001");

    const porProveedor = await getSaldosPorProveedorConAging();
    expect(porProveedor.flatMap((p) => p.facturas.map((f) => f.numero))).not.toContain("FC-B-0001");
  });

  it("ANULADA no aparece en ninguna vista", async () => {
    const periodo = await seedPeriodo();
    const ctaPasivo = await seedCuenta("2.1.1.01", "PASIVO");
    const ctaGasto = await seedCuenta("1.1.5.04", "EGRESO");
    const prov = await seedProveedor(ctaPasivo.id);
    const emb = await seedEmbarque(prov.id, "EN_ZONA_PRIMARIA");
    await seedCosto({
      embarqueId: emb.id,
      proveedorId: prov.id,
      cuentaPasivoId: ctaPasivo.id,
      cuentaGastoId: ctaGasto.id,
      estado: "ANULADA",
      facturaNumero: "FC-X-0001",
      periodoId: periodo.id,
      asientoNumero: 1,
    });

    const porEmbarque = await getCuentasAPagarPorEmbarque();
    expect(porEmbarque.flatMap((g) => g.facturas.map((f) => f.numero))).not.toContain("FC-X-0001");

    const porProveedor = await getSaldosPorProveedorConAging();
    expect(porProveedor.flatMap((p) => p.facturas.map((f) => f.numero))).not.toContain("FC-X-0001");
  });

  it("(regresión) LEGACY_BUNDLED en embarque CERRADO sigue apareciendo", async () => {
    const periodo = await seedPeriodo();
    const ctaPasivo = await seedCuenta("2.1.1.01", "PASIVO");
    const ctaGasto = await seedCuenta("1.1.5.04", "EGRESO");
    const prov = await seedProveedor(ctaPasivo.id);
    const emb = await seedEmbarque(prov.id, "CERRADO");
    await seedCosto({
      embarqueId: emb.id,
      proveedorId: prov.id,
      cuentaPasivoId: ctaPasivo.id,
      cuentaGastoId: ctaGasto.id,
      estado: "LEGACY_BUNDLED",
      facturaNumero: "FC-L-0001",
      periodoId: periodo.id,
      asientoNumero: 1,
    });

    const porEmbarque = await getCuentasAPagarPorEmbarque();
    const grupo = porEmbarque.find((g) => g.embarqueId === emb.id);
    expect(grupo).toBeDefined();
    expect(grupo?.facturas.map((f) => f.numero)).toContain("FC-L-0001");

    const porProveedor = await getSaldosPorProveedorConAging();
    const pv = porProveedor.find((p) => p.proveedorId === prov.id);
    expect(pv?.facturas.map((f) => f.numero)).toContain("FC-L-0001");
  });

  // El picker de "beneficiário intermediário" (despachante) debe listar a un
  // proveedor activo con cuenta contable AUNQUE no tenga ninguna factura ni
  // saldo en el sistema — ej: un despachante tipo CYSAR al que se le
  // transfiere para que pague facturas de terceros en nuestro nombre.
  it("listarProveedoresParaIntermediario incluye proveedor activo sin factura/saldo (CYSAR)", async () => {
    const ctaPasivo = await seedCuenta("2.1.1.02", "PASIVO");
    const despachante = await db.prisma.proveedor.create({
      data: {
        nombre: "CYSAR",
        tipoProveedor: "DESPACHANTE",
        cuentaContableId: ctaPasivo.id,
        estado: "activo",
      },
    });

    // No se crea ninguna factura ni asiento para CYSAR → no tiene saldo.
    const saldos = await getSaldosPorProveedorConAging();
    expect(saldos.find((p) => p.proveedorId === despachante.id)).toBeUndefined();

    // Pero el picker de intermediário sí debe listarlo.
    const intermediarios = await listarProveedoresParaIntermediario();
    const cysar = intermediarios.find((p) => p.proveedorId === despachante.id);
    expect(cysar).toBeDefined();
    expect(cysar?.proveedorNombre).toBe("CYSAR");
    expect(cysar?.cuentaContableId).toBe(ctaPasivo.id);
  });

  // Proveedor sin cuenta contable NO puede ser intermediário (no hay dónde
  // imputar el anticipo / saldo pendiente).
  it("listarProveedoresParaIntermediario excluye proveedor sin cuenta contable", async () => {
    const sinCuenta = await db.prisma.proveedor.create({
      data: { nombre: "Sin Cuenta SA", tipoProveedor: "DESPACHANTE", estado: "activo" },
    });

    const intermediarios = await listarProveedoresParaIntermediario();
    expect(intermediarios.find((p) => p.proveedorId === sinCuenta.id)).toBeUndefined();
  });
});
