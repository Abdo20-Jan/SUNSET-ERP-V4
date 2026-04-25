import "server-only";

import { db } from "@/lib/db";
import { toDecimal } from "@/lib/decimal";
import { AsientoEstado } from "@/generated/prisma/client";

export type ProveedorAsociado = {
  id: string;
  nombre: string;
  cuit: string;
  pais: string;
  estado: string;
};

export type CxPRow = {
  cuentaId: number;
  cuentaCodigo: string;
  cuentaNombre: string;
  saldo: string;
  proveedores: ProveedorAsociado[];
};

export type CuentasAPagar = {
  proveedoresComerciales: CxPRow[]; // 2.1.1.x
  aduana: CxPRow[]; // 2.1.5.x
  fiscales: CxPRow[]; // 2.1.3.x
  totalGeneral: string;
};

const PREFIXES = {
  PROVEEDORES: "2.1.1.",
  ADUANA: "2.1.5.",
  FISCALES: "2.1.3.",
} as const;

export async function getCuentasAPagar(): Promise<CuentasAPagar> {
  const cuentas = await db.cuentaContable.findMany({
    where: {
      activa: true,
      OR: [
        { codigo: { startsWith: PREFIXES.PROVEEDORES } },
        { codigo: { startsWith: PREFIXES.ADUANA } },
        { codigo: { startsWith: PREFIXES.FISCALES } },
      ],
    },
    select: {
      id: true,
      codigo: true,
      nombre: true,
      tipo: true,
      proveedores: {
        select: {
          id: true,
          nombre: true,
          cuit: true,
          pais: true,
          estado: true,
        },
        orderBy: { nombre: "asc" },
      },
    },
    orderBy: { codigo: "asc" },
  });

  const cuentaIds = cuentas.map((c) => c.id);
  const sums = cuentaIds.length
    ? await db.lineaAsiento.groupBy({
        by: ["cuentaId"],
        where: {
          cuentaId: { in: cuentaIds },
          asiento: { estado: AsientoEstado.CONTABILIZADO },
        },
        _sum: { debe: true, haber: true },
      })
    : [];

  const saldoPorCuenta = new Map<number, string>(
    sums.map((s) => {
      const haber = toDecimal(s._sum.haber ?? 0);
      const debe = toDecimal(s._sum.debe ?? 0);
      return [s.cuentaId, haber.minus(debe).toFixed(2)];
    }),
  );

  const proveedoresComerciales: CxPRow[] = [];
  const aduana: CxPRow[] = [];
  const fiscales: CxPRow[] = [];
  let totalGeneral = toDecimal(0);

  for (const c of cuentas) {
    if (c.tipo !== "ANALITICA") continue;
    const saldoStr = saldoPorCuenta.get(c.id) ?? "0";
    const saldo = toDecimal(saldoStr);
    if (!saldo.gt(0)) continue;

    const row: CxPRow = {
      cuentaId: c.id,
      cuentaCodigo: c.codigo,
      cuentaNombre: c.nombre,
      saldo: saldoStr,
      proveedores: c.proveedores,
    };

    if (c.codigo.startsWith(PREFIXES.PROVEEDORES)) {
      proveedoresComerciales.push(row);
    } else if (c.codigo.startsWith(PREFIXES.ADUANA)) {
      aduana.push(row);
    } else if (c.codigo.startsWith(PREFIXES.FISCALES)) {
      fiscales.push(row);
    }

    totalGeneral = totalGeneral.plus(saldo);
  }

  return {
    proveedoresComerciales,
    aduana,
    fiscales,
    totalGeneral: totalGeneral.toFixed(2),
  };
}

// Saldo por proveedor individual (cuando cada proveedor tiene su propia
// cuenta analítica). Útil para la lista "Pendientes por proveedor".
export type SaldoProveedor = {
  proveedorId: string;
  proveedorNombre: string;
  cuentaId: number;
  cuentaCodigo: string;
  cuentaNombre: string;
  saldo: string;
};

export async function getSaldosPorProveedor(): Promise<SaldoProveedor[]> {
  const proveedores = await db.proveedor.findMany({
    where: { cuentaContableId: { not: null } },
    select: {
      id: true,
      nombre: true,
      cuentaContableId: true,
      cuentaContable: { select: { codigo: true, nombre: true } },
    },
    orderBy: { nombre: "asc" },
  });

  const cuentaIds = proveedores
    .map((p) => p.cuentaContableId)
    .filter((id): id is number => id !== null);

  const sums = cuentaIds.length
    ? await db.lineaAsiento.groupBy({
        by: ["cuentaId"],
        where: {
          cuentaId: { in: cuentaIds },
          asiento: { estado: AsientoEstado.CONTABILIZADO },
        },
        _sum: { debe: true, haber: true },
      })
    : [];

  const saldoPorCuenta = new Map<number, string>(
    sums.map((s) => {
      const haber = toDecimal(s._sum.haber ?? 0);
      const debe = toDecimal(s._sum.debe ?? 0);
      return [s.cuentaId, haber.minus(debe).toFixed(2)];
    }),
  );

  return proveedores
    .map((p) => ({
      proveedorId: p.id,
      proveedorNombre: p.nombre,
      cuentaId: p.cuentaContableId!,
      cuentaCodigo: p.cuentaContable!.codigo,
      cuentaNombre: p.cuentaContable!.nombre,
      saldo: saldoPorCuenta.get(p.cuentaContableId!) ?? "0.00",
    }))
    .filter((r) => toDecimal(r.saldo).gt(0));
}
