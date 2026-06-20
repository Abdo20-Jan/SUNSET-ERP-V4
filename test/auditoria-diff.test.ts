import { describe, expect, it } from "vitest";

import { diffAuditoria } from "@/lib/auditoria-diff";

describe("diffAuditoria", () => {
  it("UPDATE: sólo los campos que cambiaron", () => {
    const antes = { nombre: "ACME", email: "a@x.com", estado: "activo" };
    const nuevos = { nombre: "ACME SA", email: "a@x.com", estado: "activo" };
    expect(diffAuditoria(antes, nuevos)).toEqual([
      { campo: "nombre", antes: "ACME", despues: "ACME SA" },
    ]);
  });

  it("CREATE (anteriores null): todos los campos como altas (antes=null)", () => {
    const nuevos = { nombre: "ACME", cuit: "20-1-3" };
    expect(diffAuditoria(null, nuevos)).toEqual([
      { campo: "nombre", antes: null, despues: "ACME" },
      { campo: "cuit", antes: null, despues: "20-1-3" },
    ]);
  });

  it("DELETE (nuevos null): todos los campos como bajas (despues=null)", () => {
    const antes = { nombre: "ACME", cuit: "20-1-3" };
    expect(diffAuditoria(antes, null)).toEqual([
      { campo: "nombre", antes: "ACME", despues: null },
      { campo: "cuit", antes: "20-1-3", despues: null },
    ]);
  });

  it("sin cambios → []", () => {
    const obj = { nombre: "ACME", email: null };
    expect(diffAuditoria(obj, obj)).toEqual([]);
  });

  it("null vs valor y valor vs null por campo", () => {
    const antes = { email: null, telefono: "123" };
    const nuevos = { email: "n@x.com", telefono: null };
    expect(diffAuditoria(antes, nuevos)).toEqual([
      { campo: "email", antes: null, despues: "n@x.com" },
      { campo: "telefono", antes: "123", despues: null },
    ]);
  });

  it("números y booleanos se formatean como string", () => {
    const antes = { dias: 30, activo: true };
    const nuevos = { dias: 45, activo: false };
    expect(diffAuditoria(antes, nuevos)).toEqual([
      { campo: "dias", antes: "30", despues: "45" },
      { campo: "activo", antes: "true", despues: "false" },
    ]);
  });

  it("entradas no-objeto → []", () => {
    expect(diffAuditoria(null, null)).toEqual([]);
    expect(diffAuditoria("basura", 42)).toEqual([]);
  });
});
