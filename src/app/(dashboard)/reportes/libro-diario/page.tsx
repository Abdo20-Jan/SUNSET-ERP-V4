import { getLibroDiario } from "@/lib/services/reportes";
import { getCotizacionParaFecha } from "@/lib/services/cotizacion";
import { Card } from "@/components/ui/card";
import { DateRangeFilter } from "@/components/date-range-filter";
import { convertirAUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

import { MonedaToggle, type Moneda } from "../_components/moneda-toggle";
import { fmtMoney } from "../_components/money";
import { DiarioList, type SerializedAsientoDiario } from "./diario-list";

type SearchParams = Promise<{
  desde?: string;
  hasta?: string;
  moneda?: string;
}>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

export default async function LibroDiarioPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;

  const desdeStr = params.desde ?? firstOfMonthIso();
  const hastaStr = params.hasta ?? todayIso();
  const fechaDesde = parseDate(desdeStr);
  const fechaHasta = endOfDay(hastaStr);

  const diario = await getLibroDiario({ fechaDesde, fechaHasta });

  const moneda: Moneda = params.moneda === "ARS" ? "ARS" : "USD";
  const fechaCorte = fechaHasta ?? new Date();
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

  const cuadra = diario.totalDebe.equals(diario.totalHaber);

  const rangoLabel =
    fechaDesde && fechaHasta
      ? `Del ${desdeStr} al ${hastaStr}`
      : fechaHasta
        ? `Hasta ${hastaStr}`
        : fechaDesde
          ? `Desde ${desdeStr}`
          : "Histórico completo";

  const serializedAsientos: SerializedAsientoDiario[] = diario.asientos.map(
    (a) => ({
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
    }),
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="text-[15px] font-semibold tracking-tight">Libro Diario</h1>
        <p className="text-sm text-muted-foreground">{rangoLabel}</p>
      </div>

      <div className="flex flex-col gap-3">
        <DateRangeFilter
          initialDesde={desdeStr}
          initialHasta={hastaStr}
        />
        <MonedaToggle current={moneda} tcInfo={tcInfo} />
      </div>

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
    </div>
  );
}
