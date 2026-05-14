import {
  ReceiptDollarIcon,
  PercentSquareIcon,
  Invoice01Icon,
  ChartLineData01Icon,
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
import { getAnalisisFiscal } from "@/lib/services/bi";

import { KpiCard } from "../../dashboard/_components/kpi-card";
import {
  HorizontalBarRankingLazy,
  LineChartMoneyLazy,
  StackedBarChartLazy,
} from "../_components/charts/lazy";

export async function FiscalTab({
  desde,
  hasta,
  tc,
}: {
  desde?: Date | null;
  hasta?: Date | null;
  tc?: string | null;
}) {
  const r = await getAnalisisFiscal({ desde, hasta });
  const money = (n: number) => fmtMoney(convertirAUsd(n.toString(), tc ?? null));
  const symbol = tc ? "USD " : "$ ";

  return (
    <div className="flex flex-col gap-3">
      <section className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <KpiCard
          label="IVA débito período"
          value={`${symbol}${money(r.kpis.ivaSaldo)}`}
          icon={ReceiptDollarIcon}
          accent="warning"
          hint="Σ Venta.iva emitida"
        />
        <KpiCard
          label="IIBB propio cobrado"
          value={`${symbol}${money(r.kpis.iibbTotalPropio)}`}
          icon={PercentSquareIcon}
          accent="info"
          hint="Σ Venta.iibb (embutido)"
        />
        <KpiCard
          label="Percepciones IIBB"
          value={`${symbol}${money(r.kpis.percepcionesCobradas)}`}
          icon={Invoice01Icon}
          accent="info"
          hint="Cobradas a clientes"
        />
        <KpiCard
          label="Provisión Ganancias"
          value={`${symbol}${money(r.kpis.provisionGanancias)}`}
          icon={ChartLineData01Icon}
          accent="warning"
          hint="Cuenta 5.5.99.* acum."
        />
      </section>

      <StackedBarChartLazy
        title="IVA débito vs crédito · 12 meses"
        description="Débito = Σ Venta.iva · Crédito = Σ saldos cuentas 1.1.4.0x"
        data={r.ivaMensal.map((m) => ({
          label: m.label,
          debito: m.debito,
          credito: m.credito,
        }))}
        series={[
          { key: "debito", label: "Débito", color: "var(--chart-2)" },
          { key: "credito", label: "Crédito", color: "var(--chart-1)" },
        ]}
        height={260}
      />

      <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <HorizontalBarRankingLazy
          title="IIBB / Percepciones por jurisdicción"
          description="Percepción IIBB cobrada en el período"
          data={r.iibbPorJurisdiccion}
          color="var(--chart-4)"
        />
        <LineChartMoneyLazy
          title="Percepciones IIBB · 12 meses"
          description="Evolución de percepciones cobradas a clientes"
          data={r.percepcionesMensales.map((d) => ({
            label: d.label,
            percepcion: d.value,
          }))}
          series={[{ key: "percepcion", label: "Percepciones", color: "var(--chart-3)" }]}
        />
      </section>

      <Card size="sm">
        <CardHeader className="border-b border-border/60 pb-2">
          <CardTitle>Saldo IVA mensual · 12 meses</CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mes</TableHead>
                <TableHead className="text-right">Débito</TableHead>
                <TableHead className="text-right">Crédito</TableHead>
                <TableHead className="text-right">Saldo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.ivaSaldoMensal.map((m) => (
                <TableRow key={m.mes}>
                  <TableCell>{m.mes}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {symbol}
                    {money(m.debito)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {symbol}
                    {money(m.credito)}
                  </TableCell>
                  <TableCell
                    className={`text-right font-mono tabular-nums ${
                      m.saldo > 0
                        ? "text-rose-700 dark:text-rose-400"
                        : m.saldo < 0
                          ? "text-emerald-700 dark:text-emerald-400"
                          : "text-muted-foreground"
                    }`}
                  >
                    {symbol}
                    {money(m.saldo)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader className="border-b border-border/60 pb-2">
          <CardTitle>Retenciones</CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right">Sufridas</TableHead>
                <TableHead className="text-right">Cobradas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.retenciones.map((rt) => (
                <TableRow key={rt.label}>
                  <TableCell>{rt.label}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {symbol}
                    {money(rt.sufridas)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {symbol}
                    {money(rt.cobradas)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
