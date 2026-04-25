import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon } from "@hugeicons/core-free-icons";

import { db } from "@/lib/db";
import {
  AsientoEstado,
  PeriodoEstado,
  Prisma,
} from "@/generated/prisma/client";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

import { AsientosFilters, type PeriodoOption } from "./asientos-filters";
import { AsientosTable, type AsientoRow } from "./asientos-table";

const ESTADO_VALUES = new Set<AsientoEstado>([
  AsientoEstado.BORRADOR,
  AsientoEstado.CONTABILIZADO,
  AsientoEstado.ANULADO,
]);

function parseEstado(value: string | undefined): AsientoEstado | null {
  if (!value) return null;
  return ESTADO_VALUES.has(value as AsientoEstado)
    ? (value as AsientoEstado)
    : null;
}

function parsePeriodoId(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

type SearchParams = Promise<{
  periodoId?: string;
  estado?: string;
  q?: string;
}>;

export default async function AsientosPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;

  const periodos = await db.periodoContable.findMany({
    orderBy: { codigo: "desc" },
    select: {
      id: true,
      codigo: true,
      estado: true,
      fechaInicio: true,
      fechaFin: true,
    },
  });

  const estadoFilter = parseEstado(params.estado);
  const qFilter = params.q?.trim() ?? "";
  const periodoIdFromUrl = parsePeriodoId(params.periodoId);

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

  const where: Prisma.AsientoWhereInput = {};
  if (periodoIdFilter !== null) where.periodoId = periodoIdFilter;
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

  const periodoOptions: PeriodoOption[] = periodos.map((p) => ({
    id: p.id,
    codigo: p.codigo,
    estado: p.estado,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Asientos</h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} asiento{rows.length === 1 ? "" : "s"}
            {periodoIdFilter !== null
              ? ` · período ${
                  periodos.find((p) => p.id === periodoIdFilter)?.codigo ?? ""
                }`
              : " · todos los períodos"}
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

      <AsientosFilters
        periodos={periodoOptions}
        selectedPeriodoId={
          periodoIdFilter !== null ? String(periodoIdFilter) : "all"
        }
        selectedEstado={estadoFilter ?? "all"}
        query={qFilter}
      />

      <Card className="py-0">
        <AsientosTable data={rows} />
      </Card>
    </div>
  );
}
