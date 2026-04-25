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
  periodo: {
    id: number;
    codigo: string;
    nombre: string;
    fechaInicio: Date;
    fechaFin: Date;
  };
  lineas: LibroMayorLinea[];
  totalDebe: Decimal;
  totalHaber: Decimal;
  saldoFinal: Decimal;
};

export class LibroMayorError extends Error {
  constructor(
    public code: "CUENTA_NO_ENCONTRADA" | "CUENTA_NO_ANALITICA" | "PERIODO_NO_ENCONTRADO",
    message: string,
  ) {
    super(message);
    this.name = "LibroMayorError";
  }
}

export async function getLibroMayor(
  cuentaId: number,
  periodoId: number,
): Promise<LibroMayorResult> {
  const [cuenta, periodo] = await Promise.all([
    db.cuentaContable.findUnique({
      where: { id: cuentaId },
      select: {
        id: true,
        codigo: true,
        nombre: true,
        tipo: true,
        categoria: true,
      },
    }),
    db.periodoContable.findUnique({
      where: { id: periodoId },
      select: {
        id: true,
        codigo: true,
        nombre: true,
        fechaInicio: true,
        fechaFin: true,
      },
    }),
  ]);

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
  if (!periodo) {
    throw new LibroMayorError(
      "PERIODO_NO_ENCONTRADO",
      `Período ${periodoId} no existe`,
    );
  }

  const rows = await db.lineaAsiento.findMany({
    where: {
      cuentaId,
      asiento: {
        periodoId,
        estado: AsientoEstado.CONTABILIZADO,
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

  let acumulado = new Decimal(0);
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
    periodo,
    lineas,
    totalDebe: totalDebe.toDecimalPlaces(2),
    totalHaber: totalHaber.toDecimalPlaces(2),
    saldoFinal: acumulado.toDecimalPlaces(2),
  };
}
