"use client";

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

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

export type LineSeries = {
  key: string;
  label: string;
  color: string;
};

export type LineChartPoint = {
  label: string;
  // dynamic keys
  [key: string]: string | number;
};

export function LineChartMoney({
  title,
  description,
  data,
  series,
  height = 240,
}: {
  title: string;
  description?: string;
  data: LineChartPoint[];
  series: LineSeries[];
  height?: number;
}) {
  const config = Object.fromEntries(
    series.map((s) => [s.key, { label: s.label, color: s.color }]),
  ) satisfies ChartConfig;

  return (
    <Card size="sm">
      <CardHeader className="flex-row items-center justify-between border-b border-border/60 pb-2">
        <div className="flex flex-col gap-0.5">
          <CardTitle>{title}</CardTitle>
          {description ? <p className="text-[11px] text-muted-foreground">{description}</p> : null}
        </div>
        <div className="flex items-center gap-3 text-[11px]">
          {series.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5">
              <span className="size-2 rounded-sm" style={{ backgroundColor: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      </CardHeader>
      <CardContent className="pt-2">
        <ChartContainer config={config} className="aspect-auto w-full" style={{ height }}>
          <LineChart
            accessibilityLayer
            data={data}
            margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
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
              cursor={{ stroke: "var(--accent)", strokeWidth: 1 }}
              content={
                <ChartTooltipContent
                  labelKey="label"
                  formatter={(v, name) => (
                    <div className="flex flex-1 justify-between gap-2">
                      <span className="text-muted-foreground">{String(name)}</span>
                      <span className="font-mono font-medium text-foreground tabular-nums">
                        {fmtPesos.format(Number(v ?? 0))}
                      </span>
                    </div>
                  )}
                />
              }
            />
            {series.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stroke={`var(--color-${s.key})`}
                strokeWidth={2}
                dot={{ r: 3, fill: `var(--color-${s.key})` }}
                activeDot={{ r: 5 }}
                name={s.label}
              />
            ))}
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
