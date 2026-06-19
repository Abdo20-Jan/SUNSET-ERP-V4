import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon } from "@hugeicons/core-free-icons";

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { getCotizacionParaFecha } from "@/lib/services/cotizacion";
import { listarPrestamosPorCuentaContable } from "@/lib/services/prestamo";
import { MovimientoTesoreriaTipo, Prisma } from "@/generated/prisma/client";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Pagination } from "@/components/ui/pagination";
import { parsePaginationParams } from "@/components/ui/pagination-params";
import { DateRangeFilter } from "@/components/date-range-filter";

import { MonedaToggle, type Moneda } from "../../reportes/_components/moneda-toggle";
import { MovimientosFilters, type CuentaBancariaOption } from "./movimientos-filters";
import { MovimientosTable, type MovimientoRow } from "./movimientos-table";

const TIPO_VALUES = new Set<MovimientoTesoreriaTipo>([
  MovimientoTesoreriaTipo.COBRO,
  MovimientoTesoreriaTipo.PAGO,
  MovimientoTesoreriaTipo.TRANSFERENCIA,
]);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseTipo(value: string | undefined): MovimientoTesoreriaTipo | null {
  if (!value) return null;
  return TIPO_VALUES.has(value as MovimientoTesoreriaTipo)
    ? (value as MovimientoTesoreriaTipo)
    : null;
}

function parseUuid(value: string | undefined): string | null {
  if (!value) return null;
  return /^[0-9a-f-]{36}$/i.test(value) ? value : null;
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value || !DATE_RE.test(value)) return undefined;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function endOfDay(value: string | undefined): Date | undefined {
  if (!value || !DATE_RE.test(value)) return undefined;
  const d = new Date(`${value}T23:59:59.999Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function firstOfMonthIso(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
}

type SearchParams = Promise<{
  cuentaId?: string;
  desde?: string;
  hasta?: string;
  tipo?: string;
  moneda?: string;
  page?: string;
  perPage?: string;
}>;

export const dynamic = "force-dynamic";

export default async function MovimientosPage({ searchParams }: { searchParams: SearchParams }) {
  const [params, session, cotizacion] = await Promise.all([
    searchParams,
    auth(),
    getCotizacionParaFecha(new Date()),
  ]);

  const { page, perPage } = parsePaginationParams(params);

  const monedaPreferida: Moneda = session?.user.monedaPreferida === "ARS" ? "ARS" : "USD";
  const moneda: Moneda =
    params.moneda === "ARS" ? "ARS" : params.moneda === "USD" ? "USD" : monedaPreferida;
  const tc = cotizacion ? cotizacion.valor.toString() : null;
  const tcInfo = cotizacion
    ? {
        valor: cotizacion.valor.toString(),
        fecha: cotizacion.fecha.toISOString().slice(0, 10),
        fuente: cotizacion.fuente,
      }
    : null;

  const cuentasBancarias = await db.cuentaBancaria.findMany({
    orderBy: [{ banco: "asc" }, { moneda: "asc" }],
    select: {
      id: true,
      banco: true,
      moneda: true,
      numero: true,
    },
  });

  const tipoFilter = parseTipo(params.tipo);
  const cuentaIdFromUrl = parseUuid(params.cuentaId);

  const desdeStr = params.desde ?? firstOfMonthIso();
  const hastaStr = params.hasta ?? todayIso();
  const fechaDesde = parseDate(desdeStr);
  const fechaHasta = endOfDay(hastaStr);

  const cuentaIdFilter = params.cuentaId === "all" ? null : cuentaIdFromUrl;

  const where: Prisma.MovimientoTesoreriaWhereInput = {};
  if (tipoFilter) where.tipo = tipoFilter;
  if (cuentaIdFilter) where.cuentaBancariaId = cuentaIdFilter;
  if (fechaDesde || fechaHasta) {
    where.fecha = {
      ...(fechaDesde && { gte: fechaDesde }),
      ...(fechaHasta && { lte: fechaHasta }),
    };
  }

  const [movimientos, total] = await Promise.all([
    db.movimientoTesoreria.findMany({
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
        referenciaBanco: true,
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
      take: perPage,
      skip: (page - 1) * perPage,
    }),
    db.movimientoTesoreria.count({ where }),
  ]);

  const cuentaContableIds = Array.from(new Set(movimientos.map((m) => m.cuentaContableId)));
  const prestamosPorCuenta = await listarPrestamosPorCuentaContable(cuentaContableIds);

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
      referenciaBanco: m.referenciaBanco,
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
      prestamo: prestamo ? { id: prestamo.prestamoId, prestamista: prestamo.prestamista } : null,
    };
  });

  const cuentaOptions: CuentaBancariaOption[] = cuentasBancarias.map((c) => ({
    id: c.id,
    banco: c.banco,
    moneda: c.moneda,
    numero: c.numero,
  }));

  const rangoLabel =
    fechaDesde && fechaHasta
      ? `del ${desdeStr} al ${hastaStr}`
      : fechaHasta
        ? `hasta ${hastaStr}`
        : fechaDesde
          ? `desde ${desdeStr}`
          : "histórico completo";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[15px] font-semibold tracking-tight">Movimientos</h1>
          <p className="text-sm text-muted-foreground">
            {total} movimiento{total === 1 ? "" : "s"} · {rangoLabel}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <MonedaToggle current={moneda} tcInfo={tcInfo} />
          <Link
            href="/tesoreria/movimientos/nuevo"
            className={buttonVariants({ variant: "default" })}
          >
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
            Nuevo movimiento
          </Link>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <DateRangeFilter initialDesde={desdeStr} initialHasta={hastaStr} />
        <MovimientosFilters
          cuentas={cuentaOptions}
          selectedCuentaId={cuentaIdFilter ?? "all"}
          selectedTipo={tipoFilter ?? "all"}
        />
      </div>

      <Card className="py-0">
        <MovimientosTable data={rows} moneda={moneda} tc={tc} />
        <Pagination page={page} perPage={perPage} total={total} className="border-t" />
      </Card>
    </div>
  );
}
