import "server-only";

import { toDecimal } from "@/lib/decimal";
import { AsientoEstado } from "@/generated/prisma/client";
import { db } from "@/lib/db";

import { PREFIJOS_IMPUESTO_DRE, type ImpuestoLeafInput } from "./balance-bp-dre";

/**
 * Impostos de RESULTADO do período (custo = debe − haber por conta), para o
 * detalhe de impostos do bloco "Conferindo o DRE". Consulta as contas
 * analíticas nos prefixos de imposto (PREFIJOS_IMPUESTO_DRE, fonte única); o
 * agrupamento por grupo AR e o descarte do que não é imposto ficam no mapper
 * puro `agruparImpuestosDRE`.
 */
export async function getImpuestosResultadoDRE(filter: {
  fechaDesde?: Date;
  fechaHasta?: Date;
}): Promise<ImpuestoLeafInput[]> {
  const asientoWhere = {
    estado: AsientoEstado.CONTABILIZADO,
    ...(filter.fechaDesde || filter.fechaHasta
      ? {
          fecha: {
            ...(filter.fechaDesde && { gte: filter.fechaDesde }),
            ...(filter.fechaHasta && { lte: filter.fechaHasta }),
          },
        }
      : {}),
  };

  const cuentas = await db.cuentaContable.findMany({
    where: {
      tipo: "ANALITICA",
      OR: PREFIJOS_IMPUESTO_DRE.map((p) => ({ codigo: { startsWith: p } })),
    },
    select: { id: true, codigo: true },
  });
  if (cuentas.length === 0) return [];

  const agregados = await db.lineaAsiento.groupBy({
    by: ["cuentaId"],
    where: { asiento: asientoWhere, cuentaId: { in: cuentas.map((c) => c.id) } },
    _sum: { debe: true, haber: true },
  });
  const agg = new Map(agregados.map((a) => [a.cuentaId, a._sum]));

  return cuentas.map((c) => {
    const s = agg.get(c.id);
    const costo = toDecimal(s?.debe ?? 0).minus(toDecimal(s?.haber ?? 0));
    return { codigo: c.codigo, montoArs: costo.toFixed(2) };
  });
}
