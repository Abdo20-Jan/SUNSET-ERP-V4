"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";

import type { IngresoEgresoMensual } from "@/lib/services/dashboard";

const fmtCompact = new Intl.NumberFormat("es-AR", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const fmtMonedaCache: Record<"ARS" | "USD", Intl.NumberFormat> = {
  ARS: new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }),
  USD: new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }),
};

const config = {
  ingresos: { label: "Ingresos", color: "var(--chart-1)" },
  egresos: { label: "Egresos", color: "var(--chart-2)" },
} satisfies ChartConfig;

export function IngresosEgresosChart({
  data,
  moneda,
}: {
  data: IngresoEgresoMensual[];
  moneda: "ARS" | "USD";
}) {
  const fmtMoneda = fmtMonedaCache[moneda];
  return (
    <Card size="sm">
      <CardHeader className="flex-row items-center justify-between border-b border-border/60 pb-2">
        <div className="flex flex-col gap-0.5">
          <CardTitle>Ingresos vs Egresos</CardTitle>
          <p className="text-[11px] text-muted-foreground">
            Últimos 6 meses · agregado de cuentas INGRESO y EGRESO
          </p>
        </div>
        <div className="flex items-center gap-3 text-[11px]">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-sm bg-(--color-ingresos)" />
            Ingresos
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-sm bg-(--color-egresos)" />
            Egresos
          </span>
        </div>
      </CardHeader>
      <CardContent className="pt-2">
        <ChartContainer config={config} className="aspect-auto h-56 w-full">
          <BarChart
            accessibilityLayer
            data={data}
            margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
            barCategoryGap={20}
          >
            <CartesianGrid strokeDasharray="2 4" stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
              tickFormatter={(v) => fmtCompact.format(Number(v))}
              tickLine={false}
              axisLine={false}
              width={48}
            />
            <ChartTooltip
              cursor={{ fill: "var(--accent)", opacity: 0.4 }}
              content={
                <ChartTooltipContent
                  labelKey="label"
                  formatter={(v, name) => (
                    <div className="flex flex-1 justify-between gap-2">
                      <span className="text-muted-foreground">{String(name)}</span>
                      <span className="font-mono font-medium text-foreground tabular-nums">
                        {fmtMoneda.format(Number(v ?? 0))}
                      </span>
                    </div>
                  )}
                />
              }
            />
            <Bar
              dataKey="ingresos"
              fill="var(--color-ingresos)"
              name="Ingresos"
              radius={[3, 3, 0, 0]}
            />
            <Bar
              dataKey="egresos"
              fill="var(--color-egresos)"
              name="Egresos"
              radius={[3, 3, 0, 0]}
            />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
