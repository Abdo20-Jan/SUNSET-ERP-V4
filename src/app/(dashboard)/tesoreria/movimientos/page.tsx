import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon } from "@hugeicons/core-free-icons";

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { getCotizacionParaFecha } from "@/lib/services/cotizacion";
import { listarPrestamosPorCuentaContable } from "@/lib/services/prestamo";
import { Prisma } from "@/generated/prisma/client";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DateRangeFilter } from "@/components/date-range-filter";

import { MonedaToggle, type Moneda } from "../../reportes/_components/moneda-toggle";
import { MovimientosWorklist } from "./movimientos-worklist";
import type { MovimientoWorklistRow } from "./movimientos-columns";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
  desde?: string;
  hasta?: string;
  moneda?: string;
}>;

export const dynamic = "force-dynamic";

export default async function MovimientosPage({ searchParams }: { searchParams: SearchParams }) {
  const [params, session, cotizacion] = await Promise.all([
    searchParams,
    auth(),
    getCotizacionParaFecha(new Date()),
  ]);

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

  const desdeStr = params.desde ?? firstOfMonthIso();
  const hastaStr = params.hasta ?? todayIso();
  const fechaDesde = parseDate(desdeStr);
  const fechaHasta = endOfDay(hastaStr);

  const where: Prisma.MovimientoTesoreriaWhereInput = {};
  if (fechaDesde || fechaHasta) {
    where.fecha = {
      ...(fechaDesde && { gte: fechaDesde }),
      ...(fechaHasta && { lte: fechaHasta }),
    };
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
  });

  const cuentaContableIds = Array.from(new Set(movimientos.map((m) => m.cuentaContableId)));
  const prestamosPorCuenta = await listarPrestamosPorCuentaContable(cuentaContableIds);

  const rows: MovimientoWorklistRow[] = movimientos.map((m) => {
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
      banco: m.cuentaBancaria.banco,
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

  const total = rows.length;
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

      <DateRangeFilter initialDesde={desdeStr} initialHasta={hastaStr} />

      <Card className="py-0 p-3">
        <MovimientosWorklist rows={rows} moneda={moneda} tc={tc} />
      </Card>
    </div>
  );
}
