import { getEstadoResultadosByFecha } from "@/lib/services/reportes";
import { getCotizacionParaFecha } from "@/lib/services/cotizacion";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { DateRangeFilter } from "@/components/date-range-filter";
import { convertirAUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

import { fmtMoney, fmtSigno } from "../_components/money";
import { CuentaTreeTable } from "../_components/cuenta-tree-table";
import { serializeTreeNode } from "../_components/cuenta-tree-node";
import { MonedaToggle, type Moneda } from "../_components/moneda-toggle";

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

export default async function EstadoResultadosPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;

  const desdeStr = params.desde ?? firstOfMonthIso();
  const hastaStr = params.hasta ?? todayIso();
  const fechaDesde = parseDate(desdeStr);
  const fechaHasta = endOfDay(hastaStr);

  const er = await getEstadoResultadosByFecha({ fechaDesde, fechaHasta });

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

  const resultadoStr = er.resultado.toFixed(2);
  const signo = fmtSigno(resultadoStr);

  const rangoLabel =
    fechaDesde && fechaHasta
      ? `Del ${desdeStr} al ${hastaStr}`
      : fechaHasta
        ? `Hasta ${hastaStr}`
        : fechaDesde
          ? `Desde ${desdeStr}`
          : "Histórico completo";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="text-[15px] font-semibold tracking-tight">
          Estado de Resultados
        </h1>
        <p className="text-sm text-muted-foreground">{rangoLabel}</p>
      </div>

      <div className="flex flex-col gap-3">
        <DateRangeFilter
          initialDesde={desdeStr}
          initialHasta={hastaStr}
        />
        <MonedaToggle current={moneda} tcInfo={tcInfo} />
      </div>

      <Card className="py-0">
        <CardHeader className="border-b py-4">
          <CardTitle className="text-base">Ingresos</CardTitle>
        </CardHeader>
        <CuentaTreeTable
          data={er.ingresos.map(serializeTreeNode)}
          totalLabel="Total Ingresos"
          totalValue={er.totalIngresos.toFixed(2)}
          tcParaUsd={tcParaUsd}
        />
      </Card>

      <Card className="py-0">
        <CardHeader className="border-b py-4">
          <CardTitle className="text-base">Egresos</CardTitle>
        </CardHeader>
        <CuentaTreeTable
          data={er.egresos.map(serializeTreeNode)}
          totalLabel="Total Egresos"
          totalValue={er.totalEgresos.toFixed(2)}
          tcParaUsd={tcParaUsd}
        />
      </Card>

      <Card className="flex-row items-center gap-6 px-6 py-6">
        <div className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Resultado del Período
          </span>
          <span className="text-xs text-muted-foreground">
            Ingresos − Egresos
          </span>
        </div>
        <span
          className={cn(
            "ml-auto font-mono text-base font-semibold tabular-nums",
            signo === "positive" && "text-emerald-700 dark:text-emerald-400",
            signo === "negative" && "text-destructive",
            signo === "zero" && "text-muted-foreground",
          )}
        >
          {fmtMoney(convertirAUsd(resultadoStr, tcParaUsd))}
        </span>
      </Card>
    </div>
  );
}
