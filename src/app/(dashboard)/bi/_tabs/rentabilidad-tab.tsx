import type { IconSvgElement } from "@hugeicons/react";
import { Cash01Icon, ChartIncreaseIcon, PercentSquareIcon } from "@hugeicons/core-free-icons";

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
import { CATALOGO_KPI_VERSION, kpisPorCategoria } from "@/lib/services/bi-kpi-catalogo";
import { getAnalisisLucro } from "@/lib/services/bi-lucro";

import { stripAnalisisLucro } from "./rentabilidad-strip";
import { KpiCard } from "../../dashboard/_components/kpi-card";
import {
  HorizontalBarRankingLazy,
  LineChartMoneyLazy,
  StackedBarChartLazy,
} from "../_components/charts/lazy";

type Accent = "neutral" | "positive" | "negative" | "warning" | "info";

const ICONO: Record<string, IconSvgElement> = {
  "rentabilidad.margenBruto": ChartIncreaseIcon,
  "rentabilidad.margenBrutoPct": PercentSquareIcon,
  "rentabilidad.ebit": ChartIncreaseIcon,
  "rentabilidad.margenOperativoPct": PercentSquareIcon,
  "rentabilidad.ebitda": Cash01Icon,
  "rentabilidad.margenEbitdaPct": PercentSquareIcon,
  "rentabilidad.resultadoNeto": Cash01Icon,
  "rentabilidad.margenNetoPct": PercentSquareIcon,
};

const pctFmt = new Intl.NumberFormat("es-AR", {
  style: "percent",
  maximumFractionDigits: 1,
});

const acc = (n: number): Accent => (n >= 0 ? "positive" : "negative");

