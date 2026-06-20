import type { IconSvgElement } from "@hugeicons/react";
import {
  Cash01Icon,
  ChartLineData01Icon,
  Coins01Icon,
  PercentSquareIcon,
} from "@hugeicons/core-free-icons";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { convertirAUsd, fmtMoney } from "@/lib/format";
import { getAnalisisLiquidez } from "@/lib/services/bi-liquidez";
import { CATALOGO_KPI_VERSION, kpisPorCategoria } from "@/lib/services/bi-kpi-catalogo";

import { KpiCard } from "../../dashboard/_components/kpi-card";

type Accent = "neutral" | "positive" | "negative" | "warning" | "info";

const ICONO: Record<string, IconSvgElement> = {
  "liquidez.razonCorriente": PercentSquareIcon,
  "liquidez.pruebaAcida": ChartLineData01Icon,
  "liquidez.liquidezInmediata": Cash01Icon,
  "liquidez.capitalTrabajo": Coins01Icon,
};

function fmtRatio(n: number): string {
  return `${n.toFixed(2)}×`;
}

export async function LiquidezTab({ tc }: { tc?: string | null }) {
  const { indicadores, inputs } = await getAnalisisLiquidez();
  const symbol = tc ? "USD " : "$ ";
  const money = (n: number) => `${symbol}${fmtMoney(convertirAUsd(n.toString(), tc ?? null))}`;

  // Los ratios son adimensionales (TC-invariantes); sólo el capital de trabajo
  // es monto y se convierte a la moneda de presentación.
  const valores: Record<string, { value: string; accent: Accent }> = {
    "liquidez.razonCorriente": { value: fmtRatio(indicadores.razonCorriente), accent: "info" },
    "liquidez.pruebaAcida": { value: fmtRatio(indicadores.pruebaAcida), accent: "info" },
    "liquidez.liquidezInmediata": {
      value: fmtRatio(indicadores.liquidezInmediata),
      accent: "info",
    },
    "liquidez.capitalTrabajo": {
      value: money(indicadores.capitalTrabajo),
      accent: indicadores.capitalTrabajo >= 0 ? "positive" : "negative",
    },
  };

  const defs = kpisPorCategoria("liquidez");

  const insumos: { label: string; valor: string }[] = [
    { label: "Activo corriente (1.1.*)", valor: money(inputs.activoCorriente) },
    { label: "Pasivo corriente (2.1.*)", valor: money(inputs.pasivoCorriente) },
    { label: "Inventario (1.1.7.*)", valor: money(inputs.inventario) },
    { label: "Disponibilidades (1.1.1.*)", valor: money(inputs.disponibilidades) },
  ];

  return (
    <div className="flex flex-col gap-3">
      <section className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {defs.map((def) => {
          const v = valores[def.id];
          return (
            <KpiCard
              key={def.id}
              label={def.label}
              value={v?.value ?? "—"}
              hint={def.sigla}
              icon={ICONO[def.id] ?? Coins01Icon}
              accent={v?.accent ?? "neutral"}
            />
          );
        })}
      </section>

      <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card size="sm">
          <CardHeader className="border-b border-border/60 pb-2">
            <CardTitle>Cómo se calcula</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Indicador</TableHead>
                  <TableHead>Fórmula</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {defs.map((def) => (
                  <TableRow key={def.id}>
                    <TableCell>
                      <div className="font-medium">
                        {def.sigla} · {def.label}
                      </div>
                      <div className="text-[11px] text-muted-foreground">{def.descripcion}</div>
                    </TableCell>
                    <TableCell className="align-top text-[12px] text-muted-foreground">
                      {def.formula}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Saldos acumulados a la fecha (foto patrimonial). Catálogo de KPI v
              {CATALOGO_KPI_VERSION}.
            </p>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader className="border-b border-border/60 pb-2">
            <CardTitle>Insumos</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <Table>
              <TableBody>
                {insumos.map((i) => (
                  <TableRow key={i.label}>
                    <TableCell className="text-muted-foreground">{i.label}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{i.valor}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
