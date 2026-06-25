import {
  AlertCircleIcon,
  Calendar03Icon,
  Coins01Icon,
  ContainerIcon,
  PackageIcon,
  PackageOpenIcon,
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
import { fmtInt, fmtMoney, convertirAUsd, fmtDateOrDash } from "@/lib/format";
import { type AnalisisBonded, getAnalisisBonded, getAnalisisStock } from "@/lib/services/bi";
import { puedeVerCostoLanded, puedeVerCostoStock } from "@/lib/permisos-masking";

import { KpiCard } from "../../dashboard/_components/kpi-card";
import { HorizontalBarRankingLazy } from "../_components/charts/lazy";

export async function StockTab({ tc }: { tc?: string | null }) {
  const [r, bonded, verCostoStock, verLanded] = await Promise.all([
    getAnalisisStock(),
    getAnalisisBonded(),
    // PR-011: valorización de stock NACIONAL (stock.verCosto) y bonded FOB/landed
    // (costos.verLanded). Sin la clave el valor no cruza al cliente (charts vacíos
    // + montos "—"); cantidades/aging/contenedores quedan visibles.
    puedeVerCostoStock(),
    puedeVerCostoLanded(),
  ]);
  const money = (n: number) => fmtMoney(convertirAUsd(n.toString(), tc ?? null));
  const symbol = tc ? "USD " : "$ ";
  const moneyStock = (n: number) => (verCostoStock ? `${symbol}${money(n)}` : "—");

  return (
    <div className="flex flex-col gap-3">
      {bonded ? <BondedSection bonded={bonded} verLanded={verLanded} /> : null}
      <section className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <KpiCard
          label="Stock valorado"
          value={moneyStock(r.kpis.valorado)}
          icon={Coins01Icon}
          accent="positive"
          hint="Σ cantidadFisica × costoPromedio"
        />
        <KpiCard
          label="Unidades totales"
          value={fmtInt(r.kpis.unidades)}
          icon={PackageIcon}
          accent="info"
        />
        <KpiCard
          label="SKUs con stock"
          value={fmtInt(r.kpis.skusConStock)}
          icon={PackageOpenIcon}
          accent="neutral"
        />
        <KpiCard
          label="Slow movers"
          value={fmtInt(r.kpis.slowMovers)}
          icon={AlertCircleIcon}
          accent={r.kpis.slowMovers > 0 ? "warning" : "neutral"}
          hint="Sin movimiento > 90 días"
        />
      </section>

      <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <HorizontalBarRankingLazy
          title="Stock valorado por depósito"
          description="Suma costo × cantidad física"
          data={verCostoStock ? r.porDeposito : []}
          color="var(--chart-1)"
        />
        <HorizontalBarRankingLazy
          title="Top 10 productos por valor"
          description="Costo × cantidad acumulado por SKU"
          data={verCostoStock ? r.topProductosValor : []}
          color="var(--chart-4)"
        />
      </section>

      <Card size="sm">
        <CardHeader className="border-b border-border/60 pb-2">
          <CardTitle>Disponible vs reservado por depósito</CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Depósito</TableHead>
                <TableHead className="text-right">Disponible</TableHead>
                <TableHead className="text-right">Reservado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.disponibleVsReservado.map((d) => (
                <TableRow key={d.deposito}>
                  <TableCell>{d.deposito}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {fmtInt(d.disponible)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums text-amber-700 dark:text-amber-400">
                    {fmtInt(d.reservado)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader className="border-b border-border/60 pb-2">
          <CardTitle className="flex items-center gap-2 text-rose-700 dark:text-rose-400">
            <span className="size-1.5 rounded-full bg-rose-500" />
            Stock crítico
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          {r.stockCritico.length === 0 ? (
            <p className="py-3 text-center text-xs text-muted-foreground">
              Sin productos por debajo del mínimo ✓
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead>Depósito</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  <TableHead className="text-right">Mínimo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.stockCritico.map((s, i) => (
                  <TableRow key={`${s.codigo}-${s.deposito}-${i}`}>
                    <TableCell className="font-mono text-[12px]">{s.codigo}</TableCell>
                    <TableCell>{s.producto}</TableCell>
                    <TableCell className="text-muted-foreground">{s.deposito}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-rose-700 dark:text-rose-400">
                      {fmtInt(s.cantidad)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {fmtInt(s.minimo)}
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
          <CardTitle>Slow movers · sin movimiento {">"} 90 días</CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          {r.slowMovers.length === 0 ? (
            <p className="py-3 text-center text-xs text-muted-foreground">
              Sin productos sin movimiento ✓
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead>Depósito</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="text-right">Días sin mov.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.slowMovers.map((s, i) => (
                  <TableRow key={`${s.producto}-${s.deposito}-${i}`}>
                    <TableCell>{s.producto}</TableCell>
                    <TableCell className="text-muted-foreground">{s.deposito}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {fmtInt(s.cantidad)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {moneyStock(s.valor)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-amber-700 dark:text-amber-400">
                      {fmtInt(s.diasSinMov)}
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
          <CardTitle>Últimas transferencias</CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          {r.ultimasTransferencias.length === 0 ? (
            <p className="py-3 text-center text-xs text-muted-foreground">
              Sin transferencias registradas.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Número</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead>Origen</TableHead>
                  <TableHead>Destino</TableHead>
                  <TableHead className="text-right">Cantidad</TableHead>
                  <TableHead>Fecha</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.ultimasTransferencias.map((t) => (
                  <TableRow key={t.numero}>
                    <TableCell className="font-mono text-[12px]">{t.numero}</TableCell>
                    <TableCell>{t.producto}</TableCell>
                    <TableCell className="text-muted-foreground">{t.origen}</TableCell>
                    <TableCell className="text-muted-foreground">{t.destino}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {fmtInt(t.cantidad)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {fmtDateOrDash(t.fecha)}
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

// PR 5.3 — sección bonded (depósito fiscal), sólo visible con la flag de
// desconsolidación encendida. Valor inmovilizado en USD (costoFCUnitario),
// antigüedad (aging) de los contenedores y despachos abiertos por SKU.
function BondedSection({ bonded, verLanded }: { bonded: AnalisisBonded; verLanded: boolean }) {
  // PR-011: el valor inmovilizado bonded sale de costoFCUnitario (FOB/landed) →
  // gateado por `costos.verLanded`. Sin la clave se muestra "—".
  const usd = (n: number) => (verLanded ? `USD ${fmtMoney(n.toString())}` : "—");

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-dashed border-border/70 p-3">
      <h2 className="text-sm font-semibold text-muted-foreground">Depósito fiscal · bonded</h2>

      <section className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <KpiCard
          label="Valor inmovilizado"
          value={usd(bonded.kpis.valorUsd)}
          icon={Coins01Icon}
          accent="info"
          hint="Σ disponible × costo FC unitario"
        />
        <KpiCard
          label="Unidades en DF"
          value={fmtInt(bonded.kpis.unidadesDisponibles)}
          icon={PackageIcon}
          accent="neutral"
        />
        <KpiCard
          label="Contenedores en DF"
          value={fmtInt(bonded.kpis.contenedores)}
          icon={ContainerIcon}
          accent="neutral"
        />
        <KpiCard
          label="Aging p50 / p90"
          value={`${fmtInt(bonded.aging.p50)} / ${fmtInt(bonded.aging.p90)} d`}
          icon={Calendar03Icon}
          accent={bonded.aging.p90 > 90 ? "warning" : "neutral"}
          hint={`máx ${fmtInt(bonded.aging.max)} días en depósito fiscal`}
        />
      </section>

      <Card size="sm">
        <CardHeader className="border-b border-border/60 pb-2">
          <CardTitle>Stock bonded por SKU</CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          {bonded.porSku.length === 0 ? (
            <p className="py-3 text-center text-xs text-muted-foreground">
              Sin stock en depósito fiscal.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-right">Disponible</TableHead>
                  <TableHead className="text-right">En despacho</TableHead>
                  <TableHead className="text-right">Valor USD</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bonded.porSku.map((s) => (
                  <TableRow key={s.codigo}>
                    <TableCell className="font-mono text-[12px]">{s.codigo}</TableCell>
                    <TableCell>{s.producto}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {fmtInt(s.disponible)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-amber-700 dark:text-amber-400">
                      {s.enDespacho > 0 ? fmtInt(s.enDespacho) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {usd(s.valorUsd)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {bonded.despachosAbiertos.length > 0 ? (
        <Card size="sm">
          <CardHeader className="border-b border-border/60 pb-2">
            <CardTitle>Despachos abiertos por SKU</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-right">Unidades</TableHead>
                  <TableHead className="text-right">Valor USD</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bonded.despachosAbiertos.map((d) => (
                  <TableRow key={d.codigo}>
                    <TableCell className="font-mono text-[12px]">{d.codigo}</TableCell>
                    <TableCell>{d.producto}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-amber-700 dark:text-amber-400">
                      {fmtInt(d.unidades)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {usd(d.valorUsd)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