export async function RentabilidadTab({
  desde,
  hasta,
  tc,
}: {
  desde?: Date | null;
  hasta?: Date | null;
  tc?: string | null;
}) {
  // PR-011: strip de costo/margen en la frontera (sin tocar el motor BI). Sin
  // `margenes.ver` los indicadores llegan en null y las series vacías.
  const { indicadores, inputs, dimensionales } = await stripAnalisisLucro(
    await getAnalisisLucro({ desde, hasta }),
  );
  const symbol = tc ? "USD " : "$ ";
  const money = (n: number) => `${symbol}${fmtMoney(convertirAUsd(n.toString(), tc ?? null))}`;
  // Versiones null-safe: un indicador strip-eado (null) se muestra como "—".
  const moneyN = (n: number | null) => (n == null ? "—" : money(n));
  const pctN = (n: number | null) => (n == null ? "—" : pctFmt.format(n));
  const accN = (n: number | null): Accent => (n == null ? "neutral" : acc(n));

  // Tarjetas catálogo-driven. Los % son TC-invariantes; los montos se convierten.
  const valores: Record<string, { value: string; accent: Accent }> = {
    "rentabilidad.margenBruto": {
      value: moneyN(indicadores.margenBruto),
      accent: accN(indicadores.margenBruto),
    },
    "rentabilidad.margenBrutoPct": {
      value: pctN(indicadores.margenBrutoPct),
      accent: accN(indicadores.margenBrutoPct),
    },
    "rentabilidad.ebit": { value: moneyN(indicadores.ebit), accent: accN(indicadores.ebit) },
    "rentabilidad.margenOperativoPct": {
      value: pctN(indicadores.margenOperativoPct),
      accent: accN(indicadores.margenOperativoPct),
    },
    "rentabilidad.ebitda": { value: moneyN(indicadores.ebitda), accent: accN(indicadores.ebitda) },
    "rentabilidad.margenEbitdaPct": {
      value: pctN(indicadores.margenEbitdaPct),
      accent: accN(indicadores.margenEbitdaPct),
    },
    "rentabilidad.resultadoNeto": {
      value: moneyN(indicadores.resultadoNeto),
      accent: accN(indicadores.resultadoNeto),
    },
    "rentabilidad.margenNetoPct": {
      value: pctN(indicadores.margenNetoPct),
      accent: accN(indicadores.margenNetoPct),
    },
  };

  const defs = kpisPorCategoria("rentabilidad");

  // Cascada contable (razón RT9): cada nivel con su monto y % sobre ventas.
  // `monto`/`pct` quedan null si falta `margenes.ver` (salvo "Ingresos netos").
  const cascada: { label: string; monto: number | null; pct: number | null; enfasis?: boolean }[] =
    [
      { label: "Ingresos netos", monto: inputs.ventas, pct: inputs.ventas > 0 ? 1 : 0 },
      { label: "Resultado bruto", monto: indicadores.margenBruto, pct: indicadores.margenBrutoPct },
      {
        label: "Resultado operativo (EBIT)",
        monto: indicadores.ebit,
        pct: indicadores.margenOperativoPct,
      },
      { label: "EBITDA", monto: indicadores.ebitda, pct: indicadores.margenEbitdaPct },
      {
        label: "Resultado neto",
        monto: indicadores.resultadoNeto,
        pct: indicadores.margenNetoPct,
        enfasis: true,
      },
    ];

  return (
    <div className="flex flex-col gap-3">
      <section className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
        {defs.map((def) => {
          const v = valores[def.id];
          return (
            <KpiCard
              key={def.id}
              label={def.label}
              value={v?.value ?? "—"}
              hint={def.sigla}
              icon={ICONO[def.id] ?? ChartIncreaseIcon}
              accent={v?.accent ?? "neutral"}
            />
          );
        })}
      </section>

      <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card size="sm">
          <CardHeader className="border-b border-border/60 pb-2">
            <CardTitle>Cascada de resultado · razón (RT9)</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Concepto</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead className="text-right">% s/ventas</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cascada.map((c) => (
                  <TableRow key={c.label}>
                    <TableCell className={c.enfasis ? "font-semibold" : undefined}>
                      {c.label}
                    </TableCell>
                    <TableCell
                      className={`text-right font-mono tabular-nums ${
                        (c.monto ?? 0) < 0 ? "text-rose-700 dark:text-rose-400" : ""
                      } ${c.enfasis ? "font-semibold" : ""}`}
                    >
                      {moneyN(c.monto)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                      {pctN(c.pct)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Verdad contable del razón (asientos contabilizados). Reconcilia con el Estado de
              Resultados de Reportes. Catálogo de KPI v{CATALOGO_KPI_VERSION}.
            </p>
          </CardContent>
        </Card>

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
          </CardContent>
        </Card>
      </section>

      <div className="mt-1 flex items-center gap-2">
        <span className="size-1.5 rounded-full bg-amber-500" />
        <h3 className="text-sm font-medium text-muted-foreground">
          Márgenes operativos por dimensión (costo promedio · no contable)
        </h3>
      </div>

      <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <HorizontalBarRankingLazy
          title="Margen % por canal"
          description="(Ingresos − costo promedio) / ingresos"
          data={dimensionales.margenPorCanal}
          color="var(--chart-1)"
          valueFormat="percent"
        />
        <HorizontalBarRankingLazy
          title="Margen % por marca"
          description="Top 10 marcas por rentabilidad"
          data={dimensionales.margenPorMarca}
          color="var(--chart-3)"
          valueFormat="percent"
        />
      </section>

      <LineChartMoneyLazy
        title="Evolución margen bruto · 12 meses"
        description="Σ (subtotal − costoPromedio × cantidad) por mes"
        data={dimensionales.margenBrutoMensal.map((d) => ({ label: d.label, margen: d.value }))}
        series={[{ key: "margen", label: "Margen bruto", color: "var(--chart-1)" }]}
      />

      {dimensionales.precioVsCosto.length > 0 ? (
        <StackedBarChartLazy
          title="Precio venta vs costo · top productos"
          description="Comparativo unitario por SKU activo"
          data={dimensionales.precioVsCosto.map((p) => ({
            label: p.producto.slice(0, 20),
            costo: p.costo,
            margen: Math.max(p.precio - p.costo, 0),
          }))}
          series={[
            { key: "costo", label: "Costo", color: "var(--chart-2)" },
            { key: "margen", label: "Margen", color: "var(--chart-1)" },
          ]}
          height={260}
        />
      ) : null}

      <Card size="sm">
        <CardHeader className="border-b border-border/60 pb-2">
          <CardTitle>Top productos por margen absoluto</CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          {dimensionales.topProductosMargen.length === 0 ? (
            <p className="py-3 text-center text-xs text-muted-foreground">
              Sin ventas en el período.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-right">Margen</TableHead>
                  <TableHead className="text-right">Margen %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dimensionales.topProductosMargen.map((p, i) => (
                  <TableRow key={`${p.producto}-${i}`}>
                    <TableCell>{p.producto}</TableCell>
                    <TableCell
                      className={`text-right font-mono tabular-nums ${
                        p.margen < 0
                          ? "text-rose-700 dark:text-rose-400"
                          : "text-emerald-700 dark:text-emerald-400"
                      }`}
                    >
                      {money(p.margen)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {pctFmt.format(p.pct)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader className="border-b border-border/60 pb-2">
          <CardTitle className="flex items-center gap-2 text-rose-700 dark:text-rose-400">
            <span className="size-1.5 rounded-full bg-rose-500" />
            Productos vendidos por debajo del costo
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          {dimensionales.vendidosBajoCosto.length === 0 ? (
            <p className="py-3 text-center text-xs text-muted-foreground">
              Sin operaciones con precio menor al costo ✓
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-right">Precio</TableHead>
                  <TableHead className="text-right">Costo</TableHead>
                  <TableHead className="text-right">Pérdida unit.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dimensionales.vendidosBajoCosto.map((p, i) => (
                  <TableRow key={`${p.producto}-${i}`}>
                    <TableCell>{p.producto}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {money(p.precio)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {money(p.costo)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-rose-700 dark:text-rose-400">
                      {money(p.costo - p.precio)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
