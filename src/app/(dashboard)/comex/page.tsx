import { Suspense } from "react";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  CargoShipIcon,
  Calculator01Icon,
  Invoice01Icon,
  ReceiptDollarIcon,
  TruckDeliveryIcon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";

import { auth } from "@/lib/auth";
import { convertirMonto, fmtInt, fmtMoney } from "@/lib/format";
import { getCotizacionParaFecha } from "@/lib/services/cotizacion";
import { getResumenComex } from "@/lib/services/comex-overview";
import { getEmbarquesRecientes } from "@/lib/services/dashboard";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/layout/page-header";

import { MonedaToggle, type Moneda } from "../reportes/_components/moneda-toggle";
import { KpiCard } from "../dashboard/_components/kpi-card";
import { EmbarquesRecientesCard } from "../dashboard/_components/embarques-recientes-card";

const SECTIONS = [
  {
    href: "/comex/embarques",
    icon: CargoShipIcon,
    title: "Embarques",
    description: "Importaciones: FOB, CIF, tributos aduaneros y costo nacionalizado",
  },
  {
    href: "/comex/proveedores",
    icon: UserGroupIcon,
    title: "Proveedores exterior",
    description: "Saldos en USD por proveedor, embarque y factura — referencia abierta",
  },
  {
    href: "/comex/simulaciones",
    icon: Calculator01Icon,
    title: "Simulaciones",
    description:
      "Simulador de costos de importación: nacionalizado y rentabilidad sin generar asientos",
  },
] as const;

export const dynamic = "force-dynamic";

type Pres = { moneda: Moneda; tc: string | null };

function KpiSkeleton() {
  return (
    <Card>
      <CardHeader className="gap-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-7 w-20" />
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

async function ComexKpis({ moneda, tc }: Pres) {
  const r = await getResumenComex();
  return (
    <>
      <KpiCard
        label="Embarques activos"
        value={fmtInt(r.activos)}
        icon={CargoShipIcon}
        accent="info"
        hint={`${fmtInt(r.total)} en total`}
      />
      <KpiCard
        label="En tránsito"
        value={fmtInt(r.enTransito)}
        icon={TruckDeliveryIcon}
        accent="neutral"
        hint="En tránsito o en puerto"
      />
      <KpiCard
        label="En aduana"
        value={fmtInt(r.enAduana)}
        icon={Invoice01Icon}
        accent="warning"
        hint="Zona primaria, aduana o despachado"
      />
      <KpiCard
        label="Deuda exterior"
        value={fmtMoney(convertirMonto(r.deudaExteriorUsd, "USD", moneda, tc))}
        icon={ReceiptDollarIcon}
        accent="warning"
        hint="Saldo USD con proveedores del exterior"
      />
    </>
  );
}

async function EmbarquesSection() {
  const embarques = await getEmbarquesRecientes();
  return <EmbarquesRecientesCard embarques={embarques} />;
}

export default async function ComexPage({
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
        title="Comex"
        description="Gestión de importaciones y costos aduaneros."
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
          <ComexKpis moneda={moneda} tc={tc} />
        </Suspense>
      </section>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map((s) => (
          <Link key={s.href} href={s.href} className="group">
            <Card className="transition-colors group-hover:border-primary/40">
              <CardContent className="flex items-start gap-3">
                <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <HugeiconsIcon icon={s.icon} strokeWidth={2} />
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{s.title}</span>
                  <span className="text-xs text-muted-foreground">{s.description}</span>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <Suspense fallback={<ListSkeleton />}>
        <EmbarquesSection />
      </Suspense>
    </div>
  );
}
