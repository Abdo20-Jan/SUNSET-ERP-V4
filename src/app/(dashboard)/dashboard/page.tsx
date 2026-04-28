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
import { fmtInt, fmtMoney } from "@/lib/format";
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

import { AlertasCard } from "./_components/alertas-card";
import { EmbarquesRecientesCard } from "./_components/embarques-recientes-card";
import { IngresosEgresosChart } from "./_components/ingresos-egresos-chart";
import { KpiCard } from "./_components/kpi-card";
import { PrestamosActivosCard } from "./_components/prestamos-activos-card";
import { SaldosBancosCard } from "./_components/saldos-bancos-card";
import { SecondaryStat } from "./_components/secondary-stat";
import { UltimosAsientosCard } from "./_components/ultimos-asientos-card";

export const dynamic = "force-dynamic";

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

async function KpisPrincipales() {
  const kpis = await getKpisPrincipales();
  return (
    <>
      <KpiCard
        label="Saldo Bancos + Caja"
        value={fmtMoney(kpis.saldoBancosCaja.toString())}
        icon={Coins01Icon}
        accent={kpis.saldoBancosCaja.gte(0) ? "positive" : "negative"}
        hint="Cuentas 1.1.1.* y 1.1.2.*"
      />
      <KpiCard
        label="Total Pasivo"
        value={fmtMoney(kpis.totalPasivo.toString())}
        icon={CreditCardIcon}
        accent="warning"
        hint="Categoría PASIVO"
      />
      <KpiCard
        label="Resultado del Ejercicio"
        value={fmtMoney(kpis.resultadoEjercicio.toString())}
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

async function IngresosEgresosSection() {
  const data = await getIngresosEgresosUltimos6m();
  return <IngresosEgresosChart data={data} />;
}

async function SaldosSection() {
  const saldos = await getSaldosBancarios();
  return <SaldosBancosCard saldos={saldos} />;
}

async function PrestamosSection() {
  const prestamos = await getPrestamosActivos();
  return <PrestamosActivosCard prestamos={prestamos} />;
}

async function AsientosSection() {
  const asientos = await getUltimosAsientos();
  return <UltimosAsientosCard asientos={asientos} />;
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

export default async function DashboardPage() {
  const session = await auth();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Bienvenido, {session?.user.nombre}. Indicadores calculados desde la
          contabilidad (asientos contabilizados).
        </p>
      </div>

      <Suspense fallback={<CardSkeleton rows={2} />}>
        <AlertasSection />
      </Suspense>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
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
          <KpisPrincipales />
        </Suspense>
      </section>

      <Suspense fallback={<CardSkeleton rows={6} />}>
        <IngresosEgresosSection />
      </Suspense>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Suspense fallback={<CardSkeleton rows={4} />}>
            <SaldosSection />
          </Suspense>
          <Suspense fallback={<CardSkeleton rows={3} />}>
            <PrestamosSection />
          </Suspense>
        </div>
        <div className="flex flex-col gap-4">
          <Suspense fallback={<CardSkeleton rows={4} />}>
            <AsientosSection />
          </Suspense>
          <Suspense fallback={<CardSkeleton rows={3} />}>
            <EmbarquesSection />
          </Suspense>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
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
