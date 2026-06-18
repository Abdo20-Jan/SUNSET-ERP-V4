import { Suspense } from "react";
import {
  BankIcon,
  BookOpen01Icon,
  CargoShipIcon,
  ChartLineData01Icon,
  Coins01Icon,
  CreditCardIcon,
  TruckDeliveryIcon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";

import { auth } from "@/lib/auth";
import { convertirMonto, fmtInt, fmtMoney } from "@/lib/format";
import { getCotizacionParaFecha } from "@/lib/services/cotizacion";
import {
  getAlertasDashboard,
  getEmbarquesRecientes,
  getIngresosEgresosUltimos6m,
  getKpisPrincipales,
  getKpisSecundarios,
  getPrestamosActivos,
  getSaldosBancarios,
  getUltimosAsientos,
} from "@/lib/services/dashboard";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/layout/page-header";

import { MonedaToggle, type Moneda } from "../reportes/_components/moneda-toggle";

import { AlertasCard } from "./_components/alertas-card";
import { EmbarquesRecientesCard } from "./_components/embarques-recientes-card";
import { IngresosEgresosChartLazy } from "./_components/ingresos-egresos-chart-lazy";
import { KpiCard } from "./_components/kpi-card";
import { PrestamosActivosCard } from "./_components/prestamos-activos-card";
import { SaldosBancosCard } from "./_components/saldos-bancos-card";
import { SecondaryStat } from "./_components/secondary-stat";
import { UltimosAsientosCard } from "./_components/ultimos-asientos-card";

export const dynamic = "force-dynamic";

/** Conversión ARS→moneda de presentación (los agregados del ledger son ARS). */
type Pres = { moneda: Moneda; tc: string | null };

function CardSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <Card>
      <CardHeader className="gap-3">
        <Skeleton className="h-5 w-40" />
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </CardHeader>
    </Card>
  );
}

function KpiSkeleton() {
  return (
    <Card>
      <CardHeader className="gap-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-3 w-24" />
      </CardHeader>
    </Card>
  );
}

function StatSkeleton() {
  return (
    <Card>
      <CardHeader className="gap-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-6 w-16" />
      </CardHeader>
    </Card>
  );
}

async function AlertasSection() {
  const alertas = await getAlertasDashboard();
  return <AlertasCard alertas={alertas} />;
}

async function KpisPrincipales({ moneda, tc }: Pres) {
  const kpis = await getKpisPrincipales();
  const enPres = (v: string) => fmtMoney(convertirMonto(v, "ARS", moneda, tc));
  return (
    <>
      <KpiCard
        label="Saldo Bancos + Caja"
        value={enPres(kpis.saldoBancosCaja.toString())}
        icon={Coins01Icon}
        accent={kpis.saldoBancosCaja.gte(0) ? "positive" : "negative"}
        hint="Cuentas 1.1.1.* y 1.1.2.*"
      />
      <KpiCard
        label="Total Pasivo"
        value={enPres(kpis.totalPasivo.toString())}
        icon={CreditCardIcon}
        accent="warning"
        hint="Categoría PASIVO"
      />
      <KpiCard
        label="Resultado del Ejercicio"
        value={enPres(kpis.resultadoEjercicio.toString())}
        icon={ChartLineData01Icon}
        accent={kpis.resultadoEjercicio.gte(0) ? "positive" : "negative"}
        hint="Ingresos − Egresos (histórico)"
      />
      <KpiCard
        label="Asientos Contabilizados"
        value={fmtInt(kpis.asientosContabilizados)}
        icon={BookOpen01Icon}
        accent="info"
        hint="Total acumulado"
      />
    </>
  );
}

async function IngresosEgresosSection({ moneda, tc }: Pres) {
  const raw = await getIngresosEgresosUltimos6m();
  const conv = (n: number) => Number(convertirMonto(n.toString(), "ARS", moneda, tc));
  const data = raw.map((d) => ({
    ...d,
    ingresos: conv(d.ingresos),
    egresos: conv(d.egresos),
    resultado: conv(d.resultado),
  }));
  return <IngresosEgresosChartLazy data={data} moneda={moneda} />;
}

