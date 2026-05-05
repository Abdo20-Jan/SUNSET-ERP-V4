"use client";

import dynamic from "next/dynamic";

import { Skeleton } from "@/components/ui/skeleton";

import type { IngresoEgresoMensual } from "@/lib/services/dashboard";

const IngresosEgresosChart = dynamic(
  () =>
    import("./ingresos-egresos-chart").then((m) => ({
      default: m.IngresosEgresosChart,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-md border bg-card p-4">
        <Skeleton className="mb-3 h-4 w-32" />
        <Skeleton className="h-56 w-full" />
      </div>
    ),
  },
);

export function IngresosEgresosChartLazy({
  data,
}: {
  data: IngresoEgresoMensual[];
}) {
  return <IngresosEgresosChart data={data} />;
}
