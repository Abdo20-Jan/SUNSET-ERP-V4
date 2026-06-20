import {
  CargoShipIcon,
  Coins01Icon,
  Clock01Icon,
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
import { convertirMonto, fmtDateOrDash, fmtInt, fmtMoney } from "@/lib/format";
import { getAnalisisCompras } from "@/lib/services/bi";

import { KpiCard } from "../../dashboard/_components/kpi-card";
import {
  HorizontalBarRankingLazy,
  LineChartMoneyLazy,
  PieChartDistributionLazy,
  StackedBarChartLazy,
} from "../_components/charts/lazy";

const pctFmt = new Intl.NumberFormat("es-AR", {
  style: "percent",
  maximumFractionDigits: 1,
});

export async function ComprasTab({
  desde,
  hasta,
  moneda,
  tcCierre,
}: {
  desde?: Date | null;
  hasta?: Date | null;
  /** Moneda de presentación (toggle). Default "USD". */
  moneda?: "ARS" | "USD";
  /** TC de cierre sin gatear (convierte FOB USD nativo ↔ costos/tributos ARS). */
  tcCierre?: string | null;
}) {
  const r = await getAnalisisCompras({ desde, hasta });
  // FOB es USD nativo; costos/tributos son ARS. Sólo presentamos en USD si hay
  // TC para convertir la parte ARS; si no, caemos a ARS (degradación segura).
  const tcConv = tcCierre ?? null;
  const monedaEff: "ARS" | "USD" = moneda === "USD" && tcConv ? "USD" : "ARS";
  const symbol = monedaEff === "USD" ? "USD " : "$ ";
  const pres = (value: number, nativa: "ARS" | "USD") =>
    Number(convertirMonto(value.toString(), nativa, monedaEff, tcConv));

  return (
    <div className="flex flex-col gap-3">
      <section className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <KpiCard
          label="Importado período"
          value={`${symbol}${fmtMoney(pres(r.kpis.importadoUsd, "USD").toString())}`}
          icon={CargoShipIcon}
          accent="info"
          hint="Σ FOB embarques creados en rango"
        />
        <KpiCard
          label="Costo nacionalizado"
          value={pctFmt.format(r.kpis.costoNacionalizadoPct || 0)}
          icon={PercentSquareIcon}
          accent="warning"
          hint="costo landed / FOB (misma moneda)"
        />
        <KpiCard
          label="Ciclo promedio"
          value={`${fmtInt(r.kpis.cicloPromedioDias)} días`}
          icon={Clock01Icon}
          accent="neutral"
          hint="empaque → cierre"
        />
        <KpiCard
          label="Embarques activos"
          value={fmtInt(r.kpis.embarquesActivos)}
          icon={Coins01Icon}
          accent="info"
        />
      </section>

      <Card size="sm">
        <CardHeader className="border-b border-border/60 pb-2">
          <CardTitle>Embarques por estado</CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-8">
            {r.embarquesPorEstado.map((e) => (
              <div key={e.estado} className="rounded-md border bg-muted/30 px-2.5 py-1.5 text-xs">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {e.estado.replace(/_/g, " ")}
                </div>
                <div className="font-mono text-base font-semibold tabular-nums">
                  {fmtInt(e.cantidad)}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <LineChartMoneyLazy
        title={`Importación · 12 meses (${monedaEff})`}
        description="FOB total de embarques creados por mes"
        data={r.importacionUsdMensal.map((d) => ({ label: d.label, fob: pres(d.value, "USD") }))}
        series={[{ key: "fob", label: `FOB ${monedaEff}`, color: "var(--chart-4)" }]}
      />

      <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <HorizontalBarRankingLazy
          title="Top 10 proveedores exterior"
          description={`Suma FOB por proveedor en el período (${monedaEff})`}
          data={r.topProveedoresExterior.map((p) => ({
            label: p.label,
            value: pres(p.value, "USD"),
          }))}
          color="var(--chart-4)"
        />
        <PieChartDistributionLazy
          title="Distribución de costos de nacionalización"
          description={`Por tipo (flete, seguro, despachante, etc.) · ${monedaEff}`}
          data={r.distribucionCostos.map((d) => ({ label: d.label, value: pres(d.value, "ARS") }))}
        />
      </section>

      {r.tributosPorEmbarque.length > 0 ? (
        <StackedBarChartLazy
          title="Composición tributaria por embarque"
          description={`Últimos 12 embarques · DIE / tasa est. / arancel / IVA / IIBB / Ganancias · ${monedaEff}`}
          data={r.tributosPorEmbarque.map((t) => ({
            label: t.label,
            die: pres(t.die, "ARS"),
            tasaEstadistica: pres(t.tasaEstadistica, "ARS"),
            arancel: pres(t.arancel, "ARS"),
            iva: pres(t.iva, "ARS"),
            ivaAdicional: pres(t.ivaAdicional, "ARS"),
            ganancias: pres(t.ganancias, "ARS"),
            iibb: pres(t.iibb, "ARS"),
          }))}
          series={[
            { key: "die", label: "DIE", color: "var(--chart-1)" },
            { key: "tasaEstadistica", label: "Tasa est.", color: "var(--chart-2)" },
            { key: "arancel", label: "Arancel", color: "var(--chart-3)" },
            { key: "iva", label: "IVA", color: "var(--chart-4)" },
            { key: "ivaAdicional", label: "IVA Ad.", color: "var(--chart-5)" },
            { key: "ganancias", label: "Ganancias", color: "var(--chart-1)" },
            { key: "iibb", label: "IIBB", color: "var(--chart-2)" },
          ]}
          height={260}
        />
      ) : null}

      <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card size="sm">
          <CardHeader className="border-b border-border/60 pb-2">
            <CardTitle>Pedidos de compra por estado</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
              {r.pedidosCompraPorEstado.map((p) => (
                <div key={p.estado} className="rounded-md border bg-muted/30 px-2.5 py-1.5 text-xs">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {p.estado}
                  </div>
                  <div className="font-mono text-base font-semibold tabular-nums">
                    {fmtInt(p.cantidad)}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader className="border-b border-border/60 pb-2">
            <CardTitle>Despachos sin contabilizar</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            {r.despachosSinContabilizar.length === 0 ? (
              <p className="py-3 text-center text-xs text-muted-foreground">
                Todos los despachos contabilizados ✓
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Despacho</TableHead>
                    <TableHead>Embarque</TableHead>
                    <TableHead>Fecha</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.despachosSinContabilizar.map((d) => (
                    <TableRow key={d.codigo}>
                      <TableCell className="font-mono text-[12px]">{d.codigo}</TableCell>
                      <TableCell>{d.embarque}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {fmtDateOrDash(d.fecha)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </section>

      <Card size="sm">
        <CardHeader className="border-b border-border/60 pb-2">
          <CardTitle>Embarques en tránsito</CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          {r.embarquesEnTransito.length === 0 ? (
            <p className="py-3 text-center text-xs text-muted-foreground">
              Sin embarques en tránsito.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Proveedor</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Fecha estimada llegada</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.embarquesEnTransito.map((e) => (
                  <TableRow key={e.codigo}>
                    <TableCell className="font-mono text-[12px]">{e.codigo}</TableCell>
                    <TableCell>{e.proveedor}</TableCell>
                    <TableCell className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      {e.estado.replace(/_/g, " ")}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {fmtDateOrDash(e.fechaLlegada)}
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
