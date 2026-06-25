import { describe, expect, it } from "vitest";
import { DimensionPermiso, TipoAprobacion } from "@/generated/prisma/enums";
import { PERMISOS, PERMISSION_CATALOG } from "@/lib/permisos-catalog";
import {
  ESCALONAMIENTO_DEFAULT,
  getConfigAprobacion,
  MATRIZ_APROBACION,
} from "./aprobaciones-matriz";

const dimensionDe = new Map(PERMISSION_CATALOG.map((e) => [e.clave, e.dimension]));
const TIPOS = Object.values(TipoAprobacion);

// Franjas que exigen dupla aprobación según ANEXO A.3 (las marcadas "(dupla)").
const DUPLA = new Set<string>([
  TipoAprobacion.MARGEN_BAJA_MAYOR_10,
  TipoAprobacion.LIMITE_EXCEDIDO_MAYOR_20,
  TipoAprobacion.PAGO_ALTO_VALOR,
  TipoAprobacion.AJUSTE_STOCK_MAYOR_5,
  TipoAprobacion.REAPERTURA_COSTO_COMEX,
]);

// SLA por tipo según ANEXO B.
const SLA: Record<string, number> = {
  CLIENTE_BLOQUEADO: 24,
  MARGEN_BAJA_5: 48,
  MARGEN_BAJA_10: 48,
  MARGEN_BAJA_MAYOR_10: 48,
  LIMITE_EXCEDIDO_20: 48,
  LIMITE_EXCEDIDO_MAYOR_20: 48,
  PLAZO_ESPECIAL: 48,
  DESCUENTO_ESPECIAL_10: 48,
  PAGO_NORMAL: 72,
  PAGO_ALTO_VALOR: 4,
  COSTO_COMEX_MAYOR_10: 48,
  AJUSTE_STOCK_5: 24,
  AJUSTE_STOCK_MAYOR_5: 24,
  REAPERTURA_COSTO_COMEX: 24,
  REAPERTURA_PERIODO_CONTABLE: 24,
  LANZAMIENTO_MANUAL_CONTABLE: 24,
  ANULAR_VENTA_FACTURADA: 48,
  CANCELAR_PROCESO_COMEX: 48,
};

describe("MATRIZ_APROBACION — completitud y parity con el catálogo", () => {
  it("tiene exactamente una entrada por cada TipoAprobacion", () => {
    for (const t of TIPOS) {
      expect(MATRIZ_APROBACION[t]?.tipo).toBe(t);
    }
    expect(Object.keys(MATRIZ_APROBACION)).toHaveLength(TIPOS.length);
  });

  it("permisoAprobacion de cada tipo existe en el catálogo con dimensión APROBACION", () => {
    for (const t of TIPOS) {
      expect(dimensionDe.get(MATRIZ_APROBACION[t].permisoAprobacion)).toBe(
        DimensionPermiso.APROBACION,
      );
    }
  });

  it("cada clave de escalonamiento existe en el catálogo con dimensión APROBACION", () => {
    for (const t of TIPOS) {
      for (const clave of MATRIZ_APROBACION[t].escalonamiento) {
        expect(dimensionDe.get(clave)).toBe(DimensionPermiso.APROBACION);
      }
    }
  });

  it("ESCALONAMIENTO_DEFAULT es [Diretor, Master]", () => {
    expect([...ESCALONAMIENTO_DEFAULT]).toEqual([
      PERMISOS.APROBAR_ESCALAR_DIRECTOR,
      PERMISOS.APROBAR_MASTER_OVERRIDE,
    ]);
  });
});

describe("MATRIZ_APROBACION — SLA (ANEXO B) y dupla (ANEXO A.3)", () => {
  it("el SLA de cada tipo coincide con ANEXO B", () => {
    for (const t of TIPOS) {
      expect(MATRIZ_APROBACION[t].slaHoras).toBe(SLA[t]);
    }
  });

  it("requiereDupla es true exactamente en las 5 franjas de dupla", () => {
    for (const t of TIPOS) {
      expect(MATRIZ_APROBACION[t].requiereDupla).toBe(DUPLA.has(t));
    }
  });

  it("autoMasterOverride es false en todos los tipos (terminal EXPIRADA)", () => {
    for (const t of TIPOS) {
      expect(MATRIZ_APROBACION[t].autoMasterOverride).toBe(false);
    }
  });

  it("getConfigAprobacion devuelve la config del tipo solicitado", () => {
    expect(getConfigAprobacion(TipoAprobacion.PAGO_ALTO_VALOR).slaHoras).toBe(4);
    expect(getConfigAprobacion(TipoAprobacion.PAGO_ALTO_VALOR).requiereDupla).toBe(true);
  });
});
