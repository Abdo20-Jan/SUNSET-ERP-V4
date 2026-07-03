import { beforeEach, describe, expect, it, vi } from "vitest";

// INV-01 / PR-027 — proyección read-only de la worklist de inventario.
// Vitest puro con mocks (idioma de test/fin-cxc-worklist.test.ts): NADA de
// Testcontainers — el servicio es una proyección sobre queries batched y las
// derivaciones son puras. Verifica: (i) gate VER_COSTO_STOCK a nivel de QUERY
// (sin permiso la query de costos NI SE EJECUTA y toda fila sale null);
// (ii) PARIDAD con la matriz vieja (fisico/reservado/disponible por celda —
// fórmula `fisica − reservada` de inventario-matrix); (iii) el preset
// `?agrupar=deposito` es presentación pura (mismo multiset, mismos totales);
// (iv) vistas data-backed; (v) derivaciones (fiscal / futuro comex 90d /
// despachos distinct / precedencia de alerta / bajo mínimo sólo-NACIONAL).

vi.mock("@/lib/db", () => ({
  db: {
    stockPorDeposito: { findMany: vi.fn() },
    itemDespacho: { findMany: vi.fn() },
    producto: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/actions/inventario", () => ({
  listarEnTransito: vi.fn(),
  listarEnProduccion: vi.fn(),
}));

import { listarEnProduccion, listarEnTransito } from "@/lib/actions/inventario";
import { db } from "@/lib/db";
import {
  filtrarPorVista,
  listarInventarioWorklist,
  ordenarPorDeposito,
  PIPELINE_DEPOSITO_LABEL,
  resolverDias,
  resolverVista,
} from "@/lib/services/inventario-worklist";

const mSpdFindMany = vi.mocked(db.stockPorDeposito.findMany);
const mDespachoFindMany = vi.mocked(db.itemDespacho.findMany);
const mProductoFindMany = vi.mocked(db.producto.findMany);
const mEnTransito = vi.mocked(listarEnTransito);
const mEnProduccion = vi.mocked(listarEnProduccion);

// Fecha fija inyectada (`opts.hoy`) — cortes de 90d deterministas.
const HOY = new Date("2026-07-02T00:00:00.000Z");

const D_CENTRAL = { nombre: "Central", tipo: "NACIONAL", subtipo: null };
const D_FISCAL = { nombre: "Fiscal TP", tipo: "ZONA_PRIMARIA", subtipo: "DEPOSITO_FISCAL" };
const D_NORTE = { nombre: "Norte", tipo: "NACIONAL", subtipo: null };

const P1 = { codigo: "1001", nombre: "Neumático 205/55R16", marca: "Sunset", medida: "205/55R16", stockMinimo: 50 };
const P2 = { codigo: "1002", nombre: "Neumático 175/70R13", marca: "Aurora", medida: "175/70R13", stockMinimo: 500 };
// P3: bajo mínimo aunque tenga 500 en fiscal — el umbral compara SÓLO el
// físico NACIONAL (semántica de `stockActual`, sin leerlo).
const P3 = { codigo: "1003", nombre: "Neumático 265/70R16", marca: "Sunset", medida: "265/70R16", stockMinimo: 100 };

// Celdas producto×depósito — espejo de lo que la matriz vieja muestra.
const SPD = [
  // P1: sano en Central; volumen en fiscal sin movimiento hace 182 días.
  { productoId: "p1", depositoId: "d1", cantidadFisica: 100, cantidadReservada: 20, ultimoMovimiento: new Date("2026-06-30T00:00:00.000Z"), producto: P1, deposito: D_CENTRAL },
  { productoId: "p1", depositoId: "d2", cantidadFisica: 300, cantidadReservada: 0, ultimoMovimiento: new Date("2026-01-01T00:00:00.000Z"), producto: P1, deposito: D_FISCAL },
  // P2: físico negativo en Central; disponible negativo (10−15) en Norte.
  { productoId: "p2", depositoId: "d1", cantidadFisica: -5, cantidadReservada: 0, ultimoMovimiento: new Date("2026-07-01T00:00:00.000Z"), producto: P2, deposito: D_CENTRAL },
  { productoId: "p2", depositoId: "d3", cantidadFisica: 10, cantidadReservada: 15, ultimoMovimiento: new Date("2026-07-01T00:00:00.000Z"), producto: P2, deposito: D_NORTE },
  // P3: 40 nacionales (< mínimo 100) + 500 en fiscal (no cuentan).
  { productoId: "p3", depositoId: "d1", cantidadFisica: 40, cantidadReservada: 0, ultimoMovimiento: new Date("2026-07-01T00:00:00.000Z"), producto: P3, deposito: D_CENTRAL },
  { productoId: "p3", depositoId: "d2", cantidadFisica: 500, cantidadReservada: 0, ultimoMovimiento: new Date("2026-07-01T00:00:00.000Z"), producto: P3, deposito: D_FISCAL },
];

const COSTOS = [
  { productoId: "p1", depositoId: "d1", costoPromedio: { toString: () => "123.45" } },
  { productoId: "p1", depositoId: "d2", costoPromedio: { toString: () => "119.00" } },
];

// Futuro Comex de P1: 12 llegan dentro de 90d, 8 más allá (fuera de la
// COLUMNA pero dentro del total sin corte); 504 en producción sin fecha
// prevista (incluidos — OD-04). P4 NO tiene fila SPD (pipeline-only) y su
// único embarque llega más allá de 90d → fila sintética + vista [En tránsito].
const P4_META = {
  id: "p4",
  codigo: "1004",
  nombre: "Neumatico QA 315/80R22",
  marca: "Sunset",
  medida: "315/80R22",
  stockMinimo: 0,
};

const EN_TRANSITO = {
  filas: [
    {
      productoId: "p1",
      codigo: "1001",
      nombre: P1.nombre,
      cantidad: 20,
      detalles: [
        { embarqueId: "e1", embarqueCodigo: "EMB-1", estado: "EN_TRANSITO", cantidad: 12, fechaSalida: null, fechaLlegada: new Date("2026-07-20T00:00:00.000Z"), proveedorNombre: "Fábrica" },
        { embarqueId: "e2", embarqueCodigo: "EMB-2", estado: "EN_TRANSITO", cantidad: 8, fechaSalida: null, fechaLlegada: new Date("2026-12-01T00:00:00.000Z"), proveedorNombre: "Fábrica" },
      ],
    },
    {
      productoId: "p4",
      codigo: "1004",
      nombre: P4_META.nombre,
      cantidad: 50,
      detalles: [
        { embarqueId: "e3", embarqueCodigo: "EMB-3", estado: "EN_TRANSITO", cantidad: 50, fechaSalida: null, fechaLlegada: new Date("2026-12-15T00:00:00.000Z"), proveedorNombre: "Fábrica" },
      ],
    },
  ],
};

const EN_PRODUCCION = {
  filas: [
    {
      productoId: "p1",
      codigo: "1001",
      nombre: P1.nombre,
      cantidadPedida: 504,
      cantidadEmbarcada: 0,
      cantidadEnProduccion: 504,
      detalles: [
        { pedidoId: 1, pedidoNumero: "PC-1", estado: "CONFIRMADO", cantidad: 504, fechaPrevista: null, proveedorNombre: "Fábrica" },
      ],
    },
  ],
};

// 3 items pero 2 despachos DISTINTOS (d-a dos veces) → contador = 2.
const ITEMS_DESPACHO = [
  { despachoId: "d-a", itemEmbarque: { productoId: "p1" } },
  { despachoId: "d-a", itemEmbarque: { productoId: "p1" } },
  { despachoId: "d-b", itemEmbarque: { productoId: "p1" } },
];

function listar(verCosto: boolean) {
  return listarInventarioWorklist(verCosto, { hoy: HOY });
}

/** `select` del call N de `stockPorDeposito.findMany` (para asserts del gate). */
function selectDelCall(n: number): Record<string, unknown> {
  const args = mSpdFindMany.mock.calls[n]?.[0] as { select?: Record<string, unknown> } | undefined;
  return args?.select ?? {};
}

beforeEach(() => {
  vi.clearAllMocks();
  // La query base NUNCA selecciona costo; la de costos sí — se distinguen
  // por el select (misma delegate `stockPorDeposito.findMany`).
  mSpdFindMany.mockImplementation(((args?: { select?: { costoPromedio?: boolean } }) =>
    Promise.resolve(args?.select?.costoPromedio ? COSTOS : SPD)) as never);
  mDespachoFindMany.mockResolvedValue(ITEMS_DESPACHO as never);
  mProductoFindMany.mockResolvedValue([P4_META] as never);
  mEnTransito.mockResolvedValue(EN_TRANSITO as never);
  mEnProduccion.mockResolvedValue(EN_PRODUCCION as never);
});

describe("listarInventarioWorklist · gate VER_COSTO_STOCK (query separada)", () => {
  it("sin permiso: la query de costos NI SE EJECUTA y toda fila sale null", async () => {
    const { rows } = await listar(false);

    // Una sola findMany (la base) y sin costo en el select.
    expect(mSpdFindMany).toHaveBeenCalledTimes(1);
    const select = selectDelCall(0);
    expect(Object.keys(select).length).toBeGreaterThan(0);
    expect("costoPromedio" in select).toBe(false);
    expect(rows.every((r) => r.costoPromedio === null)).toBe(true);
  });

  it("con permiso: query separada de costos (MISMO orden que la base) y valor almacenado tal cual", async () => {
    const { rows } = await listar(true);

    expect(mSpdFindMany).toHaveBeenCalledTimes(2);
    // Mismo orderBy en ambas queries: con el cap alcanzado, los subconjuntos
    // truncados quedan alineados (LIMIT sin ORDER BY sería arbitrario).
    const [base, costos] = mSpdFindMany.mock.calls.map(
      (c) => c[0] as { orderBy?: unknown; take?: number },
    );
    expect(costos?.orderBy).toEqual(base?.orderBy);
    expect(costos?.take).toBe(base?.take);
    const porId = new Map(rows.map((r) => [r.id, r]));
    expect(porId.get("p1:d1")?.costoPromedio).toBe("123.45");
    expect(porId.get("p1:d2")?.costoPromedio).toBe("119.00");
    // Sin valor almacenado → null (jamás recalculado).
    expect(porId.get("p2:d1")?.costoPromedio).toBeNull();
  });
});

describe("listarInventarioWorklist · filas pipeline (producto sin SPD viva)", () => {
  it("sintetiza la fila con cantidades 0 y el pipeline sin corte (paridad con las tabs viejas)", async () => {
    const { rows } = await listar(false);
    const fila = rows.find((r) => r.id === "p4:pipeline");

    // Metadatos por 1 query batched con EXACTAMENTE los ids faltantes.
    expect(mProductoFindMany).toHaveBeenCalledTimes(1);
    const args = mProductoFindMany.mock.calls[0]?.[0] as {
      where?: { id?: { in?: string[] } };
    };
    expect(args?.where?.id?.in).toEqual(["p4"]);

    expect(fila).toBeDefined();
    expect(fila?.depositoNombre).toBe(PIPELINE_DEPOSITO_LABEL);
    expect(fila?.depositoId).toBe("");
    expect(fila?.fisico).toBe(0);
    expect(fila?.disponible).toBe(0);
    expect(fila?.ultimoMovimiento).toBeNull();
    expect(fila?.costoPromedio).toBeNull();
    // ETA 2026-12-15 > 90d: fuera de la COLUMNA (total 0) pero dentro del
    // total sin corte (vista [En tránsito]).
    expect(fila?.futuroComex).toEqual({
      total: 0,
      enProduccion: 0,
      enTransito: 0,
      enTransitoTotal: 50,
      enProduccionTotal: 0,
    });
  });
});

describe("listarInventarioWorklist · paridad con la matriz vieja", () => {
  it("una fila por celda SPD, con fisico/reservado/disponible = fórmula de la matriz", async () => {
    const { rows } = await listar(false);

    // Todas las celdas SPD + 1 fila pipeline sintética (p4), ids únicos.
    expect(rows).toHaveLength(SPD.length + 1);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    expect(rows.filter((r) => r.depositoId !== "")).toHaveLength(SPD.length);
    for (const celda of SPD) {
      const row = rows.find((r) => r.id === `${celda.productoId}:${celda.depositoId}`);
      expect(row).toBeDefined();
      expect(row?.fisico).toBe(celda.cantidadFisica);
      expect(row?.reservado).toBe(celda.cantidadReservada);
      // Disponible = física − reservada (inventario-matrix, celda "Disp.").
      expect(row?.disponible).toBe(celda.cantidadFisica - celda.cantidadReservada);
    }
  });
});

describe("ordenarPorDeposito · presentación pura (?agrupar=deposito)", () => {
  it("mismo multiset de filas y mismos totales; el input no se muta", async () => {
    const { rows } = await listar(false);
    const ordenOriginal = rows.map((r) => r.id);

    const porDeposito = ordenarPorDeposito(rows);

    expect(rows.map((r) => r.id)).toEqual(ordenOriginal); // sin mutación
    expect([...porDeposito.map((r) => r.id)].sort()).toEqual([...ordenOriginal].sort());
    const suma = (xs: typeof rows) => xs.reduce((a, r) => a + r.fisico + r.reservado, 0);
    expect(suma(porDeposito)).toBe(suma(rows));
    // Contiguo por depósito (Central < Fiscal TP < Norte).
    expect(porDeposito.map((r) => r.depositoNombre)).toEqual(
      [...porDeposito.map((r) => r.depositoNombre)].sort((a, b) => a.localeCompare(b)),
    );
  });
});

describe("vistas data-backed (presets de URL server-side)", () => {
  it("resolverVista/resolverDias: whitelist con defaults", () => {
    expect(resolverVista(undefined)).toBe("todas");
    expect(resolverVista("negativos")).toBe("negativos");
    expect(resolverVista("divergencias")).toBe("todas"); // sin backing → nunca
    expect(resolverDias(undefined)).toBe(90);
    expect(resolverDias("45")).toBe(90); // fuera de whitelist
    expect(resolverDias("180")).toBe(180);
  });

  it("filtra cada preset sobre campos ya proyectados", async () => {
    const { rows } = await listar(false);
    const ids = (vista: Parameters<typeof filtrarPorVista>[1], dias = 90) =>
      filtrarPorVista(rows, vista, dias)
        .map((r) => r.id)
        .sort();

    expect(ids("negativos")).toEqual(["p2:d1", "p2:d3"]);
    expect(ids("bajo-minimo")).toEqual(["p2:d1", "p2:d3", "p3:d1", "p3:d2"]);
    // [En tránsito] usa el total SIN corte (tab vieja): el embarque de p4 con
    // ETA > 90d sigue visible; [Futuro Comex] respeta el corte (p4 fuera).
    expect(ids("en-transito")).toEqual(["p1:d1", "p1:d2", "p4:pipeline"]);
    expect(ids("futuro-comex")).toEqual(["p1:d1", "p1:d2"]);
    // En fiscal: la fila del depósito fiscal + las del producto con saldo fiscal.
    expect(ids("en-fiscal")).toEqual(["p1:d1", "p1:d2", "p3:d1", "p3:d2"]);
    expect(ids("sin-movimiento", 90)).toEqual(["p1:d2"]); // 182 días
    expect(ids("sin-movimiento", 180)).toEqual(["p1:d2"]);
    expect(ids("todas")).toHaveLength(SPD.length + 1);
  });
});

describe("derivaciones read-only", () => {
  it("en fiscal / futuro comex 90d / despachos distinct / total nacional", async () => {
    const { rows } = await listar(false);
    const porId = new Map(rows.map((r) => [r.id, r]));
    const p1 = porId.get("p1:d1");

    // En fiscal del producto (repetido por fila) + breakdown por depósito.
    expect(p1?.enFiscal).toBe(300);
    expect(p1?.fiscalBreakdown).toEqual([{ deposito: "Fiscal TP", cantidad: 300 }]);
    // Futuro Comex: 12 en tránsito (≤90d; los 8 de diciembre sólo en el total
    // sin corte) + 504 en producción sin fecha (incluidos).
    expect(p1?.futuroComex).toEqual({
      total: 516,
      enProduccion: 504,
      enTransito: 12,
      enTransitoTotal: 20,
      enProduccionTotal: 504,
    });
    // 3 items pero 2 despachos BORRADOR distintos.
    expect(p1?.despachosActivos).toBe(2);
    // Total nacional NO suma el depósito fiscal.
    expect(p1?.totalFisicoNacional).toBe(100);
    expect(porId.get("p3:d1")?.totalFisicoNacional).toBe(40);
  });

  it("alerta = mayor severidad (negativo > bajo mínimo > sin movimiento)", async () => {
    const { rows } = await listar(false);
    const porId = new Map(rows.map((r) => [r.id, r]));

    expect(porId.get("p2:d1")?.alerta).toBe("negativo"); // físico < 0
    expect(porId.get("p2:d3")?.alerta).toBe("negativo"); // disponible < 0
    // P3 está bajo mínimo aunque tenga 500 en fiscal (sólo cuenta NACIONAL).
    expect(porId.get("p3:d1")?.bajoMinimo).toBe(true);
    expect(porId.get("p3:d1")?.alerta).toBe("bajo_minimo");
    expect(porId.get("p1:d2")?.alerta).toBe("sin_movimiento"); // 182 días
    expect(porId.get("p1:d1")?.alerta).toBeNull();
  });
});
