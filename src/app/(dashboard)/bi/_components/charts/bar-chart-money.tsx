"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";

const fmtCompact = new Intl.NumberFormat("es-AR", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const fmtPesos = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

export type BarChartPoint = {
  label: string;
  value: number;
};

export function BarChartMoney({
  title,
  description,
  data,
  color = "var(--chart-1)",
  height = 220,
}: {
  title: string;
  description?: string;
  data: BarChartPoint[];
  color?: string;
  height?: number;
}) {
  const config = {
    value: { label: title, color },
  } satisfies ChartConfig;

  return (
    <Card size="sm">
      <CardHeader className="flex-row items-center justify-between border-b border-border/60 pb-2">
        <div className="flex flex-col gap-0.5">
          <CardTitle>{title}</CardTitle>
          {description ? <p className="text-[11px] text-muted-foreground">{description}</p> : null}
        </div>
      </CardHeader>
      <CardContent className="pt-2">
        <ChartContainer config={config} className="aspect-auto w-full" style={{ height }}>
          <BarChart
            accessibilityLayer
            data={data}
            margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
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
              width={52}
            />
            <ChartTooltip
              cursor={{ fill: "var(--accent)", opacity: 0.4 }}
              content={
                <ChartTooltipContent
                  labelKey="label"
                  formatter={(v) => (
                    <span className="font-mono font-medium text-foreground tabular-nums">
                      {fmtPesos.format(Number(v ?? 0))}
                    </span>
                  )}
                />
              }
            />
            <Bar dataKey="value" fill="var(--color-value)" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
