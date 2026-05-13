import { db } from "@/lib/db";
import { AsientoEstado, PeriodoEstado, Prisma } from "@/generated/prisma/client";
import { Card } from "@/components/ui/card";

import { MoverPeriodoForm, type AsientoRow, type PeriodoOption } from "./mover-form";
import { MoverPeriodoFilters } from "./mover-filters";

const ESTADO_VALUES = new Set<AsientoEstado>([AsientoEstado.BORRADOR, AsientoEstado.CONTABILIZADO]);

function parseEstado(value: string | undefined): AsientoEstado | null {
  if (!value) return null;
  return ESTADO_VALUES.has(value as AsientoEstado) ? (value as AsientoEstado) : null;
}

function parsePeriodoId(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

type SearchParams = Promise<{
  periodoOrigenId?: string;
  estado?: string;
  q?: string;
}>;

export default async function MoverPeriodoPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const periodoOrigenId = parsePeriodoId(params.periodoOrigenId);
  const estadoFilter = parseEstado(params.estado);
  const qFilter = params.q?.trim() ?? "";

  const periodos = await db.periodoContable.findMany({
    orderBy: { fechaInicio: "desc" },
    select: {
      id: true,
      codigo: true,
      nombre: true,
      estado: true,
      fechaInicio: true,
      fechaFin: true,
    },
  });

  const periodoOptions: PeriodoOption[] = periodos.map((p) => ({
    id: p.id,
    codigo: p.codigo,
    nombre: p.nombre,
    estado: p.estado,
  }));

  let rows: AsientoRow[] = [];
  let origenCerrado = false;
  let origenInfo: { codigo: string; nombre: string } | null = null;

  if (periodoOrigenId) {
    const origen = periodos.find((p) => p.id === periodoOrigenId);
    if (origen) {
      origenCerrado = origen.estado === PeriodoEstado.CERRADO;
      origenInfo = { codigo: origen.codigo, nombre: origen.nombre };
    }

    const where: Prisma.AsientoWhereInput = {
      periodoId: periodoOrigenId,
      estado: { not: AsientoEstado.ANULADO },
    };
    if (estadoFilter) where.estado = estadoFilter;
    if (qFilter.length > 0) {
      where.descripcion = { contains: qFilter, mode: "insensitive" };
    }

    const asientos = await db.asiento.findMany({
      where,
      orderBy: [{ fecha: "asc" }, { numero: "asc" }],
      select: {
        id: true,
        numero: true,
        fecha: true,
        descripcion: true,
        estado: true,
        origen: true,
        moneda: true,
        totalDebe: true,
        periodo: { select: { codigo: true } },
      },
    });

    rows = asientos.map((a) => ({
      id: a.id,
      numero: a.numero,
      fecha: a.fecha,
      descripcion: a.descripcion,
      estado: a.estado,
      origen: a.origen,
      moneda: a.moneda,
      totalDebe: a.totalDebe.toFixed(2),
      periodoCodigo: a.periodo.codigo,
    }));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="text-[15px] font-semibold tracking-tight">Mover asientos de período</h1>
        <p className="text-sm text-muted-foreground">
          Remapeá asientos al período contable correcto sin alterar la fecha. Útil para entradas
          retroactivas.
        </p>
      </div>

      <MoverPeriodoFilters
        periodos={periodoOptions}
        selectedPeriodoOrigenId={periodoOrigenId ?? null}
        selectedEstado={estadoFilter ?? "all"}
        query={qFilter}
      />

      {periodoOrigenId === null ? (
        <Card className="px-4 py-8 text-center text-sm text-muted-foreground">
          Seleccioná un período origen para listar sus asientos.
        </Card>
      ) : origenCerrado ? (
        <Card className="border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          El período origen <span className="font-mono">{origenInfo?.codigo}</span> está{" "}
          <strong>CERRADO</strong>. Reabrilo en{" "}
          <a href="/contabilidad/periodos" className="underline">
            /contabilidad/periodos
          </a>{" "}
          antes de mover.
        </Card>
      ) : rows.length === 0 ? (
        <Card className="px-4 py-8 text-center text-sm text-muted-foreground">
          No hay asientos no anulados en el período {origenInfo?.codigo} con los filtros aplicados.
        </Card>
      ) : (
        <MoverPeriodoForm
          key={`${periodoOrigenId}|${estadoFilter ?? ""}|${qFilter}`}
          asientos={rows}
          periodos={periodoOptions}
          periodoOrigenId={periodoOrigenId}
        />
      )}
    </div>
  );
}
