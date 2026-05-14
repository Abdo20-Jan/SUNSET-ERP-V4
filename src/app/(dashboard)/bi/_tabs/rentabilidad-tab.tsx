import {
  ChartIncreaseIcon,
  PercentSquareIcon,
  Award01Icon,
  AlertCircleIcon,
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
import { fmtMoney, convertirAUsd } from "@/lib/format";
import { getAnalisisRentabilidad } from "@/lib/services/bi";

import { KpiCard } from "../../dashboard/_components/kpi-card";
import {
  HorizontalBarRankingLazy,
  LineChartMoneyLazy,
  StackedBarChartLazy,
} from "../_components/charts/lazy";

const pctFmt = new Intl.NumberFormat("es-AR", {
  style: "percent",
  maximumFractionDigits: 1,
});

export async function RentabilidadTab({
  desde,
  hasta,
  tc,
}: {
  desde?: Date | null;
  hasta?: Date | null;
  tc?: string | null;
}) {
  const r = await getAnalisisRentabilidad({ desde, hasta });
  const money = (n: number) => fmtMoney(convertirAUsd(n.toString(), tc ?? null));
  const symbol = tc ? "USD " : "$ ";

  return (
    <div className="flex flex-col gap-3">
      <section className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <KpiCard
          label="Margen bruto"
          value={`${symbol}${money(r.kpis.margenBruto)}`}
          icon={ChartIncreaseIcon}
          accent={r.kpis.margenBruto >= 0 ? "positive" : "negative"}
          hint={pctFmt.format(r.kpis.margenBrutoPct)}
        />
        <KpiCard
          label="Margen bruto %"
          value={pctFmt.format(r.kpis.margenBrutoPct)}
          icon={PercentSquareIcon}
          accent="info"
        />
        <KpiCard
          label="Producto top"
          value={r.kpis.productoTop ?? "—"}
          icon={Award01Icon}
          accent="positive"
          hint="Mayor margen absoluto"
        />
        <KpiCard
          label="Producto bottom"
          value={r.kpis.productoBottom ?? "—"}
          icon={AlertCircleIcon}
          accent="warning"
          hint="Menor margen absoluto"
        />
      </section>

      <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <HorizontalBarRankingLazy
          title="Margen % por canal"
          description="(Ingresos − costo promedio) / ingresos"
          data={r.margenPorCanal}
          color="var(--chart-1)"
          valueFormat="percent"
        />
        <HorizontalBarRankingLazy
          title="Margen % por marca"
          description="Top 10 marcas por rentabilidad"
          data={r.margenPorMarca}
          color="var(--chart-3)"
          valueFormat="percent"
        />
      </section>

      <LineChartMoneyLazy
        title="Evolución margen bruto · 12 meses"
        description="Σ (subtotal − costoPromedio × cantidad) por mes"
        data={r.margenBrutoMensal.map((d) => ({ label: d.label, margen: d.value }))}
        series={[{ key: "margen", label: "Margen bruto", color: "var(--chart-1)" }]}
      />

      {r.precioVsCosto.length > 0 ? (
        <StackedBarChartLazy
          title="Precio venta vs costo · top productos"
          description="Comparativo unitario por SKU activo"
          data={r.precioVsCosto.map((p) => ({
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
          {r.topProductosMargen.length === 0 ? (
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
                {r.topProductosMargen.map((p, i) => (
                  <TableRow key={`${p.producto}-${i}`}>
                    <TableCell>{p.producto}</TableCell>
                    <TableCell
                      className={`text-right font-mono tabular-nums ${
                        p.margen < 0
                          ? "text-rose-700 dark:text-rose-400"
                          : "text-emerald-700 dark:text-emerald-400"
                      }`}
                    >
                      {symbol}
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
          {r.vendidosBajoCosto.length === 0 ? (
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
                {r.vendidosBajoCosto.map((p, i) => (
                  <TableRow key={`${p.producto}-${i}`}>
                    <TableCell>{p.producto}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {symbol}
                      {money(p.precio)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {symbol}
                      {money(p.costo)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-rose-700 dark:text-rose-400">
                      {symbol}
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
