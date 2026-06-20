import { describe, expect, it } from "vitest";

import { serializarSnapshot } from "@/lib/auditoria-snapshot";

// Mock estructural de Prisma.Decimal: un objeto con toFixed()/toString(). El
// serializador lo detecta por duck-typing (no importa Prisma) y lo pasa a
// string vía toString().
function decimalMock(value: string) {
  return {
    toFixed: (dp?: number) => (dp != null ? Number(value).toFixed(dp) : value),
    toString: () => value,
  };
}

describe("serializarSnapshot", () => {
  it("Date → ISO string", () => {
    const fecha = new Date("2026-06-20T15:30:00.000Z");
    expect(serializarSnapshot({ fecha })).toEqual({ fecha: "2026-06-20T15:30:00.000Z" });
  });

  it("Decimal (duck-typed por toFixed) → string vía toString", () => {
    expect(serializarSnapshot({ total: decimalMock("1234.56") })).toEqual({ total: "1234.56" });
  });

  it("null y undefined → null", () => {
    expect(serializarSnapshot({ a: null, b: undefined })).toEqual({ a: null, b: null });
  });

  it("escalares (string/number/boolean) pasan intactos", () => {
    expect(serializarSnapshot({ numero: "V-001", dias: 30, activo: true })).toEqual({
      numero: "V-001",
      dias: 30,
      activo: true,
    });
  });

  it("registro mixto tipo Venta queda JSON-safe", () => {
    const snap = serializarSnapshot({
      numero: "V-0001",
      clienteId: "uuid-cli",
      estado: "EMITIDA",
      moneda: "USD",
      fecha: new Date("2026-06-20T00:00:00.000Z"),
      total: decimalMock("9999.99"),
      tipoCambio: decimalMock("1.000000"),
    });
    expect(snap).toEqual({
      numero: "V-0001",
      clienteId: "uuid-cli",
      estado: "EMITIDA",
      moneda: "USD",
      fecha: "2026-06-20T00:00:00.000Z",
      total: "9999.99",
      tipoCambio: "1.000000",
    });
    // Todos los valores son JSON-safe (sin objetos Date/Decimal residuales).
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
  });
});
