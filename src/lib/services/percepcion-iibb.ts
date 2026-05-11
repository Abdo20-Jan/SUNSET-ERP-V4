// Cálculo de Percepción IIBB jurisdiccional para vendas.
//
// Sunset não está em Convenio Multilateral. Hoje é agente de
// Percepción IIBB apenas em CABA. Esta função é pura (sem I/O):
// recebe `subtotal` + cliente já com `provincia.jurisdiccionIIBB`
// carregado e devolve o monto a percepcionar.
//
// Regras (curto-circuito top-down):
// 1. Cliente exento → 0
// 2. Cliente sem província → 0 (não dá para determinar jurisdicción)
// 3. Jurisdicción não é agente de percepção → 0
// 4. Senão, alícuota = override do cliente ?? alícuota da jurisdicción
//    e monto = round(subtotal × alícuota / 100, 2 HALF_UP)

import { Decimal } from "decimal.js";

export interface ClienteParaCalculoPercepcion {
  exentoPercepcionIIBB: boolean;
  alicuotaPercepcionIIBB: Decimal | string | null;
  provincia: {
    jurisdiccionIIBB: {
      id: number;
      esAgentePercepcion: boolean;
      alicuotaPercepcion: Decimal | string;
    } | null;
  } | null;
}

export interface ResultadoPercepcionIIBB {
  monto: Decimal;
  alicuotaUsada: Decimal | null;
  jurisdiccionId: number | null;
}

const CERO: ResultadoPercepcionIIBB = {
  monto: new Decimal(0),
  alicuotaUsada: null,
  jurisdiccionId: null,
};

export function calcularPercepcionIIBB(args: {
  subtotal: Decimal | string;
  cliente: ClienteParaCalculoPercepcion;
}): ResultadoPercepcionIIBB {
  const { cliente } = args;

  if (cliente.exentoPercepcionIIBB) return CERO;

  const jurisdiccion = cliente.provincia?.jurisdiccionIIBB;
  if (!jurisdiccion || !jurisdiccion.esAgentePercepcion) return CERO;

  const subtotal = new Decimal(args.subtotal.toString());
  const alicuotaJurisdiccion = new Decimal(jurisdiccion.alicuotaPercepcion.toString());
  const alicuota =
    cliente.alicuotaPercepcionIIBB != null
      ? new Decimal(cliente.alicuotaPercepcionIIBB.toString())
      : alicuotaJurisdiccion;

  const monto = subtotal.mul(alicuota).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  return {
    monto,
    alicuotaUsada: alicuota,
    jurisdiccionId: jurisdiccion.id,
  };
}
