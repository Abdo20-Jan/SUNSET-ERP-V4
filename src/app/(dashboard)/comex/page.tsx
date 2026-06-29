import { Suspense } from "react";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { Calculator01Icon, CargoShipIcon, UserGroupIcon } from "@hugeicons/core-free-icons";

import { auth } from "@/lib/auth";
import { hasPermission, PERMISOS } from "@/lib/permisos";
import { getCotizacionParaFecha } from "@/lib/services/cotizacion";
import { getCockpitData } from "@/lib/services/comex-cockpit";
import { type CockpitFiltros, parseCockpitFiltros } from "@/lib/services/comex-cockpit-filtros";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/layout/page-header";

import { MonedaToggle, type Moneda } from "../reportes/_components/moneda-toggle";
import { Cockpit } from "./_components/cockpit";

export const dynamic = "force-dynamic";

const ACCESOS = [
  { href: "/comex/embarques", icon: CargoShipIcon, label: "Embarques" },
  { href: "/comex/proveedores", icon: UserGroupIcon, label: "Proveedores exterior" },
  { href: "/comex/simulaciones", icon: Calculator01Icon, label: "Simulaciones" },
] as const;

function CockpitSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {["kpi-1", "kpi-2", "kpi-3", "kpi-4"].map((k) => (
          <Card key={k} size="sm" className="gap-1.5 py-2.5">
            <Skeleton className="mx-3 h-3 w-28" />
            <Skeleton className="mx-3 h-5 w-20" />
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2 xl:grid-cols-3">
        {["b-1", "b-2", "b-3", "b-4", "b-5", "b-6"].map((k) => (
          <Card key={k} size="sm" className="gap-2 py-3">
            <Skeleton className="mx-3 h-4 w-40" />
            <Skeleton className="mx-3 h-4 w-full" />
            <Skeleton className="mx-3 h-4 w-full" />
          </Card>
        ))}
      </div>
    </div>
  );
}

async function CockpitSection({
  now,
  moneda,
  tc,
  filtros,
}: {
  now: Date;
  moneda: Moneda;
  tc: string | null;
  filtros: CockpitFiltros;
}) {
  // Gate server-side: `verCosto` (VER_COSTO_LANDED) gobierna el strip de TODO
  // valor financiero (FOB/CFR, cash-out, sección Financeiro). El costo NUNCA
  // viaja al cliente sin permiso (CRIT-10). El `filtros` sólo narra (PR-022b).
  const verCosto = await hasPermission(PERMISOS.VER_COSTO_LANDED);
  const data = await getCockpitData({ now, verCosto, filtros });
  return <Cockpit data={data} moneda={moneda} tc={tc} verCosto={verCosto} />;
}

export default async function ComexPage({
  searchParams,
}: {
  searchParams: Promise<{
    moneda?: string;
    vista?: string;
    proveedor?: string;
    eta_desde?: string;
    eta_hasta?: string;
    estado?: string;
  }>;
}) {
  const now = new Date();
  const [params, session, cotizacion] = await Promise.all([
    searchParams,
    auth(),
    getCotizacionParaFecha(now),
  ]);

  const monedaPreferida: Moneda = session?.user.monedaPreferida === "ARS" ? "ARS" : "USD";
  const moneda: Moneda =
    params.moneda === "ARS" ? "ARS" : params.moneda === "USD" ? "USD" : monedaPreferida;

  const { filtros } = parseCockpitFiltros(params, now);

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
        description="Cockpit operacional de importaciones — alertas, indicadores y pendencias."
        actions={<MonedaToggle current={moneda} tcInfo={tcInfo} />}
      />

      <nav className="flex flex-wrap items-center gap-2">
        {ACCESOS.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <HugeiconsIcon icon={a.icon} className="size-3.5" strokeWidth={2} />
            {a.label}
          </Link>
        ))}
      </nav>

      <Suspense fallback={<CockpitSkeleton />}>
        <CockpitSection now={now} moneda={moneda} tc={tc} filtros={filtros} />
      </Suspense>
    </div>
  );
}
