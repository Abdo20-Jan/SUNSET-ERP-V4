import { describe, expect, it } from "vitest";
import {
  esRangoEjercicioValido,
  rangoEjercicioPorDefecto,
} from "@/app/(dashboard)/contabilidad/periodos/cierre-helpers";

describe("rangoEjercicioPorDefecto", () => {
  it("sin períodos devuelve strings vacíos", () => {
    expect(rangoEjercicioPorDefecto([])).toEqual({ desde: "", hasta: "" });
  });

  it("toma la menor fechaInicio y la mayor fechaFin (YYYY-MM-DD)", () => {
    const periodos = [
      {
        fechaInicio: new Date("2025-03-01T00:00:00.000Z"),
        fechaFin: new Date("2025-03-31T00:00:00.000Z"),
      },
      {
        fechaInicio: new Date("2025-01-01T00:00:00.000Z"),
        fechaFin: new Date("2025-01-31T00:00:00.000Z"),
      },
      {
        fechaInicio: new Date("2025-12-01T00:00:00.000Z"),
        fechaFin: new Date("2025-12-31T00:00:00.000Z"),
      },
    ];
    expect(rangoEjercicioPorDefecto(periodos)).toEqual({
      desde: "2025-01-01",
      hasta: "2025-12-31",
    });
  });

  it("con un único período usa sus propios bordes", () => {
    expect(
      rangoEjercicioPorDefecto([
        {
          fechaInicio: new Date("2024-01-01T00:00:00.000Z"),
          fechaFin: new Date("2024-12-31T00:00:00.000Z"),
        },
      ]),
    ).toEqual({ desde: "2024-01-01", hasta: "2024-12-31" });
  });
});

describe("esRangoEjercicioValido", () => {
  it("rechaza fechas vacías", () => {
    expect(esRangoEjercicioValido("", "2025-12-31")).toBe(false);
    expect(esRangoEjercicioValido("2025-01-01", "")).toBe(false);
    expect(esRangoEjercicioValido("", "")).toBe(false);
  });

  it("acepta desde ≤ hasta", () => {
    expect(esRangoEjercicioValido("2025-01-01", "2025-12-31")).toBe(true);
    expect(esRangoEjercicioValido("2025-06-30", "2025-06-30")).toBe(true);
  });

  it("rechaza desde > hasta", () => {
    expect(esRangoEjercicioValido("2025-12-31", "2025-01-01")).toBe(false);
  });
});
