import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon } from "@hugeicons/core-free-icons";

import { db } from "@/lib/db";
import { listarPrestamosPorCuentaContable } from "@/lib/services/prestamo";
import {
  MovimientoTesoreriaTipo,
  PeriodoEstado,
  Prisma,
} from "@/generated/prisma/client";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

import {
  MovimientosFilters,
  type CuentaBancariaOption,
  type PeriodoOption,
} from "./movimientos-filters";
import {
  MovimientosTable,
  type MovimientoRow,
} from "./movimientos-table";

const TIPO_VALUES = new Set<MovimientoTesoreriaTipo>([
  MovimientoTesoreriaTipo.COBRO,
  MovimientoTesoreriaTipo.PAGO,
  MovimientoTesoreriaTipo.TRANSFERENCIA,
]);

function parseTipo(value: string | undefined): MovimientoTesoreriaTipo | null {
  if (!value) return null;
  return TIPO_VALUES.has(value as MovimientoTesoreriaTipo)
    ? (value as MovimientoTesoreriaTipo)
    : null;
}

function parsePeriodoId(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseUuid(value: string | undefined): string | null {
  if (!value) return null;
  return /^[0-9a-f-]{36}$/i.test(value) ? value : null;
}

type SearchParams = Promise<{
  cuentaId?: string;
  periodoId?: string;
  tipo?: string;
}>;

export default async function MovimientosPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;

  const [periodos, cuentasBancarias] = await Promise.all([
    db.periodoContable.findMany({
      orderBy: { codigo: "desc" },
      select: {
        id: true,
        codigo: true,
        estado: true,
        fechaInicio: true,
        fechaFin: true,
      },
    }),
    db.cuentaBancaria.findMany({
      orderBy: [{ banco: "asc" }, { moneda: "asc" }],
      select: {
        id: true,
        banco: true,
        moneda: true,
        numero: true,
      },
    }),
  ]);

  const tipoFilter = parseTipo(params.tipo);
  const periodoIdFromUrl = parsePeriodoId(params.periodoId);
  const cuentaIdFromUrl = parseUuid(params.cuentaId);

  const now = new Date();
  const defaultPeriodo =
    periodos.find(
      (p) =>
        p.estado === PeriodoEstado.ABIERTO &&
        p.fechaInicio <= now &&
        p.fechaFin >= now,
    ) ??
    periodos.find((p) => p.estado === PeriodoEstado.ABIERTO) ??
    periodos[0] ??
    null;

  let periodoIdFilter: number | null;
  if (params.periodoId === "all") {
    periodoIdFilter = null;
  } else if (periodoIdFromUrl !== null) {
    periodoIdFilter = periodoIdFromUrl;
  } else {
    periodoIdFilter = defaultPeriodo?.id ?? null;
  }

  const cuentaIdFilter = params.cuentaId === "all" ? null : cuentaIdFromUrl;

  const where: Prisma.MovimientoTesoreriaWhereInput = {};
  if (tipoFilter) where.tipo = tipoFilter;
  if (cuentaIdFilter) where.cuentaBancariaId = cuentaIdFilter;
  if (periodoIdFilter !== null) {
    where.asiento = { periodoId: periodoIdFilter };
  }

  const movimientos = await db.movimientoTesoreria.findMany({
    where,
    orderBy: [{ fecha: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      tipo: true,
      fecha: true,
      monto: true,
      moneda: true,
      tipoCambio: true,
      descripcion: true,
      comprobante: true,
      cuentaContableId: true,
      cuentaBancaria: {
        select: {
          id: true,
          banco: true,
          moneda: true,
          numero: true,
        },
      },
      cuentaContable: {
        select: { codigo: true, nombre: true },
      },
      asiento: {
        select: {
          id: true,
          numero: true,
          estado: true,
          periodo: { select: { codigo: true } },
        },
      },
    },
  });

  const cuentaContableIds = Array.from(
    new Set(movimientos.map((m) => m.cuentaContableId)),
  );
  const prestamosPorCuenta =
    await listarPrestamosPorCuentaContable(cuentaContableIds);

  const rows: MovimientoRow[] = movimientos.map((m) => {
    const prestamo = prestamosPorCuenta.get(m.cuentaContableId);
    return {
      id: m.id,
      tipo: m.tipo,
      fecha: m.fecha,
      monto: m.monto.toFixed(2),
      moneda: m.moneda,
      tipoCambio: m.tipoCambio.toString(),
      descripcion: m.descripcion,
      comprobante: m.comprobante,
      cuentaBancaria: {
        id: m.cuentaBancaria.id,
        banco: m.cuentaBancaria.banco,
        moneda: m.cuentaBancaria.moneda,
        numero: m.cuentaBancaria.numero,
      },
      cuentaContable: {
        codigo: m.cuentaContable.codigo,
        nombre: m.cuentaContable.nombre,
      },
      asiento: m.asiento
        ? {
            id: m.asiento.id,
            numero: m.asiento.numero,
            estado: m.asiento.estado,
            periodoCodigo: m.asiento.periodo.codigo,
          }
        : null,
      prestamo: prestamo
        ? { id: prestamo.prestamoId, prestamista: prestamo.prestamista }
        : null,
    };
  });

  const periodoOptions: PeriodoOption[] = periodos.map((p) => ({
    id: p.id,
    codigo: p.codigo,
    estado: p.estado,
  }));

  const cuentaOptions: CuentaBancariaOption[] = cuentasBancarias.map((c) => ({
    id: c.id,
    banco: c.banco,
    moneda: c.moneda,
    numero: c.numero,
  }));

  const periodoCodigo =
    periodoIdFilter !== null
      ? periodos.find((p) => p.id === periodoIdFilter)?.codigo
      : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Movimientos</h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} movimiento{rows.length === 1 ? "" : "s"}
            {periodoCodigo
              ? ` · período ${periodoCodigo}`
              : " · todos los períodos"}
          </p>
        </div>
        <Link
          href="/tesoreria/movimientos/nuevo"
          className={buttonVariants({ variant: "default" })}
        >
          <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
          Nuevo movimiento
        </Link>
      </div>

      <MovimientosFilters
        periodos={periodoOptions}
        cuentas={cuentaOptions}
        selectedPeriodoId={
          periodoIdFilter !== null ? String(periodoIdFilter) : "all"
        }
        selectedCuentaId={cuentaIdFilter ?? "all"}
        selectedTipo={tipoFilter ?? "all"}
      />

      <Card className="py-0">
        <MovimientosTable data={rows} />
      </Card>
    </div>
  );
}
