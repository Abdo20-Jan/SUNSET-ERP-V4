import { describe, expect, it } from "vitest";

import { resolverRutaAuditada } from "@/lib/services/auditoria-rutas";

describe("resolverRutaAuditada", () => {
  it("mapea tablas con ficha a su ruta de drill-down", () => {
    expect(resolverRutaAuditada("Cliente", "c1")).toBe("/maestros/clientes/c1");
    expect(resolverRutaAuditada("Proveedor", "p2")).toBe("/maestros/proveedores/p2");
    expect(resolverRutaAuditada("Deposito", "d3")).toBe("/maestros/depositos/d3");
    expect(resolverRutaAuditada("Venta", "v9")).toBe("/ventas/v9");
  });

  it("la tabla de usuarios se audita como 'User' (no 'Usuario')", () => {
    expect(resolverRutaAuditada("User", "u3")).toBe("/sistema/usuarios/u3");
    expect(resolverRutaAuditada("Usuario", "u3")).toBeNull();
  });

  it("Producto no tiene ficha [id] → null (texto plano)", () => {
    expect(resolverRutaAuditada("Producto", "x")).toBeNull();
  });

  it("meta-evento de export y tablas desconocidas → null", () => {
    expect(resolverRutaAuditada("AuditLog", "export")).toBeNull();
    expect(resolverRutaAuditada("Desconocida", "1")).toBeNull();
  });
});
