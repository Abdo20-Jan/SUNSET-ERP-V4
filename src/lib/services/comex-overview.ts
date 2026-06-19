import { db } from "@/lib/db";
import { sumMoney } from "@/lib/decimal";
import { getSaldosExteriorPorProveedor } from "@/lib/services/cuentas-a-pagar";
import { EmbarqueEstado } from "@/generated/prisma/client";

export type ConteoEstado = { estado: EmbarqueEstado; cantidad: number };

export type ResumenEmbarques = {
  total: number;
  activos: number;
  enTransito: number;
  enAduana: number;
  borradores: number;
  cerrados: number;
};

export type ResumenComex = ResumenEmbarques & {
  /** Deuda total en USD con proveedores del exterior (invariante a TC). */
  deudaExteriorUsd: string;
};

const EN_TRANSITO: readonly EmbarqueEstado[] = [
  EmbarqueEstado.EN_TRANSITO,
  EmbarqueEstado.EN_PUERTO,
];
const EN_ADUANA: readonly EmbarqueEstado[] = [
  EmbarqueEstado.EN_ZONA_PRIMARIA,
  EmbarqueEstado.EN_ADUANA,
  EmbarqueEstado.DESPACHADO,
];

/**
 * Agrupa los conteos por estado en los buckets de presentación del overview.
 * `activos` = todo lo que no es BORRADOR ni CERRADO (embarques en curso).
 * Función pura → testeable sin DB.
 */
export function resumirEmbarquesPorEstado(conteos: readonly ConteoEstado[]): ResumenEmbarques {
  const por = (estados: readonly EmbarqueEstado[]) =>
    conteos.filter((c) => estados.includes(c.estado)).reduce((s, c) => s + c.cantidad, 0);
  const total = conteos.reduce((s, c) => s + c.cantidad, 0);
  const borradores = por([EmbarqueEstado.BORRADOR]);
  const cerrados = por([EmbarqueEstado.CERRADO]);
  return {
    total,
    activos: total - borradores - cerrados,
    enTransito: por(EN_TRANSITO),
    enAduana: por(EN_ADUANA),
    borradores,
    cerrados,
  };
}

/** KPIs del overview de Comex: conteos por estado + deuda exterior USD. */
export async function getResumenComex(): Promise<ResumenComex> {
  const [grupos, saldos] = await Promise.all([
    db.embarque.groupBy({ by: ["estado"], _count: { _all: true } }),
    getSaldosExteriorPorProveedor(),
  ]);
  const conteos: ConteoEstado[] = grupos.map((g) => ({
    estado: g.estado,
    cantidad: g._count._all,
  }));
  return {
    ...resumirEmbarquesPorEstado(conteos),
    deudaExteriorUsd: sumMoney(saldos.map((s) => s.saldoUsd)).toString(),
  };
}
