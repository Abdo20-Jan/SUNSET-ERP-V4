import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon } from "@hugeicons/core-free-icons";

import { db } from "@/lib/db";
import { AsientoEstado, Prisma } from "@/generated/prisma/client";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DateRangeFilter } from "@/components/date-range-filter";

import { AsientosFilters } from "./asientos-filters";
import { AsientosTable, type AsientoRow } from "./asientos-table";

const ESTADO_VALUES = new Set<AsientoEstado>([
  AsientoEstado.BORRADOR,
  AsientoEstado.CONTABILIZADO,
  AsientoEstado.ANULADO,
]);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseEstado(value: string | undefined): AsientoEstado | null {
  if (!value) return null;
  return ESTADO_VALUES.has(value as AsientoEstado)
    ? (value as AsientoEstado)
    : null;
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value || !DATE_RE.test(value)) return undefined;
  const d = new Date(value + "T00:00:00Z");
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function endOfDay(value: string | undefined): Date | undefined {
  if (!value || !DATE_RE.test(value)) return undefined;
  const d = new Date(value + "T23:59:59.999Z");
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function firstOfMonthIso(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .slice(0, 10);
}

type SearchParams = Promise<{
  desde?: string;
  hasta?: string;
  estado?: string;
  q?: string;
}>;

export default async function AsientosPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;

  const estadoFilter = parseEstado(params.estado);
  const qFilter = params.q?.trim() ?? "";

  const desdeStr = params.desde ?? firstOfMonthIso();
  const hastaStr = params.hasta ?? todayIso();
  const fechaDesde = parseDate(desdeStr);
  const fechaHasta = endOfDay(hastaStr);

  const where: Prisma.AsientoWhereInput = {};
  if (fechaDesde || fechaHasta) {
    where.fecha = {
      ...(fechaDesde && { gte: fechaDesde }),
      ...(fechaHasta && { lte: fechaHasta }),
    };
  }
  if (estadoFilter) where.estado = estadoFilter;
  if (qFilter.length > 0) {
    where.descripcion = { contains: qFilter, mode: "insensitive" };
  }

  const asientos = await db.asiento.findMany({
    where,
    orderBy: [{ fecha: "desc" }, { numero: "desc" }],
    select: {
      id: true,
      numero: true,
      fecha: true,
      descripcion: true,
      estado: true,
      origen: true,
      moneda: true,
      totalDebe: true,
      totalHaber: true,
      periodo: { select: { codigo: true } },
    },
  });

  const rows: AsientoRow[] = asientos.map((a) => ({
    id: a.id,
    numero: a.numero,
    fecha: a.fecha,
    descripcion: a.descripcion,
    estado: a.estado,
    origen: a.origen,
    moneda: a.moneda,
    totalDebe: a.totalDebe.toFixed(2),
    totalHaber: a.totalHaber.toFixed(2),
    periodoCodigo: a.periodo.codigo,
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
          <h1 className="text-[15px] font-semibold tracking-tight">Asientos</h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} asiento{rows.length === 1 ? "" : "s"} · {rangoLabel}
          </p>
        </div>
        <Link
          href="/contabilidad/asientos/nuevo"
          className={buttonVariants({ variant: "default" })}
        >
          <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
          Nuevo asiento
        </Link>
      </div>

      <div className="flex flex-col gap-3">
        <DateRangeFilter initialDesde={desdeStr} initialHasta={hastaStr} />
        <AsientosFilters
          selectedEstado={estadoFilter ?? "all"}
          query={qFilter}
        />
      </div>

      <Card className="py-0">
        <AsientosTable data={rows} />
      </Card>
    </div>
  );
}
