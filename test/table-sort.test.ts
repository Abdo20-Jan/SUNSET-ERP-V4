import { describe, expect, it } from "vitest";

import { buildOrderBy, parseSortParams, type SortState } from "@/lib/table-sort";

// Helpers PUROS de ordenamiento server-side. El contrato duro es que NUNCA
// llegue a Prisma una key fuera de la allowlist / del fieldMap: `parseSortParams`
// recae al fallback ante cualquier valor inválido y `buildOrderBy` devuelve {}
// si la key no está mapeada (el caller usa entonces su orden por defecto).

const ALLOWED = ["codigo", "nombre", "precio"] as const;
const FALLBACK: SortState = { sort: "codigo", dir: "asc" };

describe("parseSortParams", () => {
  it("sort válido + dir válido → se respetan ambos", () => {
    expect(parseSortParams({ sort: "nombre", dir: "desc" }, ALLOWED, FALLBACK)).toEqual({
      sort: "nombre",
      dir: "desc",
    });
  });

  it("sort fuera de la allowlist → cae al fallback.sort", () => {
    expect(parseSortParams({ sort: "deleteFrom", dir: "asc" }, ALLOWED, FALLBACK)).toEqual({
      sort: "codigo",
      dir: "asc",
    });
  });

  it("sort ausente → cae al fallback.sort", () => {
    expect(parseSortParams({ dir: "desc" }, ALLOWED, FALLBACK)).toEqual({
      sort: "codigo",
      dir: "desc",
    });
  });

  it("dir inválido → cae al fallback.dir", () => {
    expect(parseSortParams({ sort: "nombre", dir: "DESC" }, ALLOWED, FALLBACK)).toEqual({
      sort: "nombre",
      dir: "asc",
    });
  });

  it("dir ausente → cae al fallback.dir", () => {
    expect(parseSortParams({ sort: "precio" }, ALLOWED, FALLBACK)).toEqual({
      sort: "precio",
      dir: "asc",
    });
  });
});

describe("buildOrderBy", () => {
  const FIELD_MAP: Record<string, string> = {
    codigo: "codigo",
    nombre: "nombre",
    precio: "precioVenta",
  };

  it("key permitida → { field: dir } usando el campo mapeado", () => {
    expect(buildOrderBy({ sort: "precio", dir: "desc" }, FIELD_MAP)).toEqual({
      precioVenta: "desc",
    });
  });

  it("key sin mapeo → {} (el caller usa su orden por defecto)", () => {
    expect(buildOrderBy({ sort: "noExiste", dir: "asc" }, FIELD_MAP)).toEqual({});
  });
});
