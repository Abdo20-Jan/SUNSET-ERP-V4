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

const fmtPct = new Intl.NumberFormat("es-AR", {
  style: "percent",
  maximumFractionDigits: 1,
});

export type RankingPoint = {
  label: string;
  value: number;
};

export function HorizontalBarRanking({
  title,
  description,
  data,
  color = "var(--chart-4)",
  valueFormat = "money",
}: {
  title: string;
  description?: string;
  data: RankingPoint[];
  color?: string;
  valueFormat?: "money" | "int" | "percent";
}) {
  const fmtValue = (v: number) => {
    if (valueFormat === "percent") return fmtPct.format(v);
    if (valueFormat === "int") return v.toLocaleString("es-AR");
    return fmtPesos.format(v);
  };

  if (data.length === 0) {
    return (
      <Card size="sm">
        <CardHeader className="flex-row items-center justify-between border-b border-border/60 pb-2">
          <div className="flex flex-col gap-0.5">
            <CardTitle>{title}</CardTitle>
            {description ? (
              <p className="text-[11px] text-muted-foreground">{description}</p>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="pt-3 text-[12px] text-muted-foreground">
          Sin datos para mostrar.
        </CardContent>
      </Card>
    );
  }

  const heightPerRow = 24;
  const height = Math.max(140, data.length * heightPerRow + 40);

  const tickFmt = (v: number) => {
    if (valueFormat === "percent") return fmtPct.format(v);
    if (valueFormat === "int") return fmtCompact.format(v);
    return fmtCompact.format(v);
  };

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
            layout="vertical"
            margin={{ top: 4, right: 16, bottom: 0, left: 4 }}
            barCategoryGap={6}
          >
            <CartesianGrid strokeDasharray="2 4" stroke="var(--border)" horizontal={false} />
            <XAxis
              type="number"
              tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
              tickFormatter={tickFmt}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              type="category"
              dataKey="label"
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
              width={140}
            />
            <ChartTooltip
              cursor={{ fill: "var(--accent)", opacity: 0.4 }}
              content={
                <ChartTooltipContent
                  labelKey="label"
                  formatter={(v) => (
                    <span className="font-mono font-medium text-foreground tabular-nums">
                      {fmtValue(Number(v ?? 0))}
                    </span>
                  )}
                />
              }
            />
            <Bar dataKey="value" fill="var(--color-value)" radius={[0, 3, 3, 0]} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
