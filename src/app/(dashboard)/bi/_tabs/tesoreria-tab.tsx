import { BankIcon, CreditCardIcon, Invoice01Icon, Cash01Icon } from "@hugeicons/core-free-icons";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtInt, fmtMoney, convertirAUsd, convertirMonto } from "@/lib/format";
import { getAnalisisTesoreria } from "@/lib/services/bi";

import { KpiCard } from "../../dashboard/_components/kpi-card";
import {
  HorizontalBarRankingLazy,
  PieChartDistributionLazy,
  StackedBarChartLazy,
} from "../_components/charts/lazy";

type AgingPoint = { rango: string; importe: number };

function agingToRow(
  label: string,
  rows: AgingPoint[],
): { label: string; [k: string]: string | number } {
  const row: { label: string; [k: string]: string | number } = { label };
  for (const r of rows) row[r.rango] = r.importe;
  return row;
}

export async function TesoreriaTab({
  desde,
  hasta,
  tc,
  moneda,
  tcCierre,
}: {
  desde?: Date | null;
  hasta?: Date | null;
  tc?: string | null;
  /** Moneda de presentación (default USD). Sólo para Bancos+Caja / detalle, native-aware. */
  moneda?: "ARS" | "USD";
  /** TC de cierre NO gateado (presente también en vista ARS) para revaluar el USD nativo. */
  tcCierre?: string | null;
}) {
  const r = await getAnalisisTesoreria({ desde, hasta });
  const money = (n: number) => fmtMoney(convertirAUsd(n.toString(), tc ?? null));
  const symbol = tc ? "USD " : "$ ";

  // Bancos + Caja y el detalle por banco vienen en moneda NATIVA → se convierten
  // a la moneda de presentación con el TC de cierre (USD nativo invariante).
  // Reconcilia 1:1 con el card del dashboard y el KPI del Resumen.
  const monedaPres: "ARS" | "USD" = moneda ?? "USD";
  const bc = r.kpis.bancosCaja; // { ars, usd }
  const saldoBancos =
    Number(convertirMonto(bc.ars.toString(), "ARS", monedaPres, tcCierre ?? null)) +
    Number(convertirMonto(bc.usd.toString(), "USD", monedaPres, tcCierre ?? null));

  return (
    <div className="flex flex-col gap-3">
      <section className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <KpiCard
          label="Bancos + Caja"
          value={`${symbol}${fmtMoney(saldoBancos.toFixed(2))}`}
          icon={BankIcon}
          accent={saldoBancos >= 0 ? "positive" : "negative"}
        />
        <KpiCard
          label="Cuentas a cobrar"
          value={`${symbol}${money(r.kpis.cxc)}`}
          icon={Invoice01Icon}
          accent="info"
        />
        <KpiCard
          label="Cuentas a pagar"
          value={`${symbol}${money(r.kpis.cxp)}`}
          icon={CreditCardIcon}
          accent="warning"
        />
        <KpiCard
          label="Cheques en cartera"
          value={`${symbol}${money(r.kpis.chequesCartera)}`}
          icon={Cash01Icon}
          accent="neutral"
        />
      </section>

      <Card size="sm">
        <CardHeader className="border-b border-border/60 pb-2">
          <CardTitle>Saldos por cuenta bancaria</CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Banco</TableHead>
                <TableHead>Moneda</TableHead>
                <TableHead className="text-right">Saldo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.saldosPorBanco.map((s, i) => {
                // El saldo viene en la moneda NATIVA de la cuenta (s.moneda):
                // se convierte a la presentación con el TC de cierre (USD nativo
                // invariante), en vez del ÷tc ciego anterior.
                const saldoLinea = Number(
                  convertirMonto(s.saldo.toString(), s.moneda, monedaPres, tcCierre ?? null),
                );
                return (
                  <TableRow key={`${s.banco}-${i}`}>
                    <TableCell>{s.banco}</TableCell>
                    <TableCell className="text-[11px] text-muted-foreground">{s.moneda}</TableCell>
                    <TableCell
                      className={`text-right font-mono tabular-nums ${
                        saldoLinea < 0 ? "text-rose-700 dark:text-rose-400" : ""
                      }`}
                    >
                      {symbol}
                      {fmtMoney(saldoLinea.toFixed(2))}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <StackedBarChartLazy
          title="Aging CxC"
          description="Cuentas a cobrar por antigüedad"
          data={[agingToRow("CxC", r.agingCxc)]}
          series={r.agingCxc.map((a, i) => ({
            key: a.rango,
            label: a.rango,
            color: `var(--chart-${(i % 5) + 1})`,
          }))}
          height={180}
        />
        <StackedBarChartLazy
          title="Aging CxP"
          description="Cuentas a pagar por antigüedad"
          data={[agingToRow("CxP", r.agingCxp)]}
          series={r.agingCxp.map((a, i) => ({
            key: a.rango,
            label: a.rango,
            color: `var(--chart-${(i % 5) + 1})`,
          }))}
          height={180}
        />
      </section>

      <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <HorizontalBarRankingLazy
          title="Top 10 deudores"
          description="Clientes con mayor saldo CxC"
          data={r.topDeudores}
          color="var(--chart-4)"
        />
        <HorizontalBarRankingLazy
          title="Top 10 acreedores"
          description="Proveedores con mayor saldo CxP"
          data={r.topAcreedores}
          color="var(--chart-2)"
        />
      </section>

      <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <PieChartDistributionLazy
          title="Cheques por estado"
          description="Importe total por estado"
          data={r.chequesPorEstado.map((c) => ({ label: c.estado, value: c.importe }))}
        />
        <HorizontalBarRankingLazy
          title="Pagos del período · por banco"
          description="Total egresado por cuenta bancaria"
          data={r.pagosPeriodoPorBanco}
          color="var(--chart-2)"
        />
      </section>

      <Card size="sm">
        <CardHeader className="border-b border-border/60 pb-2">
          <CardTitle>Cheques a cobrar · próximos 60 días</CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          {r.chequesProximos.length === 0 ? (
            <p className="py-3 text-center text-xs text-muted-foreground">
              Sin cheques con fecha de pago en próximos 60 días.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Semana del</TableHead>
                  <TableHead className="text-right">Cantidad</TableHead>
                  <TableHead className="text-right">Importe</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.chequesProximos.map((c) => (
                  <TableRow key={c.semana}>
                    <TableCell className="font-mono text-[12px]">{c.semana}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {fmtInt(c.cantidad)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {symbol}
                      {money(c.importe)}
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
