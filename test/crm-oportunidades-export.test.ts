import { describe, expect, it } from "vitest";

// Proyección de la export auditada de oportunidades (CRM-01 · PR-030):
// native-first (monto/ponderado nativos intactos + columna de presentación
// convertida por fila con `convertirMonto`), próxima acción "YYYY-MM-DD ·
// TIPO" ("" sin pendientes) y fechas YYYY-MM-DD. Columnas con header dinámico
// por moneda de presentación.
import {
  armarWorklistRows,
  buildColumnasExportOportunidades,
  derivarProximaAccionPorOportunidad,
  type OportunidadRow,
  type OportunidadWorklistRow,
  proyectarFilaOportunidad,
} from "@/app/(dashboard)/crm/oportunidades/_components/oportunidades-presentacion";

const TC = "1300";

function op(id: string, over: Partial<OportunidadRow> = {}): OportunidadRow {
  return {
    id,
    numero: `O-2026-${id}`,
    titulo: `Oportunidad ${id}`,
    monto: "1000.00",
    moneda: "USD",
    stageId: "st-1",
    stageNombre: "Prospección",
    stageOrden: 1,
    probabilidad: 50,
    cierreEstimado: new Date("2026-09-30T00:00:00.000Z"),
    estado: "ABIERTA",
    leadId: null,
    leadNombre: null,
    leadEmpresa: null,
    clienteId: "cli-1",
    clienteNombre: "Cliente SA",
    ownerId: "u-1",
    ownerNombre: "Vendedor",
    notas: null,
    createdAt: new Date("2026-07-01T12:34:56.000Z"),
    updatedAt: new Date("2026-07-01T12:34:56.000Z"),
    ...over,
  };
}

function fila(over: Partial<OportunidadRow> = {}, conPendiente = true): OportunidadWorklistRow {
  const pendientes = conPendiente
    ? [
        {
          oportunidadId: "a",
          tipo: "LLAMADA" as const,
          contenido: "Llamar",
          fechaProgramada: new Date("2026-07-15T00:00:00.000Z"),
        },
      ]
    : [];
  const rows = armarWorklistRows([op("a", over)], derivarProximaAccionPorOportunidad(pendientes));
  return rows[0] as OportunidadWorklistRow;
}

describe("proyectarFilaOportunidad", () => {
  it("native-first: USD nativo intacto + presentación ARS × TC (monto y ponderado)", () => {
    const r = proyectarFilaOportunidad(fila(), "ARS", TC);
    expect(r.monedaNativa).toBe("USD");
    expect(r.montoNativo).toBe("1000.00");
    expect(r.montoPres).toBe("1300000.00");
    expect(r.ponderadoNativo).toBe("500.00");
    expect(r.ponderadoPres).toBe("650000.00");
  });

  it("misma moneda: presentación 1 a 1 (no re-convierte)", () => {
    const r = proyectarFilaOportunidad(fila(), "USD", TC);
    expect(r.montoPres).toBe("1000.00");
    expect(r.ponderadoPres).toBe("500.00");
  });

  it("próxima acción 'YYYY-MM-DD · TIPO' y '' cuando no hay pendientes", () => {
    expect(proyectarFilaOportunidad(fila(), "USD", TC).proximaAccion).toBe("2026-07-15 · LLAMADA");
    expect(proyectarFilaOportunidad(fila({}, false), "USD", TC).proximaAccion).toBe("");
  });

  it("fechas YYYY-MM-DD ('' cuando faltan) y vínculo cliente>lead", () => {
    const r = proyectarFilaOportunidad(fila(), "USD", TC);
    expect(r.cierreEstimado).toBe("2026-09-30");
    expect(r.creada).toBe("2026-07-01");
    expect(r.vinculo).toBe("Cliente SA");

    const sinCierre = proyectarFilaOportunidad(fila({ cierreEstimado: null }), "USD", TC);
    expect(sinCierre.cierreEstimado).toBe("");

    const conLead = proyectarFilaOportunidad(
      fila({ clienteId: null, clienteNombre: null, leadId: "l-1", leadEmpresa: "Acme" }),
      "USD",
      TC,
    );
    expect(conLead.vinculo).toBe("Acme");
  });
});

describe("buildColumnasExportOportunidades", () => {
  it("orden canónico + headers dinámicos por moneda de presentación", () => {
    expect(buildColumnasExportOportunidades("USD").map((c) => c.header)).toEqual([
      "N°",
      "Título",
      "Cliente/Lead",
      "Moneda",
      "Monto nativo",
      "Monto (USD)",
      "Stage",
      "Probabilidad %",
      "Ponderado nativo",
      "Ponderado (USD)",
      "Estado",
      "Owner",
      "Próxima acción",
      "Cierre estimado",
      "Creada",
    ]);
    const ars = buildColumnasExportOportunidades("ARS").map((c) => c.header);
    expect(ars).toContain("Monto (ARS)");
    expect(ars).toContain("Ponderado (ARS)");
  });

  it("las columnas leen la fila proyectada (paridad header↔value)", () => {
    const r = proyectarFilaOportunidad(fila(), "ARS", TC);
    const valores = buildColumnasExportOportunidades("ARS").map((c) => c.value(r));
    expect(valores).toEqual([
      "O-2026-a",
      "Oportunidad a",
      "Cliente SA",
      "USD",
      "1000.00",
      "1300000.00",
      "Prospección",
      50,
      "500.00",
      "650000.00",
      "ABIERTA",
      "Vendedor",
      "2026-07-15 · LLAMADA",
      "2026-09-30",
      "2026-07-01",
    ]);
  });
});
