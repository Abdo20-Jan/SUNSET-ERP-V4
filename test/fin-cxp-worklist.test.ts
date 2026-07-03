import { describe, expect, it } from "vitest";

// FIN-02 / PR-026 — worklist de gestión de cuentas a pagar (per-factura).
//
// El gate no-call de la proyección REUSADA (`listarSaldosProveedoresWorklist`,
// PR-025b) ya está trabado en test/saldos-proveedores-worklist.test.ts — acá
// se traba lo NUEVO:
// 1) Flatten-parity: `flattenFacturasPendientes` conserva EXACTAMENTE las
//    filas del aging anidado (cada factura una vez, rowIds únicos por
//    `origen-id`, padre por referencia) y los totales por bucket del flatten
//    == los del anidado vía los MISMOS helpers server
//    (`sumarBucketsNativos`+`convertirBucket`) — lección #262/#263.
// 2) Presets `?vista=`: presentación pura (mismo multiset de filas).
// 3) CTA "Pagar": `pagarHref` produce la URL VERBATIM del `PagarSoloCell` de
//    saldos-proveedores (025b) — el flujo EXISTENTE de movimientos, sin
//    mutación nueva.

import { convertirBucket, sumarBucketsNativos } from "@/lib/aging-presentacion";
import { fmtMoney } from "@/lib/format";
import {
  type FacturaPendiente,
  filtrarPorVista,
  finCxpRowId,
  flattenFacturasPendientes,
  ordenarPorUrgencia,
  pagarHref,
  resolverVista,
  type SaldoProveedorAging,
} from "@/app/(dashboard)/finanzas/cuentas-a-pagar/fin-cxp-presentacion";

function factura(
  over: Partial<FacturaPendiente> & Pick<FacturaPendiente, "id" | "origen" | "bucket">,
): FacturaPendiente {
  return {
    numero: `F-${over.id}`,
    referencia: null,
    fecha: "2026-05-01T00:00:00.000Z",
    fechaVencimiento: "2026-06-01T00:00:00.000Z",
    diasParaVencer: -31,
    monto: "0.00",
    montoNativo: "0.00",
    moneda: "ARS",
    ...over,
  };
}

const PROVEEDOR_A: SaldoProveedorAging = {
  proveedorId: "pA",
  proveedorNombre: "GLOBAL TIRE CO",
  cuit: null,
  pais: "CN",
  cuentaContableId: 7,
  saldoTotal: "180000.00",
  saldoTotalUsd: "135.71",
  vencido: "130000.00",
  proximo: "50000.00",
  alDia: "0.00",
  facturas: [
    factura({
      id: "uuid-c1",
      origen: "compra",
      bucket: "vencida",
      diasParaVencer: -31,
      monto: "130000.00",
      montoNativo: "100.00",
      moneda: "USD",
    }),
    factura({
      id: "5",
      origen: "embarque",
      bucket: "proxima",
      diasParaVencer: 3,
      fechaVencimiento: "2026-07-05T00:00:00.000Z",
      referencia: "EMB-2026-01",
      monto: "50000.00",
      montoNativo: "50000.00",
      moneda: "ARS",
    }),
  ],
};

const PROVEEDOR_B: SaldoProveedorAging = {
  proveedorId: "pB",
  proveedorNombre: "SERVICIOS SUR",
  cuit: "30-22222222-2",
  pais: "AR",
  cuentaContableId: null,
  saldoTotal: "88000.00",
  vencido: "0.00",
  proximo: "0.00",
  alDia: "88000.00",
  facturas: [
    factura({
      id: "uuid-g1",
      origen: "gasto",
      bucket: "al_dia",
      diasParaVencer: 44,
      fechaVencimiento: "2026-08-15T00:00:00.000Z",
      monto: "75000.00",
      montoNativo: "75000.00",
      moneda: "ARS",
    }),
    factura({
      id: "uuid-g2",
      origen: "gasto",
      bucket: "sin_fecha",
      diasParaVencer: null,
      fechaVencimiento: null,
      monto: "13000.00",
      montoNativo: "10.00",
      moneda: "USD",
    }),
  ],
};

const PROVEEDORES = [PROVEEDOR_A, PROVEEDOR_B];
const TC = "1400";

describe("flattenFacturasPendientes · conservación exacta de filas", () => {
  it("una fila por documento, rowIds únicos por origen-id, sin duplicación", () => {
    const flat = flattenFacturasPendientes(PROVEEDORES);

    expect(flat).toHaveLength(PROVEEDORES.reduce((n, p) => n + p.facturas.length, 0));
    const ids = flat.map(finCxpRowId);
    expect(new Set(ids).size).toBe(flat.length);
    expect(ids.sort()).toEqual(["compra-uuid-c1", "embarque-5", "gasto-uuid-g1", "gasto-uuid-g2"]);
  });

  it("el prefijo de origen evita colisión entre ids de tablas distintas", () => {
    // EmbarqueCosto usa ids numéricos ("5"); un id igual en otra tabla no
    // colisiona porque el rowId lleva el origen (criterio `facturaKey` 025b-2).
    expect(finCxpRowId({ origen: "embarque", id: "5" })).not.toBe(
      finCxpRowId({ origen: "compra", id: "5" }),
    );
  });

  it("el padre viaja INTACTO (por referencia) para el CTA y el expand", () => {
    const flat = flattenFacturasPendientes(PROVEEDORES);
    const fila = flat.find((f) => f.origen === "embarque");

    expect(fila?.proveedor).toBe(PROVEEDOR_A);
    expect(fila?.proveedorNombre).toBe("GLOBAL TIRE CO");
    expect(fila?.cuit).toBeNull();
  });
});

