import { db } from "@/lib/db";
import { getLibroDiario } from "@/lib/services/reportes";
import { getCotizacionParaFecha } from "@/lib/services/cotizacion";
import { PeriodoEstado } from "@/generated/prisma/client";
import { Card } from "@/components/ui/card";
import { convertirAUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

import { PeriodoSelect, type PeriodoOption } from "../_components/periodo-select";
import { MonedaToggle, type Moneda } from "../_components/moneda-toggle";
import { fmtMoney } from "../_components/money";
import { DiarioList, type SerializedAsientoDiario } from "./diario-list";

type SearchParams = Promise<{ periodoId?: string; moneda?: string }>;

function parsePeriodoId(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export default async function LibroDiarioPage({
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

  const now = new Date();
  const periodoIdFromUrl = parsePeriodoId(params.periodoId);
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

  const periodoId = periodoIdFromUrl ?? defaultPeriodo?.id ?? null;
  const diario = periodoId ? await getLibroDiario(periodoId) : null;

  const moneda: Moneda = params.moneda === "USD" ? "USD" : "ARS";
  const fechaCorte = diario?.periodo.fechaFin ?? new Date();
  const cotizacion = await getCotizacionParaFecha(fechaCorte);
  const tcParaUsd =
    moneda === "USD" && cotizacion ? cotizacion.valor.toString() : null;
  const tcInfo = cotizacion
    ? {
        valor: cotizacion.valor.toString(),
        fecha: cotizacion.fecha.toISOString().slice(0, 10),
        fuente: cotizacion.fuente,
      }
    : null;

  const periodoOptions: PeriodoOption[] = periodos.map((p) => ({
    id: p.id,
    codigo: p.codigo,
    estado: p.estado,
  }));

  const cuadra =
    diario !== null && diario.totalDebe.equals(diario.totalHaber);

  const serializedAsientos: SerializedAsientoDiario[] =
    diario?.asientos.map((a) => ({
      id: a.id,
      numero: a.numero,
      fecha: a.fecha.toISOString(),
      descripcion: a.descripcion,
      origen: a.origen,
      moneda: a.moneda,
      totalDebe: a.totalDebe.toFixed(2),
      totalHaber: a.totalHaber.toFixed(2),
      lineas: a.lineas.map((l) => ({
        id: l.id,
        cuentaId: l.cuentaId,
        cuentaCodigo: l.cuentaCodigo,
        cuentaNombre: l.cuentaNombre,
        descripcion: l.descripcion,
        debe: l.debe.toFixed(2),
        haber: l.haber.toFixed(2),
      })),
    })) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Libro Diario</h1>
        <p className="text-sm text-muted-foreground">
          {diario
            ? `Período ${diario.periodo.codigo} · ${diario.periodo.nombre}`
            : "Seleccioná un período."}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <PeriodoSelect
          periodos={periodoOptions}
          selectedPeriodoId={periodoId !== null ? String(periodoId) : ""}
        />
        <MonedaToggle current={moneda} tcInfo={tcInfo} />
      </div>

      {diario ? (
        <>
          <Card size="sm" className="flex-row items-center gap-6 px-6 py-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">Asientos</span>
              <span className="font-mono text-lg tabular-nums">
                {diario.totalAsientos}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">Total Debe</span>
              <span
                className={cn(
                  "font-mono text-lg tabular-nums",
                  !cuadra && "text-destructive",
                )}
              >
                {fmtMoney(convertirAUsd(diario.totalDebe.toFixed(2), tcParaUsd))}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">Total Haber</span>
              <span
                className={cn(
                  "font-mono text-lg tabular-nums",
                  !cuadra && "text-destructive",
                )}
              >
                {fmtMoney(convertirAUsd(diario.totalHaber.toFixed(2), tcParaUsd))}
              </span>
            </div>
            <div className="ml-auto text-sm">
              {cuadra ? (
                <span className="font-medium text-emerald-700 dark:text-emerald-400">
                  ✓ Partida doble cuadra
                </span>
              ) : (
                <span className="font-medium text-destructive">
                  ✗ Diferencia entre totales
                </span>
              )}
            </div>
          </Card>
          <DiarioList asientos={serializedAsientos} tcParaUsd={tcParaUsd} />
        </>
      ) : (
        <Card className="py-12">
          <p className="text-center text-sm text-muted-foreground">
            No hay períodos contables disponibles.
          </p>
        </Card>
      )}
    </div>
  );
}
