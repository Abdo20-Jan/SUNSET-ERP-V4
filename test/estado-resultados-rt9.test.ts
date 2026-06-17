import { describe, expect, it } from "vitest";
import { Decimal } from "@/lib/decimal";
import { PLAN_RT9 } from "@/lib/services/plan-de-cuentas";
import {
  clasificarSeccionRT9,
  construirEstadoResultadosRT9,
  type LeafResultado,
} from "@/lib/services/reportes/estado-resultados-rt9";

// Rebuild RT9 #4 — Estado de Resultados en el orden de exposición RT9:
//   Ventas Netas − CMV = Resultado Bruto
//   − Comercialización − Administración = Resultado Operativo
//   ± Resultados Financieros y por Tenencia (incl. RECPAM)
//   ± Otros Ingresos y Egresos
//   − Impuesto a las Ganancias = Resultado del Ejercicio
//
// La sección de cada cuenta se deriva del prefijo de código, salvo que la
// cuenta declare un `rubroEECC` explícito — ahí el rubro MANDA sobre el código.

function leaf(p: Partial<LeafResultado> & { codigo: string }): LeafResultado {
  return {
    categoria: p.codigo.startsWith("4") ? "INGRESO" : "EGRESO",
    rubroEECC: null,
    debe: new Decimal(0),
    haber: new Decimal(0),
    ...p,
  };
}

describe("clasificarSeccionRT9 — sección por código", () => {
  it("mapea cada rubro RT9 a su sección", () => {
    expect(clasificarSeccionRT9("4.1.1.01")).toBe("VENTAS");
    expect(clasificarSeccionRT9("4.1.2.01")).toBe("VENTAS"); // deducciones
    expect(clasificarSeccionRT9("5.1.1.01")).toBe("CMV");
    expect(clasificarSeccionRT9("5.2.1.01")).toBe("COMERCIALIZACION");
    expect(clasificarSeccionRT9("5.3.1.01")).toBe("ADMINISTRACION");
    expect(clasificarSeccionRT9("4.3.1.01")).toBe("FINANCIEROS");
    expect(clasificarSeccionRT9("5.8.1.02")).toBe("FINANCIEROS");
    expect(clasificarSeccionRT9("4.2.1.01")).toBe("OTROS");
    expect(clasificarSeccionRT9("5.9.1.01")).toBe("OTROS");
    expect(clasificarSeccionRT9("5.10.1.01")).toBe("GANANCIAS");
  });
});

describe("clasificarSeccionRT9 — rubroEECC manda sobre el código", () => {
  it("usa el rubro explícito aunque el código apunte a otra sección", () => {
    // Código sería CMV, pero el rubro fuerza OTROS.
    expect(clasificarSeccionRT9("5.1.1.01", "Otros Ingresos y Egresos")).toBe("OTROS");
    // Código sin match, sólo el rubro lo clasifica.
    expect(clasificarSeccionRT9("9.9.9.99", "Resultados Financieros y por Tenencia")).toBe(
      "FINANCIEROS",
    );
  });
});

describe("construirEstadoResultadosRT9 — cascada", () => {
  it("encadena Bruto → Operativo → antes de Impuestos → Ejercicio", () => {
    const leaves: LeafResultado[] = [
      leaf({ codigo: "4.1.1.01", haber: new Decimal(1000) }), // ventas
      leaf({ codigo: "4.1.2.01", debe: new Decimal(50) }), // (-) devoluciones
      leaf({ codigo: "5.1.1.01", debe: new Decimal(400) }), // CMV
      leaf({ codigo: "5.2.1.01", debe: new Decimal(100) }), // comercialización
      leaf({ codigo: "5.3.1.01", debe: new Decimal(80) }), // administración
      leaf({ codigo: "4.3.1.02", haber: new Decimal(30) }), // ganancia FX
      leaf({ codigo: "5.8.1.02", debe: new Decimal(10) }), // pérdida FX
      leaf({ codigo: "4.2.1.01", haber: new Decimal(20) }), // otros ingresos
      leaf({ codigo: "5.9.1.01", debe: new Decimal(5) }), // otros egresos
      leaf({ codigo: "5.10.1.01", debe: new Decimal(70) }), // impuesto ganancias
    ];

    const er = construirEstadoResultadosRT9(leaves);

    // Ventas Netas = 1000 − 50 = 950
    const ventas = er.secciones.find((s) => s.id === "VENTAS")!;
    expect(ventas.total.toFixed(2)).toBe("950.00");
    // CMV se expone positivo (magnitud), pero su contribución resta.
    const cmv = er.secciones.find((s) => s.id === "CMV")!;
    expect(cmv.montoExpuesto.toFixed(2)).toBe("400.00");

    expect(er.resultadoBruto.toFixed(2)).toBe("550.00"); // 950 − 400
    expect(er.resultadoOperativo.toFixed(2)).toBe("370.00"); // 550 − 100 − 80
    // Financieros netos = 30 − 10 = 20; Otros = 20 − 5 = 15
    expect(er.resultadoAntesImpuestos.toFixed(2)).toBe("405.00"); // 370 + 20 + 15
    expect(er.resultadoEjercicio.toFixed(2)).toBe("335.00"); // 405 − 70
  });

  it("el resultado del ejercicio iguala Σ(haber − debe) de todas las cuentas", () => {
    const leaves: LeafResultado[] = [
      leaf({ codigo: "4.1.1.01", haber: new Decimal(1234.56) }),
      leaf({ codigo: "5.1.1.01", debe: new Decimal(789.01) }),
      leaf({ codigo: "5.3.1.01", debe: new Decimal(123.45) }),
      leaf({ codigo: "4.3.1.02", haber: new Decimal(10) }),
    ];
    const er = construirEstadoResultadosRT9(leaves);
    const esperado = leaves.reduce((acc, l) => acc.plus(l.haber).minus(l.debe), new Decimal(0));
    expect(er.resultadoEjercicio.toFixed(2)).toBe(esperado.toFixed(2));
  });

  it("respeta el rubroEECC al asignar la sección", () => {
    const leaves: LeafResultado[] = [
      // Código de CMV pero rubro lo manda a Otros → no afecta el Bruto.
      leaf({ codigo: "5.1.1.01", debe: new Decimal(100), rubroEECC: "Otros Ingresos y Egresos" }),
      leaf({ codigo: "4.1.1.01", haber: new Decimal(500) }),
    ];
    const er = construirEstadoResultadosRT9(leaves);
    expect(er.resultadoBruto.toFixed(2)).toBe("500.00"); // CMV salió del Bruto
    const otros = er.secciones.find((s) => s.id === "OTROS")!;
    expect(otros.total.toFixed(2)).toBe("-100.00"); // egreso reclasificado
  });
});

describe("cobertura del plan — toda cuenta de resultado mapea a una sección", () => {
  it("ninguna analítica INGRESO/EGRESO del PLAN_RT9 queda sin sección", () => {
    const sinSeccion = PLAN_RT9.filter(
      (c) =>
        c.tipo === "ANALITICA" &&
        (c.categoria === "INGRESO" || c.categoria === "EGRESO") &&
        clasificarSeccionRT9(c.codigo, c.rubroEECC ?? null) === null,
    ).map((c) => c.codigo);
    expect(sinSeccion).toEqual([]);
  });
});