async function SaldosSection({ moneda, tc }: Pres) {
  const saldos = await getSaldosBancarios();
  return <SaldosBancosCard saldos={saldos} moneda={moneda} tc={tc} />;
}

async function PrestamosSection({ moneda, tc }: Pres) {
  const prestamos = await getPrestamosActivos();
  return <PrestamosActivosCard prestamos={prestamos} moneda={moneda} tc={tc} />;
}

async function AsientosSection({ moneda, tc }: Pres) {
  const asientos = await getUltimosAsientos();
  return <UltimosAsientosCard asientos={asientos} moneda={moneda} tc={tc} />;
}

async function EmbarquesSection() {
  const embarques = await getEmbarquesRecientes();
  return <EmbarquesRecientesCard embarques={embarques} />;
}

async function KpisSecundariosSection() {
  const secundarios = await getKpisSecundarios();
  return (
    <>
      <SecondaryStat
        label="Embarques activos"
        value={secundarios.embarquesActivos}
        icon={CargoShipIcon}
      />
      <SecondaryStat
        label="Clientes activos"
        value={secundarios.clientesActivos}
        icon={UserGroupIcon}
      />
      <SecondaryStat
        label="Proveedores activos"
        value={secundarios.proveedoresActivos}
        icon={TruckDeliveryIcon}
      />
      <SecondaryStat
        label="Cuentas bancarias activas"
        value={secundarios.cuentasBancariasActivas}
        icon={BankIcon}
      />
    </>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ moneda?: string }>;
}) {
  const [params, session, cotizacion] = await Promise.all([
    searchParams,
    auth(),
    getCotizacionParaFecha(new Date()),
  ]);

  const monedaPreferida: Moneda = session?.user.monedaPreferida === "ARS" ? "ARS" : "USD";
  const moneda: Moneda =
    params.moneda === "ARS" ? "ARS" : params.moneda === "USD" ? "USD" : monedaPreferida;

  // El dashboard tiene valores nativos mixtos (saldos/préstamos en su moneda),
  // por eso el TC se pasa SIEMPRE que haya cotización (no gated en USD): para
  // presentación en ARS, las posiciones USD igual necesitan ×TC. `convertirMonto`
  // decide por moneda nativa↔destino.
  const tc = cotizacion ? cotizacion.valor.toString() : null;
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
        title="Dashboard"
        description={`${session?.user.nombre ?? "Bienvenido"} · indicadores derivados de asientos contabilizados`}
        actions={<MonedaToggle current={moneda} tcInfo={tcInfo} />}
      />

      <Suspense fallback={<CardSkeleton rows={2} />}>
        <AlertasSection />
      </Suspense>

      <section className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Suspense
          fallback={
            <>
              <KpiSkeleton />
              <KpiSkeleton />
              <KpiSkeleton />
              <KpiSkeleton />
            </>
          }
        >
          <KpisPrincipales moneda={moneda} tc={tc} />
        </Suspense>
      </section>

      <Suspense fallback={<CardSkeleton rows={6} />}>
        <IngresosEgresosSection moneda={moneda} tc={tc} />
      </Suspense>

      <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <Suspense fallback={<CardSkeleton rows={4} />}>
            <SaldosSection moneda={moneda} tc={tc} />
          </Suspense>
          <Suspense fallback={<CardSkeleton rows={3} />}>
            <PrestamosSection moneda={moneda} tc={tc} />
          </Suspense>
        </div>
        <div className="flex flex-col gap-3">
          <Suspense fallback={<CardSkeleton rows={4} />}>
            <AsientosSection moneda={moneda} tc={tc} />
          </Suspense>
          <Suspense fallback={<CardSkeleton rows={3} />}>
            <EmbarquesSection />
          </Suspense>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Suspense
          fallback={
            <>
              <StatSkeleton />
              <StatSkeleton />
              <StatSkeleton />
              <StatSkeleton />
            </>
          }
        >
          <KpisSecundariosSection />
        </Suspense>
      </section>
    </div>
  );
}
