import {
  ChartIncreaseIcon,
  ChartLineData01Icon,
  Coins01Icon,
  CreditCardIcon,
  Invoice01Icon,
  PackageIcon,
  ShoppingBag03Icon,
  CargoShipIcon,
} from "@hugeicons/core-free-icons";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtMoney, fmtInt, convertirAUsd } from "@/lib/format";
import { getResumenEjecutivo } from "@/lib/services/bi";

import { KpiCard } from "../../dashboard/_components/kpi-card";
import { BarChartMoneyLazy, LineChartMoneyLazy } from "../_components/charts/lazy";

function pctLabel(p: number): string {
  if (!Number.isFinite(p) || p === 0) return "—";
  const fmt = new Intl.NumberFormat("es-AR", {
    style: "percent",
    maximumFractionDigits: 1,
  });
  const sign = p > 0 ? "+" : "";
  return `${sign}${fmt.format(p)}`;
}

export async function ResumenTab({
  desde,
  hasta,
  tc,
}: {
  desde?: Date | null;
  hasta?: Date | null;
  tc?: string | null;
}) {
  const r = await getResumenEjecutivo({ desde, hasta });
  const k = r.kpis;
  const money = (n: number) => fmtMoney(convertirAUsd(n.toString(), tc ?? null));
  const symbol = tc ? "USD " : "$ ";

  return (
    <div className="flex flex-col gap-3">
      {r.alertas.length > 0 ? (
        <Card size="sm">
          <CardHeader className="gap-1">
            <CardTitle className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-amber-500" />
              Alertas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1.5 text-[12px]">
              {r.alertas.map((a) => (
                <li
                  key={a.id}
                  className={`rounded-md border px-2.5 py-1.5 ${
                    a.nivel === "critical"
                      ? "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-950/50 dark:bg-rose-950/20 dark:text-rose-200"
                      : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-950/50 dark:bg-amber-950/20 dark:text-amber-200"
                  }`}
                >
                  <div className="font-semibold">{a.titulo}</div>
                  <div className="text-[11px] opacity-80">{a.detalle}</div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <section className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <KpiCard
          label="Facturación período"
          value={`${symbol}${money(k.facturacionPeriodo)}`}
          icon={ShoppingBag03Icon}
          accent="positive"
          hint={`vs anterior: ${pctLabel(k.facturacionDelta)}`}
        />
        <KpiCard
          label="Margen bruto"
          value={`${symbol}${money(k.margenBruto)}`}
          icon={ChartIncreaseIcon}
          accent={k.margenBruto >= 0 ? "positive" : "negative"}
          hint={pctLabel(k.margenBrutoPct)}
        />
        <KpiCard
          label="Resultado del ejercicio"
          value={`${symbol}${money(k.resultadoEjercicio)}`}
          icon={ChartLineData01Icon}
          accent={k.resultadoEjercicio >= 0 ? "positive" : "negative"}
          hint="Ingresos − Egresos"
        />
        <KpiCard
          label="Saldo Bancos + Caja"
          value={`${symbol}${money(k.saldoBancosCaja)}`}
          icon={Coins01Icon}
          accent={k.saldoBancosCaja >= 0 ? "positive" : "negative"}
          hint="Cuentas 1.1.1.* y 1.1.2.*"
        />
        <KpiCard
          label="Stock valorado"
          value={`${symbol}${money(k.stockValorado)}`}
          icon={PackageIcon}
          accent="info"
          hint="Σ costo promedio × cantidad"
        />
        <KpiCard
          label="Cuentas a cobrar"
          value={`${symbol}${money(k.cxc)}`}
          icon={Invoice01Icon}
          accent="info"
          hint="Saldo deudor 1.1.3.*"
        />
        <KpiCard
          label="Cuentas a pagar"
          value={`${symbol}${money(k.cxp)}`}
          icon={CreditCardIcon}
          accent="warning"
          hint="Categoría PASIVO"
        />
        <KpiCard
          label="Embarques activos"
          value={fmtInt(k.embarquesActivos)}
          icon={CargoShipIcon}
          accent="neutral"
          hint="≠ DESPACHADO / CERRADO"
        />
      </section>

      <LineChartMoneyLazy
        title="Facturación y resultado · 12 meses"
        description="Facturación emitida vs Resultado neto (ingresos − egresos)"
        data={r.facturacionResultado12m.map((d) => ({
          label: d.label,
          facturacion: d.facturacion,
          resultado: d.resultado,
        }))}
        series={[
          { key: "facturacion", label: "Facturación", color: "var(--chart-4)" },
          { key: "resultado", label: "Resultado", color: "var(--chart-1)" },
        ]}
      />

      <BarChartMoneyLazy
        title="Facturación mensual · 12 meses"
        description="Suma de Venta.total emitidas (ARS, USD convertido por TC de la venta)"
        data={r.facturacionResultado12m.map((d) => ({
          label: d.label,
          value: d.facturacion,
        }))}
      />

      {r.alertas.length === 0 ? (
        <Card size="sm">
          <CardHeader className="gap-1">
            <CardTitle className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              Sin alertas activas
            </CardTitle>
          </CardHeader>
        </Card>
      ) : null}
    </div>
  );
}
