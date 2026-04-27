import "server-only";

import { db } from "@/lib/db";
import { Decimal, toDecimal } from "@/lib/decimal";
import {
  AsientoEstado,
  type AsientoOrigen,
  type Moneda,
} from "@/generated/prisma/client";

export type LibroDiarioLinea = {
  id: number;
  cuentaId: number;
  cuentaCodigo: string;
  cuentaNombre: string;
  descripcion: string | null;
  debe: Decimal;
  haber: Decimal;
};

export type LibroDiarioAsiento = {
  id: string;
  numero: number;
  fecha: Date;
  descripcion: string;
  origen: AsientoOrigen;
  moneda: Moneda;
  tipoCambio: Decimal;
  totalDebe: Decimal;
  totalHaber: Decimal;
  lineas: LibroDiarioLinea[];
};

export type LibroDiarioResult = {
  rango: {
    fechaDesde: Date | null;
    fechaHasta: Date | null;
  };
  asientos: LibroDiarioAsiento[];
  totalAsientos: number;
  totalDebe: Decimal;
  totalHaber: Decimal;
};

export async function getLibroDiario(filter: {
  fechaDesde?: Date;
  fechaHasta?: Date;
}): Promise<LibroDiarioResult> {
  const fechaWhere =
    filter.fechaDesde || filter.fechaHasta
      ? {
          ...(filter.fechaDesde && { gte: filter.fechaDesde }),
          ...(filter.fechaHasta && { lte: filter.fechaHasta }),
        }
      : undefined;

  const asientos = await db.asiento.findMany({
    where: {
      estado: AsientoEstado.CONTABILIZADO,
      ...(fechaWhere ? { fecha: fechaWhere } : {}),
    },
    orderBy: [{ fecha: "asc" }, { numero: "asc" }],
    select: {
      id: true,
      numero: true,
      fecha: true,
      descripcion: true,
      origen: true,
      moneda: true,
      tipoCambio: true,
      totalDebe: true,
      totalHaber: true,
      lineas: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          cuentaId: true,
          debe: true,
          haber: true,
          descripcion: true,
          cuenta: {
            select: { codigo: true, nombre: true },
          },
        },
      },
    },
  });

  let totalDebe = new Decimal(0);
  let totalHaber = new Decimal(0);
  const out: LibroDiarioAsiento[] = asientos.map((a) => {
    const td = toDecimal(a.totalDebe);
    const th = toDecimal(a.totalHaber);
    totalDebe = totalDebe.plus(td);
    totalHaber = totalHaber.plus(th);
    return {
      id: a.id,
      numero: a.numero,
      fecha: a.fecha,
      descripcion: a.descripcion,
      origen: a.origen,
      moneda: a.moneda,
      tipoCambio: toDecimal(a.tipoCambio),
      totalDebe: td,
      totalHaber: th,
      lineas: a.lineas.map((l) => ({
        id: l.id,
        cuentaId: l.cuentaId,
        cuentaCodigo: l.cuenta.codigo,
        cuentaNombre: l.cuenta.nombre,
        descripcion: l.descripcion,
        debe: toDecimal(l.debe),
        haber: toDecimal(l.haber),
      })),
    };
  });

  return {
    rango: {
      fechaDesde: filter.fechaDesde ?? null,
      fechaHasta: filter.fechaHasta ?? null,
    },
    asientos: out,
    totalAsientos: out.length,
    totalDebe: totalDebe.toDecimalPlaces(2),
    totalHaber: totalHaber.toDecimalPlaces(2),
  };
}
