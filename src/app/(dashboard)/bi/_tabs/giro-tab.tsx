import type { IconSvgElement } from "@hugeicons/react";
import {
  Cash01Icon,
  Clock01Icon,
  CreditCardIcon,
  Invoice01Icon,
  PackageIcon,
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
import { convertirAUsd, fmtInt, fmtMoney } from "@/lib/format";
import { getAnalisisGiro } from "@/lib/services/bi-giro";
import { CATALOGO_KPI_VERSION, kpisPorCategoria } from "@/lib/services/bi-kpi-catalogo";
import { puedeVerCostoStock, puedeVerMargen } from "@/lib/permisos-masking";

import { KpiCard } from "../../dashboard/_components/kpi-card";

type Accent = "neutral" | "positive" | "negative" | "warning" | "info";

const ICONO: Record<string, IconSvgElement> = {
  "giro.dso": Invoice01Icon,
  "giro.dio": PackageIcon,
  "giro.dpo": CreditCardIcon,
  "giro.ccc": Clock01Icon,
  "giro.nof": Cash01Icon,
};

function fmtDias(n: number): string {
  return `${n.toFixed(1)} d`;
}

export async function GiroTab({
  desde,
  hasta,
  tc,
}: {
  desde?: Date | null;
  hasta?: Date | null;
  tc?: string | null;
}) {
  const [{ indicadores, inputs }, verMargen, verCostoStock] = await Promise.all([
    getAnalisisGiro({ desde, hasta }),
    // PR-011: CMV agregado (margenes.ver) e inventario al costo (stock.verCosto).
    // Los ratios de giro (DSO/DIO/DPO/CCC) son adimensionales → no se enmascaran.
    puedeVerMargen(),
    puedeVerCostoStock(),
  ]);
  const symbol = tc ? "USD " : "$ ";
  const money = (n: number) => `${symbol}${fmtMoney(convertirAUsd(n.toString(), tc ?? null))}`;

  // Días son TC-invariantes (adimensionales); sólo NOF es monto y se convierte.
  const valores: Record<string, { value: string; accent: Accent }> = {
    "giro.dso": { value: fmtDias(indicadores.dso), accent: "info" },
    "giro.dio": { value: fmtDias(indicadores.dio), accent: "info" },
    "giro.dpo": { value: fmtDias(indicadores.dpo), accent: "positive" },
    "giro.ccc": {
      value: fmtDias(indicadores.ccc),
      accent: indicadores.ccc <= 0 ? "positive" : "warning",
    },
    "giro.nof": {
      value: money(indicadores.nof),
      accent: indicadores.nof <= 0 ? "positive" : "neutral",
    },
  };

  const defs = kpisPorCategoria("giro");

  const insumos: { label: string; valor: string }[] = [
    { label: "Ventas del período (c/IVA)", valor: money(inputs.ventasPeriodo) },
    { label: "CMV del período (al costo)", valor: verMargen ? money(inputs.cmvPeriodo) : "—" },
    { label: "Inventario (al costo)", valor: verCostoStock ? money(inputs.inventario) : "—" },
    { label: "Cuentas por cobrar (1.1.3.*)", valor: money(inputs.cxc) },
    { label: "Proveedores comerciales (2.1.1.*)", valor: money(inputs.cxpComercial) },
    { label: "Días del período", valor: fmtInt(inputs.diasPeriodo) },
  ];

  return (
    <div className="flex flex-col gap-3">
      <section className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        {defs.map((def) => {
          const v = valores[def.id];
          return (
            <KpiCard
              key={def.id}
              label={def.label}
              value={v?.value ?? "—"}
              hint={def.sigla}
              icon={ICONO[def.id] ?? Clock01Icon}
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
              Saldos acumulados a la fecha; flujos del período. Catálogo de KPI v
              {CATALOGO_KPI_VERSION}.
            </p>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader className="border-b border-border/60 pb-2">
            <CardTitle>Insumos del período</CardTitle>
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
