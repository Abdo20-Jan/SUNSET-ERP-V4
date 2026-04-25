import "server-only";

import Decimal from "decimal.js";

import { db } from "@/lib/db";
import { toDecimal } from "@/lib/decimal";
import { calcularSaldosCuentasBancarias } from "@/lib/services/cuenta-bancaria";
import { calcularSaldosPrestamos } from "@/lib/services/prestamo";
import {
  AsientoEstado,
  CuentaCategoria,
  CuentaTipo,
  EmbarqueEstado,
  Moneda,
  PeriodoEstado,
} from "@/generated/prisma/client";

export type KpisPrincipales = {
  saldoBancosCaja: Decimal;
  totalPasivo: Decimal;
  resultadoEjercicio: Decimal;
  asientosContabilizados: number;
};

export type KpisSecundarios = {
  embarquesActivos: number;
  clientesActivos: number;
  proveedoresActivos: number;
  cuentasBancariasActivas: number;
};

export type SaldoBancario = {
  cuentaId: number;
  codigo: string;
  nombre: string;
  banco: string | null;
  moneda: Moneda;
  saldo: Decimal;
};

export type UltimoAsiento = {
  id: string;
  numero: number;
  fecha: Date;
  descripcion: string;
  total: Decimal;
};

export type EmbarqueReciente = {
  id: string;
  codigo: string;
  estado: EmbarqueEstado;
  createdAt: Date;
  proveedor: { id: string; nombre: string };
};

export type PrestamoActivo = {
  id: string;
  prestamista: string;
  moneda: Moneda;
  principal: Decimal;
  tipoCambio: Decimal;
  equivalenteARS: Decimal;
  saldoPendiente: Decimal;
};

export type AlertaSeveridad = "critical" | "warning";

export type AlertaId =
  | "sin-periodo"
  | "periodos-vencidos"
  | "asientos-borrador"
  | "asientos-descuadrados";

export type Alerta = {
  id: AlertaId;
  severidad: AlertaSeveridad;
  titulo: string;
  detalle: string;
  href: string;
};

export async function getKpisPrincipales(): Promise<KpisPrincipales> {
  const [bancosCaja, pasivo, ingresos, egresos, asientosCount] =
    await Promise.all([
      db.lineaAsiento.aggregate({
        where: {
          asiento: { estado: AsientoEstado.CONTABILIZADO },
          cuenta: {
            tipo: CuentaTipo.ANALITICA,
            OR: [
              { codigo: { startsWith: "1.1.1." } },
              { codigo: { startsWith: "1.1.2." } },
            ],
          },
        },
        _sum: { debe: true, haber: true },
      }),
      db.lineaAsiento.aggregate({
        where: {
          asiento: { estado: AsientoEstado.CONTABILIZADO },
          cuenta: {
            tipo: CuentaTipo.ANALITICA,
            categoria: CuentaCategoria.PASIVO,
          },
        },
        _sum: { debe: true, haber: true },
      }),
      db.lineaAsiento.aggregate({
        where: {
          asiento: { estado: AsientoEstado.CONTABILIZADO },
          cuenta: {
            tipo: CuentaTipo.ANALITICA,
            categoria: CuentaCategoria.INGRESO,
          },
        },
        _sum: { debe: true, haber: true },
      }),
      db.lineaAsiento.aggregate({
        where: {
          asiento: { estado: AsientoEstado.CONTABILIZADO },
          cuenta: {
            tipo: CuentaTipo.ANALITICA,
            categoria: CuentaCategoria.EGRESO,
          },
        },
        _sum: { debe: true, haber: true },
      }),
      db.asiento.count({
        where: { estado: AsientoEstado.CONTABILIZADO },
      }),
    ]);

  const saldoBancosCaja = toDecimal(bancosCaja._sum.debe ?? 0)
    .minus(toDecimal(bancosCaja._sum.haber ?? 0))
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  const totalPasivo = toDecimal(pasivo._sum.haber ?? 0)
    .minus(toDecimal(pasivo._sum.debe ?? 0))
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  const totalIngresos = toDecimal(ingresos._sum.haber ?? 0).minus(
    toDecimal(ingresos._sum.debe ?? 0),
  );
  const totalEgresos = toDecimal(egresos._sum.debe ?? 0).minus(
    toDecimal(egresos._sum.haber ?? 0),
  );
  const resultadoEjercicio = totalIngresos
    .minus(totalEgresos)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  return {
    saldoBancosCaja,
    totalPasivo,
    resultadoEjercicio,
    asientosContabilizados: asientosCount,
  };
}

export async function getKpisSecundarios(): Promise<KpisSecundarios> {
  const [embarques, clientes, proveedores, bancarias] = await Promise.all([
    db.embarque.count({
      where: { NOT: { estado: EmbarqueEstado.CERRADO } },
    }),
    db.cliente.count({ where: { estado: "activo" } }),
    db.proveedor.count({ where: { estado: "activo" } }),
    db.cuentaBancaria.count({
      where: { cuentaContable: { activa: true } },
    }),
  ]);

  return {
    embarquesActivos: embarques,
    clientesActivos: clientes,
    proveedoresActivos: proveedores,
    cuentasBancariasActivas: bancarias,
  };
}

function inferirMonedaPorNombre(nombre: string): Moneda {
  return /D[ÓO]LAR/i.test(nombre) ? Moneda.USD : Moneda.ARS;
}

