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
  periodo: {
    id: number;
    codigo: string;
    nombre: string;
    fechaInicio: Date;
    fechaFin: Date;
  };
  asientos: LibroDiarioAsiento[];
  totalAsientos: number;
  totalDebe: Decimal;
  totalHaber: Decimal;
};

export async function getLibroDiario(
  periodoId: number,
): Promise<LibroDiarioResult | null> {
  const periodo = await db.periodoContable.findUnique({
    where: { id: periodoId },
    select: {
      id: true,
      codigo: true,
      nombre: true,
      fechaInicio: true,
      fechaFin: true,
    },
  });
  if (!periodo) return null;

  const asientos = await db.asiento.findMany({
    where: {
      periodoId,
      estado: AsientoEstado.CONTABILIZADO,
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
    periodo,
    asientos: out,
    totalAsientos: out.length,
    totalDebe: totalDebe.toDecimalPlaces(2),
    totalHaber: totalHaber.toDecimalPlaces(2),
  };
}
