// Agregação native-aware dos montos do tab Compras do BI. PURO (sem DB / sem
// server-only) → testável com fixtures. Resolve o problema de moeda do
// `getAnalisisCompras`:
//   • FOB (Embarque.fobTotal) é USD-NATIVO (na moeda do embarque) → somado em USD.
//   • costoTotal/cifTotal são ARS (landed, já ×TC no motor COMEX).
//   • costoNacionalizadoPct DEVE comparar mesma moeda (landed ARS ÷ FOB em ARS),
//     não ARS ÷ USD (bug histórico que dava ~139000%).
//   • distribución de costos: cada linha de fatura vem na moeda da fatura →
//     converter a ARS (×tipoCambio da fatura) antes de somar.
//   • tributos por embarque: magnitudes na moeda do embarque → converter a ARS.

import { Decimal, sumMoney } from "@/lib/decimal";
import { convertirMonto } from "@/lib/format";

type MonedaNativa = "ARS" | "USD";

export type CostoFacturaInput = {
  moneda: MonedaNativa;
  tipoCambio: string;
  lineas: { tipo: string; subtotal: string }[];
};

export type EmbarqueComprasInput = {
  codigo: string;
  proveedorNombre: string;
  moneda: MonedaNativa;
  tipoCambio: string;
  fobTotal: string; // moeda nativa do embarque
  costoTotal: string; // ARS (landed)
  tributos: {
    die: string;
    tasaEstadistica: string;
    arancel: string;
    iva: string;
    ivaAdicional: string;
    ganancias: string;
    iibb: string;
  };
  costos: CostoFacturaInput[];
};

export type TributoEmbarqueArs = {
  label: string;
  die: number;
  tasaEstadistica: number;
  arancel: number;
  iva: number;
  ivaAdicional: number;
  ganancias: number;
  iibb: number;
};

export type ComprasMoneda = {
  importadoUsd: number; // Σ FOB convertido a USD nativo
  fobArs: number; // Σ FOB convertido a ARS (denominador do %)
  costoArs: number; // Σ costoTotal (ARS landed)
  costoNacionalizadoPct: number; // costoArs / fobArs (mesma moeda)
  porProveedorUsd: { label: string; value: number }[]; // FOB USD por proveedor, desc
  distribucionArs: { tipo: string; value: number }[]; // costos por tipo en ARS, desc
  tributosArs: TributoEmbarqueArs[]; // tributos por embarque convertidos a ARS
};

/** FOB de um embarque convertido a USD nativo (passthrough se já USD). */
export function fobAUsd(fobTotal: string, moneda: MonedaNativa, tipoCambio: string): string {
  return convertirMonto(fobTotal, moneda, "USD", tipoCambio);
}

function n(s: string): number {
  return Number(s);
}

export function agregarComprasMoneda(embarques: EmbarqueComprasInput[]): ComprasMoneda {
  const fobUsd: Decimal[] = [];
  const fobArs: Decimal[] = [];
  const costoArs: Decimal[] = [];
  const porProveedor = new Map<string, Decimal>();
  const porTipo = new Map<string, Decimal>();
  const tributosArs: TributoEmbarqueArs[] = [];

  for (const e of embarques) {
    const enUsd = new Decimal(convertirMonto(e.fobTotal, e.moneda, "USD", e.tipoCambio));
    const enArs = new Decimal(convertirMonto(e.fobTotal, e.moneda, "ARS", e.tipoCambio));
    fobUsd.push(enUsd);
    fobArs.push(enArs);
    costoArs.push(new Decimal(e.costoTotal));
    porProveedor.set(
      e.proveedorNombre,
      (porProveedor.get(e.proveedorNombre) ?? new Decimal(0)).plus(enUsd),
    );

    for (const c of e.costos) {
      for (const l of c.lineas) {
        const ars = new Decimal(convertirMonto(l.subtotal, c.moneda, "ARS", c.tipoCambio));
        porTipo.set(l.tipo, (porTipo.get(l.tipo) ?? new Decimal(0)).plus(ars));
      }
    }

    const trib = (v: string) => n(convertirMonto(v, e.moneda, "ARS", e.tipoCambio));
    tributosArs.push({
      label: e.codigo,
      die: trib(e.tributos.die),
      tasaEstadistica: trib(e.tributos.tasaEstadistica),
      arancel: trib(e.tributos.arancel),
      iva: trib(e.tributos.iva),
      ivaAdicional: trib(e.tributos.ivaAdicional),
      ganancias: trib(e.tributos.ganancias),
      iibb: trib(e.tributos.iibb),
    });
  }

  const totalFobArs = sumMoney(fobArs);
  const totalCostoArs = sumMoney(costoArs);

  return {
    importadoUsd: n(sumMoney(fobUsd).toFixed(2)),
    fobArs: n(totalFobArs.toFixed(2)),
    costoArs: n(totalCostoArs.toFixed(2)),
    costoNacionalizadoPct: totalFobArs.gt(0)
      ? Number(totalCostoArs.div(totalFobArs).toFixed(4))
      : 0,
    porProveedorUsd: Array.from(porProveedor.entries())
      .sort((a, b) => b[1].cmp(a[1]))
      .map(([label, v]) => ({ label, value: n(v.toFixed(2)) })),
    distribucionArs: Array.from(porTipo.entries())
      .sort((a, b) => b[1].cmp(a[1]))
      .map(([tipo, v]) => ({ tipo, value: n(v.toFixed(2)) })),
    tributosArs,
  };
}
