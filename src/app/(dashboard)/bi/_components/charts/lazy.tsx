"use client";

import dynamic from "next/dynamic";

import { Skeleton } from "@/components/ui/skeleton";

function ChartLoading({ label, height = 220 }: { label: string; height?: number }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <Skeleton className="mb-3 h-4 w-40" />
      <Skeleton style={{ height }} className="w-full" />
      <span className="sr-only">Cargando {label}</span>
    </div>
  );
}

export const BarChartMoneyLazy = dynamic(
  () => import("./bar-chart-money").then((m) => ({ default: m.BarChartMoney })),
  { ssr: false, loading: () => <ChartLoading label="gráfico de barras" /> },
);

export const LineChartMoneyLazy = dynamic(
  () => import("./line-chart-money").then((m) => ({ default: m.LineChartMoney })),
  { ssr: false, loading: () => <ChartLoading label="gráfico de líneas" /> },
);

export const PieChartDistributionLazy = dynamic(
  () => import("./pie-chart-distribution").then((m) => ({ default: m.PieChartDistribution })),
  { ssr: false, loading: () => <ChartLoading label="distribución" /> },
);

export const HorizontalBarRankingLazy = dynamic(
  () => import("./horizontal-bar-ranking").then((m) => ({ default: m.HorizontalBarRanking })),
  { ssr: false, loading: () => <ChartLoading label="ranking" /> },
);

export const StackedBarChartLazy = dynamic(
  () => import("./stacked-bar-chart").then((m) => ({ default: m.StackedBarChart })),
  { ssr: false, loading: () => <ChartLoading label="composición" /> },
);
