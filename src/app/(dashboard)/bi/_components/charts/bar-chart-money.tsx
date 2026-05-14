"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
  return (
    <Card size="sm">
      <CardHeader className="flex-row items-center justify-between border-b border-border/60 pb-2">
        <div className="flex flex-col gap-0.5">
          <CardTitle>{title}</CardTitle>
          {description ? <p className="text-[11px] text-muted-foreground">{description}</p> : null}
        </div>
      </CardHeader>
      <CardContent className="pt-2">
        <div style={{ height }} className="w-full">
          <ResponsiveContainer width="100%" height="100%" minHeight={180}>
            <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
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
              <Tooltip
                cursor={{ fill: "var(--accent)", opacity: 0.4 }}
                contentStyle={{
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                  background: "var(--popover)",
                  color: "var(--popover-foreground)",
                  fontSize: 12,
                  padding: "6px 10px",
                  boxShadow: "0 4px 16px rgba(20,20,20,0.08)",
                }}
                formatter={(v) => [fmtPesos.format(Number(v ?? 0)), title]}
              />
              <Bar dataKey="value" fill={color} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
