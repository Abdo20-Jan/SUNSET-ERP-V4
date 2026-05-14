import {
  ShoppingBag03Icon,
  Invoice01Icon,
  Coins01Icon,
  ChartIncreaseIcon,
} from "@hugeicons/core-free-icons";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtMoney, fmtInt, convertirAUsd } from "@/lib/format";
import { getAnalisisVentas } from "@/lib/services/bi";

import { KpiCard } from "../../dashboard/_components/kpi-card";
import {
  BarChartMoneyLazy,
  HorizontalBarRankingLazy,
  PieChartDistributionLazy,
} from "../_components/charts/lazy";

function pctLabel(p: number): string {
  if (!Number.isFinite(p) || p === 0) return "—";
  const fmt = new Intl.NumberFormat("es-AR", {
    style: "percent",
    maximumFractionDigits: 1,
  });
  const sign = p > 0 ? "+" : "";
  return `${sign}${fmt.format(p)}`;
}

export async function VentasTab({
  desde,
  hasta,
  tc,
}: {
  desde?: Date | null;
  hasta?: Date | null;
  tc?: string | null;
}) {
  const r = await getAnalisisVentas({ desde, hasta });
  const money = (n: number) => fmtMoney(convertirAUsd(n.toString(), tc ?? null));
  const symbol = tc ? "USD " : "$ ";

  return (
    <div className="flex flex-col gap-3">
      <section className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <KpiCard
          label="Facturación período"
          value={`${symbol}${money(r.kpis.facturacion)}`}
          icon={ShoppingBag03Icon}
          accent="positive"
        />
        <KpiCard
          label="Facturas emitidas"
          value={fmtInt(r.kpis.facturas)}
          icon={Invoice01Icon}
          accent="info"
        />
        <KpiCard
          label="Ticket promedio"
          value={`${symbol}${money(r.kpis.ticketPromedio)}`}
          icon={Coins01Icon}
          accent="neutral"
        />
        <KpiCard
          label="Crecimiento"
          value={pctLabel(r.kpis.delta)}
          icon={ChartIncreaseIcon}
          accent={r.kpis.delta >= 0 ? "positive" : "negative"}
          hint="vs período anterior"
        />
      </section>

      <BarChartMoneyLazy
        title="Facturación mensual · 12 meses"
        description="Suma de Venta.total emitidas (ARS equiv.)"
        data={r.facturacionMensal}
      />

      <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <HorizontalBarRankingLazy
          title="Top 10 clientes"
          description="Por facturación en el período"
          data={r.topClientes}
          color="var(--chart-4)"
        />
        <HorizontalBarRankingLazy
          title="Top 10 productos · facturación"
          description="Suma de subtotales por producto"
          data={r.topProductosFacturacion}
          color="var(--chart-1)"
        />
      </section>

      <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <HorizontalBarRankingLazy
          title="Top 10 productos · unidades"
          description="Cantidad total vendida"
          data={r.topProductosUnidades}
          color="var(--chart-3)"
          valueFormat="int"
        />
        <PieChartDistributionLazy
          title="Distribución por canal"
          description="Facturación por tipo de cliente"
          data={r.porCanal}
        />
      </section>

      <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <HorizontalBarRankingLazy
          title="Top provincias"
          description="Facturación por provincia"
          data={r.porProvincia}
          color="var(--chart-5)"
        />
        <HorizontalBarRankingLazy
          title="Top marcas"
          description="Facturación por marca de producto"
          data={r.porMarca}
          color="var(--chart-2)"
        />
      </section>

      <HorizontalBarRankingLazy
        title="Top medidas"
        description="Facturación por medida (rodada × ancho)"
        data={r.porMedida}
        color="var(--chart-3)"
      />

      <Card size="sm">
        <CardHeader className="border-b border-border/60 pb-2">
          <CardTitle>Pedidos de venta por estado</CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
            {r.pedidosPorEstado.map((p) => (
              <div key={p.estado} className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {p.estado}
                </div>
                <div className="font-mono text-lg font-semibold tabular-nums">
                  {fmtInt(p.cantidad)}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