describe("pagarHref · URL VERBATIM del PagarSoloCell (025b)", () => {
  it("con cuenta contable: tipo/cuentaContableId/monto/descripcion con conteo de facturas", () => {
    const href = pagarHref(PROVEEDOR_A);
    const url = new URL(href, "http://localhost");

    expect(url.pathname).toBe("/tesoreria/movimientos/nuevo");
    expect(url.searchParams.get("tipo")).toBe("PAGO");
    expect(url.searchParams.get("cuentaContableId")).toBe("7");
    expect(url.searchParams.get("monto")).toBe("180000.00");
    expect(url.searchParams.get("descripcion")).toBe("Pago a GLOBAL TIRE CO — 2 factura(s)");
  });

  it("sin cuenta contable: cae al flujo pelado (paridad con el legado)", () => {
    expect(pagarHref(PROVEEDOR_B)).toBe("/tesoreria/movimientos/nuevo?tipo=PAGO");
  });

  it("sin facturas: descripción sin sufijo de conteo (paridad con el legado)", () => {
    const href = pagarHref({ ...PROVEEDOR_A, facturas: [] });
    const url = new URL(href, "http://localhost");
    expect(url.searchParams.get("descripcion")).toBe("Pago a GLOBAL TIRE CO");
  });
});

describe("flatten-parity · totales del flatten == helpers server del anidado", () => {
  const toItem = (f: Pick<FacturaPendiente, "bucket" | "moneda" | "montoNativo">) => ({
    bucket: f.bucket,
    moneda: f.moneda,
    montoNativo: f.montoNativo,
  });

  it("cada bucket × moneda: KPI del flatten == KPI del anidado (misma vía server)", () => {
    const flat = flattenFacturasPendientes(PROVEEDORES);
    const bucketsFlat = sumarBucketsNativos(flat.map(toItem));
    const bucketsAnidado = sumarBucketsNativos(PROVEEDORES.flatMap((p) => p.facturas.map(toItem)));

    expect(bucketsFlat).toEqual(bucketsAnidado);
    for (const moneda of ["ARS", "USD"] as const) {
      for (const bucket of ["vencida", "proxima", "al_dia"] as const) {
        expect(fmtMoney(convertirBucket(bucketsFlat[bucket], moneda, TC))).toBe(
          fmtMoney(convertirBucket(bucketsAnidado[bucket], moneda, TC)),
        );
      }
    }
  });

  it("suma por moneda NATIVA antes de convertir (no ÷tc ciego del agregado ARS)", () => {
    // Vencido en USD = 100 USD nativos (jamás 130000/1400 = 92,86 del ARS de
    // emisión reconvertido a ciegas).
    const flat = flattenFacturasPendientes(PROVEEDORES);
    const buckets = sumarBucketsNativos(flat.map(toItem));
    expect(fmtMoney(convertirBucket(buckets.vencida, "USD", TC))).toBe(fmtMoney("100.00"));
    // sin_fecha colapsa en al_dia también en la vista aplanada.
    expect(buckets.al_dia.usd).toBe("10.00");
  });
});

describe("ordenarPorUrgencia + filtrarPorVista · presentación pura", () => {
  it("ordenar no muta, no pierde ni duplica (mismo multiset de rowIds)", () => {
    const flat = flattenFacturasPendientes(PROVEEDORES);
    const antes = flat.map(finCxpRowId);
    const ordenado = ordenarPorUrgencia(flat);

    expect(flat.map(finCxpRowId)).toEqual(antes); // input intacto
    expect(ordenado.map(finCxpRowId).sort()).toEqual([...antes].sort());
    // Urgencia: diasParaVencer asc, sin fecha al final.
    expect(ordenado.map((f) => f.diasParaVencer)).toEqual([-31, 3, 44, null]);
  });

  it("vistas: hoy = vence hoy; prox7 = bucket proxima; vencidas = bucket vencida", () => {
    const flat = flattenFacturasPendientes(PROVEEDORES);
    const hoy = flat.map((f) => (f.origen === "embarque" ? { ...f, diasParaVencer: 0 } : f));

    expect(filtrarPorVista(flat, "todas")).toHaveLength(4);
    expect(filtrarPorVista(flat, "vencidas").map(finCxpRowId)).toEqual(["compra-uuid-c1"]);
    expect(filtrarPorVista(flat, "prox7").map(finCxpRowId)).toEqual(["embarque-5"]);
    expect(filtrarPorVista(flat, "hoy")).toHaveLength(0);
    expect(filtrarPorVista(hoy, "hoy").map(finCxpRowId)).toEqual(["embarque-5"]);
  });

  it("resolverVista: sólo acepta presets conocidos", () => {
    expect(resolverVista(undefined)).toBe("todas");
    expect(resolverVista("vencidas")).toBe("vencidas");
    expect(resolverVista("programados")).toBe("todas");
  });
});