export async function getSaldosBancarios(): Promise<SaldoBancario[]> {
  const cuentas = await db.cuentaContable.findMany({
    where: {
      tipo: CuentaTipo.ANALITICA,
      activa: true,
      OR: [
        { codigo: { startsWith: "1.1.1." } },
        { codigo: { startsWith: "1.1.2." } },
      ],
    },
    select: {
      id: true,
      codigo: true,
      nombre: true,
      cuentasBancarias: {
        select: { banco: true, moneda: true },
        take: 1,
      },
    },
    orderBy: { codigo: "asc" },
  });

  if (cuentas.length === 0) return [];

  const saldos = await calcularSaldosCuentasBancarias(cuentas.map((c) => c.id));

  return cuentas.map((c) => {
    const cb = c.cuentasBancarias[0];
    const moneda = cb?.moneda ?? inferirMonedaPorNombre(c.nombre);
    return {
      cuentaId: c.id,
      codigo: c.codigo,
      nombre: c.nombre,
      banco: cb?.banco ?? null,
      moneda,
      saldo: saldos.get(c.id) ?? new Decimal(0),
    };
  });
}

export async function getUltimosAsientos(): Promise<UltimoAsiento[]> {
  const rows = await db.asiento.findMany({
    where: { estado: AsientoEstado.CONTABILIZADO },
    orderBy: [{ fecha: "desc" }, { numero: "desc" }],
    take: 10,
    select: {
      id: true,
      numero: true,
      fecha: true,
      descripcion: true,
      totalDebe: true,
    },
  });

  return rows.map((r) => ({
    id: r.id,
    numero: r.numero,
    fecha: r.fecha,
    descripcion: r.descripcion,
    total: toDecimal(r.totalDebe).toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
  }));
}

export async function getEmbarquesRecientes(): Promise<EmbarqueReciente[]> {
  const rows = await db.embarque.findMany({
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true,
      codigo: true,
      estado: true,
      createdAt: true,
      proveedor: { select: { id: true, nombre: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    codigo: r.codigo,
    estado: r.estado,
    createdAt: r.createdAt,
    proveedor: { id: r.proveedor.id, nombre: r.proveedor.nombre },
  }));
}

export async function getPrestamosActivos(): Promise<PrestamoActivo[]> {
  const prestamos = await db.prestamoExterno.findMany({
    where: { asiento: { estado: AsientoEstado.CONTABILIZADO } },
    select: {
      id: true,
      prestamista: true,
      moneda: true,
      principal: true,
      tipoCambio: true,
      cuentaContableId: true,
    },
    orderBy: { createdAt: "desc" },
  });

  if (prestamos.length === 0) return [];

  const saldos = await calcularSaldosPrestamos(
    prestamos.map((p) => p.cuentaContableId),
  );

  return prestamos
    .map((p) => {
      const principal = toDecimal(p.principal).toDecimalPlaces(
        2,
        Decimal.ROUND_HALF_UP,
      );
      const tipoCambio = toDecimal(p.tipoCambio).toDecimalPlaces(
        6,
        Decimal.ROUND_HALF_UP,
      );
      const saldoPendiente = saldos.get(p.cuentaContableId) ?? new Decimal(0);
      const equivalenteARS = principal
        .times(tipoCambio)
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      return {
        id: p.id,
        prestamista: p.prestamista,
        moneda: p.moneda,
        principal,
        tipoCambio,
        equivalenteARS,
        saldoPendiente,
      };
    })
    .filter((p) => p.saldoPendiente.gt(0));
}

export async function getAlertasDashboard(): Promise<Alerta[]> {
  const ahora = new Date();

  const [
    periodosAbiertos,
    periodosVencidos,
    asientosBorrador,
    descuadradosRows,
  ] = await Promise.all([
    db.periodoContable.count({ where: { estado: PeriodoEstado.ABIERTO } }),
    db.periodoContable.count({
      where: { estado: PeriodoEstado.ABIERTO, fechaFin: { lt: ahora } },
    }),
    db.asiento.count({ where: { estado: AsientoEstado.BORRADOR } }),
    db.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count
      FROM "Asiento"
      WHERE estado = 'CONTABILIZADO'
        AND "totalDebe" <> "totalHaber"
    `,
  ]);

  const descuadrados = Number(descuadradosRows[0]?.count ?? 0);
  const alertas: Alerta[] = [];

  if (periodosAbiertos === 0) {
    alertas.push({
      id: "sin-periodo",
      severidad: "critical",
      titulo: "Sin período contable abierto",
      detalle: "No hay período contable abierto. Abrí uno para registrar asientos.",
      href: "/contabilidad/periodos",
    });
  }

  if (descuadrados > 0) {
    alertas.push({
      id: "asientos-descuadrados",
      severidad: "critical",
      titulo: "Asientos descuadrados",
      detalle: `${descuadrados} asiento${descuadrados === 1 ? "" : "s"} contabilizado${descuadrados === 1 ? "" : "s"} con totalDebe ≠ totalHaber.`,
      href: "/contabilidad/asientos",
    });
  }

  if (periodosVencidos > 0) {
    alertas.push({
      id: "periodos-vencidos",
      severidad: "warning",
      titulo: "Períodos abiertos vencidos",
      detalle: `${periodosVencidos} período${periodosVencidos === 1 ? "" : "s"} con fecha de fin pasada y aún abierto${periodosVencidos === 1 ? "" : "s"}.`,
      href: "/contabilidad/periodos",
    });
  }

  if (asientosBorrador > 0) {
    alertas.push({
      id: "asientos-borrador",
      severidad: "warning",
      titulo: "Asientos en borrador",
      detalle: `${asientosBorrador} asiento${asientosBorrador === 1 ? "" : "s"} pendiente${asientosBorrador === 1 ? "" : "s"} de contabilización.`,
      href: "/contabilidad/asientos",
    });
  }

  return alertas;
}
