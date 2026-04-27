import "server-only";

import { db } from "@/lib/db";
import { Decimal, toDecimal } from "@/lib/decimal";
import {
  AsientoEstado,
  type CuentaCategoria,
  type CuentaTipo,
} from "@/generated/prisma/client";

import { saldoPorCategoria } from "./shared";

export type LibroMayorLinea = {
  lineaId: number;
  fecha: Date;
  asientoId: string;
  asientoNumero: number;
  asientoDescripcion: string;
  descripcion: string | null;
  debe: Decimal;
  haber: Decimal;
  saldoAcumulado: Decimal;
};

export type LibroMayorResult = {
  cuenta: {
    id: number;
    codigo: string;
    nombre: string;
    tipo: CuentaTipo;
    categoria: CuentaCategoria;
  };
  rango: {
    fechaDesde: Date | null;
    fechaHasta: Date | null;
  };
  saldoInicial: Decimal;
  lineas: LibroMayorLinea[];
  totalDebe: Decimal;
  totalHaber: Decimal;
  saldoFinal: Decimal;
};

export class LibroMayorError extends Error {
  constructor(
    public code: "CUENTA_NO_ENCONTRADA" | "CUENTA_NO_ANALITICA",
    message: string,
  ) {
    super(message);
    this.name = "LibroMayorError";
  }
}

export async function getLibroMayor(
  cuentaId: number,
  filter: { fechaDesde?: Date; fechaHasta?: Date },
): Promise<LibroMayorResult> {
  const cuenta = await db.cuentaContable.findUnique({
    where: { id: cuentaId },
    select: {
      id: true,
      codigo: true,
      nombre: true,
      tipo: true,
      categoria: true,
    },
  });

  if (!cuenta) {
    throw new LibroMayorError(
      "CUENTA_NO_ENCONTRADA",
      `Cuenta contable ${cuentaId} no existe`,
    );
  }
  if (cuenta.tipo !== "ANALITICA") {
    throw new LibroMayorError(
      "CUENTA_NO_ANALITICA",
      `La cuenta ${cuenta.codigo} es sintética; solo cuentas analíticas tienen movimientos`,
    );
  }

  const fechaWhere =
    filter.fechaDesde || filter.fechaHasta
      ? {
          ...(filter.fechaDesde && { gte: filter.fechaDesde }),
          ...(filter.fechaHasta && { lte: filter.fechaHasta }),
        }
      : undefined;

  // Saldo inicial: acumulado de líneas con asiento.fecha < fechaDesde.
  let saldoInicial = new Decimal(0);
  if (filter.fechaDesde) {
    const previas = await db.lineaAsiento.aggregate({
      where: {
        cuentaId,
        asiento: {
          estado: AsientoEstado.CONTABILIZADO,
          fecha: { lt: filter.fechaDesde },
        },
      },
      _sum: { debe: true, haber: true },
    });
    const debePrev = toDecimal(previas._sum.debe ?? 0);
    const haberPrev = toDecimal(previas._sum.haber ?? 0);
    saldoInicial = saldoPorCategoria(debePrev, haberPrev, cuenta.categoria);
  }

  const rows = await db.lineaAsiento.findMany({
    where: {
      cuentaId,
      asiento: {
        estado: AsientoEstado.CONTABILIZADO,
        ...(fechaWhere ? { fecha: fechaWhere } : {}),
      },
    },
    orderBy: [
      { asiento: { fecha: "asc" } },
      { asiento: { numero: "asc" } },
      { id: "asc" },
    ],
    select: {
      id: true,
      debe: true,
      haber: true,
      descripcion: true,
      asiento: {
        select: {
          id: true,
          numero: true,
          fecha: true,
          descripcion: true,
        },
      },
    },
  });

  let acumulado = saldoInicial;
  let totalDebe = new Decimal(0);
  let totalHaber = new Decimal(0);

  const lineas: LibroMayorLinea[] = rows.map((r) => {
    const debe = toDecimal(r.debe);
    const haber = toDecimal(r.haber);
    totalDebe = totalDebe.plus(debe);
    totalHaber = totalHaber.plus(haber);
    acumulado = acumulado.plus(saldoPorCategoria(debe, haber, cuenta.categoria));
    return {
      lineaId: r.id,
      fecha: r.asiento.fecha,
      asientoId: r.asiento.id,
      asientoNumero: r.asiento.numero,
      asientoDescripcion: r.asiento.descripcion,
      descripcion: r.descripcion,
      debe,
      haber,
      saldoAcumulado: acumulado.toDecimalPlaces(2),
    };
  });

  return {
    cuenta,
    rango: {
      fechaDesde: filter.fechaDesde ?? null,
      fechaHasta: filter.fechaHasta ?? null,
    },
    saldoInicial: saldoInicial.toDecimalPlaces(2),
    lineas,
    totalDebe: totalDebe.toDecimalPlaces(2),
    totalHaber: totalHaber.toDecimalPlaces(2),
    saldoFinal: acumulado.toDecimalPlaces(2),
  };
}
