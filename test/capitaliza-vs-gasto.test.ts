import { describe, expect, it } from "vitest";
import type { TipoProveedor } from "@/generated/prisma/client";
import { rangoGastoByTipo } from "@/lib/services/cuenta-auto";
import { GASTO_POR_TIPO_PROVEEDOR } from "@/lib/services/cuenta-registry";

// Rebuild RT9 #2b — regla capitaliza-vs-gasto (RT17 / NIC2).
//
// El discriminador es el `tipoProveedor`: los servicios de IMPORTACIÓN
// (despachante, logística/flete de entrada, almacenaje bonded, gastos
// portuarios, flete internacional) CAPITALIZAN al costo de la mercadería
// (1.1.7.05 Mercaderías en Tránsito) y NO crean cuenta de resultado por
// proveedor. Los gastos de PERÍODO (serv. profesionales, alquileres, IT,
// marketing, otro) siguen siendo egreso de resultado (clases 6/7 en ULTRA).

const IMPORTACION: TipoProveedor[] = [
  "DESPACHANTE",
  "LOGISTICA",
  "ALMACENAJE",
  "GASTOS_PORTUARIOS",
  "SERVICIOS_EXTERIOR",
];
const PERIODO: TipoProveedor[] = [
  "SERVICIOS_PROFESIONALES",
  "ALQUILERES",
  "IT_SOFTWARE",
  "MARKETING",
  "OTRO",
];

describe("capitaliza-vs-gasto — contrapartida del DEBE por tipo de proveedor", () => {
  it("servicios de importación capitalizan a 1.1.7.05 (ACTIVO inventariable)", () => {
    for (const tipo of IMPORTACION) {
      const def = GASTO_POR_TIPO_PROVEEDOR[tipo];
      expect(def.codigo).toBe("1.1.7.05");
      expect(def.categoria).toBe("ACTIVO");
    }
  });

  it("servicios de importación NO crean cuenta de resultado por proveedor (rango null)", () => {
    for (const tipo of IMPORTACION) {
      expect(rangoGastoByTipo(tipo)).toBeNull();
    }
  });

  it("gastos de período son egreso de resultado (clases 6/7) y conservan rango por proveedor", () => {
    for (const tipo of PERIODO) {
      const def = GASTO_POR_TIPO_PROVEEDOR[tipo];
      expect(def.categoria).toBe("EGRESO");
      // ULTRA: comercialización (6) o administración (7), nunca costo (5) ni activo (1).
      expect(/^[67]\./.test(def.codigo)).toBe(true);
      expect(rangoGastoByTipo(tipo)).not.toBeNull();
    }
  });

  it("ningún destino capitalizable cae en una cuenta de resultado (no se expensa un costo de importación)", () => {
    for (const tipo of IMPORTACION) {
      const codigo = GASTO_POR_TIPO_PROVEEDOR[tipo].codigo;
      // Capitaliza al activo (1.x); nunca clase de resultado 5/6/7.
      expect(/^[567]\./.test(codigo)).toBe(false);
    }
  });
});
