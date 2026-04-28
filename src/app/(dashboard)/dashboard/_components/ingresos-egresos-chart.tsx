"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import type { IngresoEgresoMensual } from "@/lib/services/dashboard";

const fmtCompact = new Intl.NumberFormat("es-AR", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const fmtPesos = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

const COLOR_INGRESO = "var(--chart-1)";
const COLOR_EGRESO = "var(--chart-2)";

export function IngresosEgresosChart({
  data,
}: {
  data: IngresoEgresoMensual[];
}) {
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
            <span
              className="size-2 rounded-sm"
              style={{ backgroundColor: COLOR_INGRESO }}
            />
            Ingresos
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="size-2 rounded-sm"
              style={{ backgroundColor: COLOR_EGRESO }}
            />
            Egresos
          </span>
        </div>
      </CardHeader>
      <CardContent className="pt-2">
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%" minHeight={200}>
            <BarChart
              data={data}
              margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
              barCategoryGap={20}
            >
              <CartesianGrid
                strokeDasharray="2 4"
                stroke="var(--border)"
                vertical={false}
              />
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
                labelStyle={{
                  fontSize: 11,
                  fontWeight: 600,
                  marginBottom: 2,
                }}
                formatter={(value, name) => [
                  fmtPesos.format(Number(value ?? 0)),
                  String(name),
                ]}
              />
              <Legend content={() => null} />
              <Bar
                dataKey="ingresos"
                fill={COLOR_INGRESO}
                name="Ingresos"
                radius={[3, 3, 0, 0]}
              />
              <Bar
                dataKey="egresos"
                fill={COLOR_EGRESO}
                name="Egresos"
                radius={[3, 3, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
