import { Suspense } from "react";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Invoice01Icon,
  Calendar03Icon,
  BookOpen01Icon,
  BalanceScaleIcon,
  ArrowLeftRightIcon,
  CreditCardIcon,
  ChartLineData01Icon,
} from "@hugeicons/core-free-icons";

import { auth } from "@/lib/auth";
import { convertirMonto, fmtInt, fmtMoney } from "@/lib/format";
import { getCotizacionParaFecha } from "@/lib/services/cotizacion";
import { getResumenContabilidad } from "@/lib/services/contabilidad-overview";
import { getUltimosAsientos } from "@/lib/services/dashboard";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/layout/page-header";

import { MonedaToggle, type Moneda } from "../reportes/_components/moneda-toggle";
import { KpiCard } from "../dashboard/_components/kpi-card";
import { UltimosAsientosCard } from "../dashboard/_components/ultimos-asientos-card";

const SECTIONS = [
  {
    href: "/contabilidad/cuentas",
    title: "Plan de Cuentas",
    description: "Árbol jerárquico de las 124 cuentas contables.",
    icon: Invoice01Icon,
  },
  {
    href: "/contabilidad/periodos",
    title: "Períodos Contables",
    description: "Gestioná el estado (ABIERTO/CERRADO) de los 36 períodos.",
    icon: Calendar03Icon,
  },
  {
    href: "/contabilidad/asientos",
    title: "Asientos",
    description: "Listá, contabilizá y anulá asientos. Creación manual y auditoría.",
    icon: BookOpen01Icon,
  },
  {
    href: "/contabilidad/asientos/mover-periodo",
    title: "Mover Asientos de Período",
    description: "Remapear asientos al período contable correcto (entradas retroactivas).",
    icon: ArrowLeftRightIcon,
  },
  {
    href: "/contabilidad/reportes/balance",
    title: "Balance de Sumas y Saldos",
    description: "Tree table con saldo inicial, movimientos y drill-down por período.",
    icon: BalanceScaleIcon,
  },
] as const;

export const dynamic = "force-dynamic";

/** Conversión ARS→moneda de presentación (los agregados del ledger son ARS). */
type Pres = { moneda: Moneda; tc: string | null };

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

function ListSkeleton() {
  return (
    <Card>
      <CardHeader className="gap-3">
        <Skeleton className="h-5 w-40" />
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </CardHeader>
    </Card>
  );
}

async function ContabilidadKpis({ moneda, tc }: Pres) {
  const r = await getResumenContabilidad();
  const enPres = (v: string) => fmtMoney(convertirMonto(v, "ARS", moneda, tc));
  return (
    <>
      <KpiCard
        label="Asientos contabilizados"
        value={fmtInt(r.asientosContabilizados)}
        icon={BookOpen01Icon}
        accent="info"
        hint="Total acumulado"
      />
      <KpiCard
        label="Resultado del ejercicio"
        value={enPres(r.resultadoEjercicioArs.toString())}
        icon={ChartLineData01Icon}
        accent={r.resultadoEjercicioArs.gte(0) ? "positive" : "negative"}
        hint="Ingresos − Egresos (histórico)"
      />
      <KpiCard
        label="Total Pasivo"
        value={enPres(r.totalPasivoArs.toString())}
        icon={CreditCardIcon}
        accent="warning"
        hint="Categoría PASIVO"
      />
      <KpiCard
        label="Períodos abiertos"
        value={fmtInt(r.periodosAbiertos)}
        icon={Calendar03Icon}
        accent={r.periodosAbiertos > 0 ? "neutral" : "warning"}
        hint="En estado ABIERTO"
      />
    </>
  );
}

async function AsientosSection({ moneda, tc }: Pres) {
  const asientos = await getUltimosAsientos();
  return <UltimosAsientosCard asientos={asientos} moneda={moneda} tc={tc} />;
}

export default async function ContabilidadPage({
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
        title="Contabilidad"
        description="Plan de cuentas, períodos, asientos y reportes contables."
        actions={<MonedaToggle current={moneda} tcInfo={tcInfo} />}
      />

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
          <ContabilidadKpis moneda={moneda} tc={tc} />
        </Suspense>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map((section) => (
          <Link key={section.href} href={section.href} className="block">
            <Card className="h-full transition-colors hover:bg-muted/50">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <HugeiconsIcon icon={section.icon} className="size-5" />
                  </div>
                  <CardTitle>{section.title}</CardTitle>
                </div>
                <CardDescription>{section.description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>

      <Suspense fallback={<ListSkeleton />}>
        <AsientosSection moneda={moneda} tc={tc} />
      </Suspense>
    </div>
  );
}
