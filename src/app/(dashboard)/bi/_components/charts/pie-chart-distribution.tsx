"use client";

import { Cell, Pie, PieChart } from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";

const fmtPesos = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

const fmtPct = new Intl.NumberFormat("es-AR", {
  style: "percent",
  maximumFractionDigits: 1,
});

const PALETTE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-1)",
  "var(--chart-2)",
];

export type PiePoint = {
  label: string;
  value: number;
};

export function PieChartDistribution({
  title,
  description,
  data,
  height = 240,
  valueFormat = "money",
}: {
  title: string;
  description?: string;
  data: PiePoint[];
  height?: number;
  valueFormat?: "money" | "int";
}) {
  const total = data.reduce((acc, d) => acc + d.value, 0);
  const sorted = [...data].sort((a, b) => b.value - a.value);

  const fmtValue = (v: number) =>
    valueFormat === "money" ? fmtPesos.format(v) : v.toLocaleString("es-AR");

  const config = Object.fromEntries(
    sorted.map((d, i) => [d.label, { label: d.label, color: PALETTE[i % PALETTE.length] }]),
  ) satisfies ChartConfig;

  return (
    <Card size="sm">
      <CardHeader className="flex-row items-center justify-between border-b border-border/60 pb-2">
        <div className="flex flex-col gap-0.5">
          <CardTitle>{title}</CardTitle>
          {description ? <p className="text-[11px] text-muted-foreground">{description}</p> : null}
        </div>
      </CardHeader>
      <CardContent className="pt-2">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
          <ChartContainer config={config} className="aspect-auto w-full" style={{ height }}>
            <PieChart>
              <Pie
                data={sorted}
                dataKey="value"
                nameKey="label"
                outerRadius={Math.max(60, height / 2 - 16)}
                innerRadius={Math.max(30, height / 2 - 56)}
                paddingAngle={1}
              >
                {sorted.map((d, i) => (
                  <Cell key={d.label} fill={PALETTE[i % PALETTE.length]} />
                ))}
              </Pie>
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    nameKey="label"
                    formatter={(v, name) => (
                      <div className="flex flex-1 justify-between gap-2">
                        <span className="text-muted-foreground">{String(name)}</span>
                        <span className="font-mono font-medium text-foreground tabular-nums">
                          {fmtValue(Number(v ?? 0))}
                        </span>
                      </div>
                    )}
                  />
                }
              />
            </PieChart>
          </ChartContainer>
          <ul className="flex flex-col gap-1.5 text-[11px]">
            {sorted.map((d, i) => (
              <li key={d.label} className="flex items-center gap-2">
                <span
                  className="size-2 shrink-0 rounded-sm"
                  style={{ backgroundColor: PALETTE[i % PALETTE.length] }}
                />
                <span className="min-w-0 truncate text-muted-foreground">{d.label}</span>
                <span className="ml-auto font-mono tabular-nums text-foreground">
                  {fmtValue(d.value)}
                </span>
                <span className="font-mono tabular-nums text-muted-foreground">
                  {total > 0 ? fmtPct.format(d.value / total) : "—"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
