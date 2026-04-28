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

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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

export function IngresosEgresosChart({
  data,
}: {
  data: IngresoEgresoMensual[];
}) {
  return (
    <Card className="border-l-4 border-l-indigo-500">
      <CardHeader>
        <CardTitle className="text-base">Ingresos vs Egresos</CardTitle>
        <p className="text-xs text-muted-foreground">
          Últimos 6 meses · agregado de cuentas INGRESO y EGRESO
        </p>
      </CardHeader>
      <CardContent>
        <div className="h-72 w-full">
          <ResponsiveContainer>
            <BarChart
              data={data}
              margin={{ top: 8, right: 8, bottom: 8, left: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fontSize: 11 }}
                tickFormatter={(v) => fmtCompact.format(Number(v))}
                tickLine={false}
                axisLine={false}
                width={60}
              />
              <Tooltip
                cursor={{ fill: "rgba(148,163,184,0.08)" }}
                contentStyle={{
                  borderRadius: 8,
                  border: "1px solid rgb(226 232 240)",
                  fontSize: 12,
                }}
                formatter={(value, name) => [
                  fmtPesos.format(Number(value ?? 0)),
                  String(name),
                ]}
              />
              <Legend
                wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                iconType="circle"
              />
              <Bar
                dataKey="ingresos"
                fill="#10b981"
                name="Ingresos"
                radius={[4, 4, 0, 0]}
              />
              <Bar
                dataKey="egresos"
                fill="#f43f5e"
                name="Egresos"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
