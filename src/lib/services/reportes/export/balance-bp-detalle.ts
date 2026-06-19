// Detalhe linha-a-linha por embarque para o export do Balanço (formato
// artesanal do dono). São SUB-LINHAS informativas que detalham, por embarque:
//   • PASIVO  → PROVEDORES DO EXTERIOR (deuda FOB por embarque, USD nativo)
//   • ATIVO   → STOCK em trânsito (mercadería en viaje, valor FOB por embarque)
//
// IMPORTANTE: o detalhe é ADITIVO/informativo — NÃO altera o subtotal contável
// do bloco (que segue vindo do razão, fonte de verdade do cuadre). Os mappers
// abaixo são PUROS (sem DB / sem server-only) → testáveis com fixtures.

import { Decimal } from "@/lib/decimal";
import { convertirMonto } from "@/lib/format";

export type DetalleEmbarqueBP = {
  embarqueCodigo: string; // "BR-…CN" ou "(sin embarque)"
  descripcion: string; // proveedor (+ nº de factura quando suelta)
  usd: string; // toFixed(2)
  ars: string; // toFixed(2)
};

// Subconjunto de ProveedorExteriorSaldo (cuentas-a-pagar.ts) realmente
// consumido — mantém o mapper desacoplado do serviço e do Prisma.
export type ProveedorExteriorInput = {
  proveedorNombre: string;
  embarques: { embarqueCodigo: string; saldoUsd: string }[];
  facturasSueltas: { numero: string; saldoUsd: string }[];
};

// Subconjunto do Embarque en viaje (lado ativo).
export type EmbarqueStockInput = {
  embarqueCodigo: string;
  proveedorNombre: string;
  moneda: "ARS" | "USD";
  fob: string; // fobTotal na moeda nativa, toFixed(2)
};

// Linha cujo valor já está em USD nativo (deuda exterior): USD passa direto,
// ARS = USD × TC (apresentação). Sem TC → ARS = passthrough (degradação segura).
function lineaDesdeUsd(
  embarqueCodigo: string,
  descripcion: string,
  usdNativo: string,
  tc: string | null,
): DetalleEmbarqueBP {
  const usd = new Decimal(usdNativo).toFixed(2);
  return { embarqueCodigo, descripcion, usd, ars: convertirMonto(usd, "USD", "ARS", tc) };
}

/**
 * PASIVO → PROVEDORES DO EXTERIOR: uma linha por embarque (deuda FOB USD) +
 * uma linha por factura suelta (proveedor exterior sem embarque vinculado).
 */
export function agruparDetalleExterior(
  proveedores: ProveedorExteriorInput[],
  tc: string | null,
): DetalleEmbarqueBP[] {
  const out: DetalleEmbarqueBP[] = [];
  for (const p of proveedores) {
    for (const e of p.embarques) {
      out.push(lineaDesdeUsd(e.embarqueCodigo, p.proveedorNombre, e.saldoUsd, tc));
    }
    for (const f of p.facturasSueltas) {
      out.push(
        lineaDesdeUsd("(sin embarque)", `${p.proveedorNombre} — ${f.numero}`, f.saldoUsd, tc),
      );
    }
  }
  return out;
}

/**
 * ATIVO → STOCK em trânsito: uma linha por embarque en viaje. O valor (FOB) vem
 * na moeda nativa do embarque → conversão native-aware (USD nativo não
 * re-divide; ARS nativo não é tratado como USD).
 */
export function mapearDetalleStockTransito(
  embarques: EmbarqueStockInput[],
  tc: string | null,
): DetalleEmbarqueBP[] {
  return embarques.map((e) => ({
    embarqueCodigo: e.embarqueCodigo,
    descripcion: e.proveedorNombre,
    usd: convertirMonto(e.fob, e.moneda, "USD", tc),
    ars: convertirMonto(e.fob, e.moneda, "ARS", tc),
  }));
}
