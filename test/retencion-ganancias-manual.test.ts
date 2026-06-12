import { describe, expect, it, vi } from "vitest";
import Decimal from "decimal.js";

// `construirRetencionManualParaPago` usa el `dbc` inyectado (default `db`),
// así que para testear la lógica pura basta con un stub de Prisma. Mockeamos
// `@/lib/db` para que el import del módulo no instancie el cliente real.
vi.mock("@/lib/db", () => ({ db: {} }));

import { construirRetencionManualParaPago } from "@/lib/services/retencion-ganancias-pago";
import {
  type CondicionGanancias,
  Moneda,
  MovimientoTesoreriaTipo,
} from "@/generated/prisma/client";

type Dbc = Parameters<typeof construirRetencionManualParaPago>[1];

function proveedorRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "prov-1",
    nombre: "ACME SRL",
    cuit: "30-11111111-9",
    cuentaContableId: 100,
    sujetoRetencionGanancias: false, // manual NO exige que esté marcado
    condicionGanancias: "INSCRIPTO" as CondicionGanancias,
    conceptoRG830: null,
    alicuotaRetencionGananciasOverride: null,
    certificadoExclusionGanancias: null,
    vigenciaCertExclusionGanancias: null,
    ...over,
  };
}

// dbc que devuelve `rows` en proveedor.findMany.
function makeDbc(rows: unknown[]): Dbc {
  return {
    proveedor: { findMany: vi.fn(async () => rows) },
  } as unknown as Dbc;
}

const BASE_ARGS = {
  tipo: MovimientoTesoreriaTipo.PAGO,
  moneda: Moneda.ARS,
  lineas: [{ cuentaContableId: 100 }],
  base: new Decimal("100000"),
  importeRetenido: new Decimal("2000"),
  concepto: "BIENES_DE_CAMBIO" as const,
};

describe("construirRetencionManualParaPago", () => {
  it("calcula la retención manual para cualquier proveedor (no requiere sujeto)", async () => {
    const ctx = await construirRetencionManualParaPago(BASE_ARGS, makeDbc([proveedorRow()]));
    expect(ctx).not.toBeNull();
    expect(ctx!.proveedor.id).toBe("prov-1");
    expect(ctx!.cuentaProveedorId).toBe(100);
    expect(ctx!.parametroSnapshot).toBeNull();
    const r = ctx!.resultado;
    expect(r.aplica).toBe(true);
    expect(r.concepto).toBe("BIENES_DE_CAMBIO");
    expect(r.condicion).toBe("INSCRIPTO");
    expect(r.importeRetenido.toFixed(2)).toBe("2000.00");
    expect(r.importeNetoAPagar.toFixed(2)).toBe("98000.00");
    // alícuota implícita = 2000 / 100000 * 100 = 2%
    expect(r.alicuota.toString()).toBe("2");
    expect(r.montoFijo.toFixed(2)).toBe("0.00");
  });

  it("usa la condición del proveedor para el certificado", async () => {
    const ctx = await construirRetencionManualParaPago(
      BASE_ARGS,
      makeDbc([proveedorRow({ condicionGanancias: "NO_INSCRIPTO" })]),
    );
    expect(ctx!.resultado.condicion).toBe("NO_INSCRIPTO");
  });

  it("devuelve null si no es PAGO", async () => {
    const ctx = await construirRetencionManualParaPago(
      { ...BASE_ARGS, tipo: MovimientoTesoreriaTipo.COBRO },
      makeDbc([proveedorRow()]),
    );
    expect(ctx).toBeNull();
  });

  it("devuelve null si no es ARS", async () => {
    const ctx = await construirRetencionManualParaPago(
      { ...BASE_ARGS, moneda: Moneda.USD },
      makeDbc([proveedorRow()]),
    );
    expect(ctx).toBeNull();
  });

  it("devuelve null si el importe es <= 0", async () => {
    const ctx = await construirRetencionManualParaPago(
      { ...BASE_ARGS, importeRetenido: new Decimal("0") },
      makeDbc([proveedorRow()]),
    );
    expect(ctx).toBeNull();
  });

  it("devuelve null si el importe es >= base (no deja neto)", async () => {
    const ctx = await construirRetencionManualParaPago(
      { ...BASE_ARGS, importeRetenido: new Decimal("100000") },
      makeDbc([proveedorRow()]),
    );
    expect(ctx).toBeNull();
  });

  it("devuelve null si hay más de una cuenta de contrapartida", async () => {
    const ctx = await construirRetencionManualParaPago(
      { ...BASE_ARGS, lineas: [{ cuentaContableId: 100 }, { cuentaContableId: 200 }] },
      makeDbc([proveedorRow()]),
    );
    expect(ctx).toBeNull();
  });

  it("devuelve null si la cuenta no mapea a exactamente un proveedor", async () => {
    const ninguno = await construirRetencionManualParaPago(BASE_ARGS, makeDbc([]));
    expect(ninguno).toBeNull();
    const dos = await construirRetencionManualParaPago(
      BASE_ARGS,
      makeDbc([proveedorRow(), proveedorRow({ id: "prov-2" })]),
    );
    expect(dos).toBeNull();
  });
});
