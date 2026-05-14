import { Suspense } from "react";

import { auth } from "@/lib/auth";
import { PageHeader } from "@/components/layout/page-header";
import { DateRangeFilter } from "@/components/date-range-filter";
import { getCotizacionParaFecha } from "@/lib/services/cotizacion";

import { MonedaToggle, type Moneda } from "../reportes/_components/moneda-toggle";

import { BiTabs, type BiTabId } from "./_components/bi-tabs";
import { ChartSkeleton, KpiGridSkeleton } from "./_components/skeletons";
import { ResumenTab } from "./_tabs/resumen-tab";
import { VentasTab } from "./_tabs/ventas-tab";
import { ComprasTab } from "./_tabs/compras-tab";
import { StockTab } from "./_tabs/stock-tab";
import { TesoreriaTab } from "./_tabs/tesoreria-tab";
import { RentabilidadTab } from "./_tabs/rentabilidad-tab";
import { FiscalTab } from "./_tabs/fiscal-tab";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  tab?: string;
  desde?: string;
  hasta?: string;
  moneda?: string;
}>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_TABS: BiTabId[] = [
  "resumen",
  "ventas",
  "compras",
  "stock",
  "tesoreria",
  "rentabilidad",
  "fiscal",
];

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
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

export default async function BiPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;

  const tab: BiTabId = (VALID_TABS as string[]).includes(params.tab ?? "")
    ? (params.tab as BiTabId)
    : "resumen";

  const desdeStr = params.desde ?? firstOfMonthIso();
  const hastaStr = params.hasta ?? todayIso();
  const desde = parseDate(desdeStr);
  const hasta = endOfDay(hastaStr);

  const session = await auth();
  const monedaPreferida: Moneda = session?.user.monedaPreferida === "ARS" ? "ARS" : "USD";
  const moneda: Moneda =
    params.moneda === "ARS" ? "ARS" : params.moneda === "USD" ? "USD" : monedaPreferida;

  const cotizacion = await getCotizacionParaFecha(hasta ?? new Date());
  const tcParaUsd = moneda === "USD" && cotizacion ? cotizacion.valor.toString() : null;
  const tcInfo = cotizacion
    ? {
        valor: cotizacion.valor.toString(),
        fecha: cotizacion.fecha.toISOString().slice(0, 10),
        fuente: cotizacion.fuente,
      }
    : null;

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title="BI · Business Intelligence"
        description={`${session?.user.nombre ?? ""} · análisis integral del negocio · ventas, compras, stock, tesorería, rentabilidad y fiscal`}
      />

      <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
        <DateRangeFilter initialDesde={desdeStr} initialHasta={hastaStr} hideHistorico />
        <MonedaToggle current={moneda} tcInfo={tcInfo} />
      </div>

      <BiTabs current={tab} />

      <div className="mt-1">
        {tab === "resumen" ? (
          <Suspense
            fallback={
              <div className="flex flex-col gap-3">
                <KpiGridSkeleton count={8} />
                <ChartSkeleton />
              </div>
            }
          >
            <ResumenTab desde={desde} hasta={hasta} tc={tcParaUsd} />
          </Suspense>
        ) : null}

        {tab === "ventas" ? (
          <Suspense
            fallback={
              <div className="flex flex-col gap-3">
                <KpiGridSkeleton />
                <ChartSkeleton />
              </div>
            }
          >
            <VentasTab desde={desde} hasta={hasta} tc={tcParaUsd} />
          </Suspense>
        ) : null}

        {tab === "compras" ? (
          <Suspense
            fallback={
              <div className="flex flex-col gap-3">
                <KpiGridSkeleton />
                <ChartSkeleton />
              </div>
            }
          >
            <ComprasTab desde={desde} hasta={hasta} tc={tcParaUsd} />
          </Suspense>
        ) : null}

        {tab === "stock" ? (
          <Suspense
            fallback={
              <div className="flex flex-col gap-3">
                <KpiGridSkeleton />
                <ChartSkeleton />
              </div>
            }
          >
            <StockTab tc={tcParaUsd} />
          </Suspense>
        ) : null}

        {tab === "tesoreria" ? (
          <Suspense
            fallback={
              <div className="flex flex-col gap-3">
                <KpiGridSkeleton />
                <ChartSkeleton />
              </div>
            }
          >
            <TesoreriaTab desde={desde} hasta={hasta} tc={tcParaUsd} />
          </Suspense>
        ) : null}

        {tab === "rentabilidad" ? (
          <Suspense
            fallback={
              <div className="flex flex-col gap-3">
                <KpiGridSkeleton />
                <ChartSkeleton />
              </div>
            }
          >
            <RentabilidadTab desde={desde} hasta={hasta} tc={tcParaUsd} />
          </Suspense>
        ) : null}

        {tab === "fiscal" ? (
          <Suspense
            fallback={
              <div className="flex flex-col gap-3">
                <KpiGridSkeleton />
                <ChartSkeleton />
              </div>
            }
          >
            <FiscalTab desde={desde} hasta={hasta} tc={tcParaUsd} />
          </Suspense>
        ) : null}
      </div>
    </div>
  );
}
