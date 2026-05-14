import {
  AlertCircleIcon,
  Coins01Icon,
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
import { getAnalisisStock } from "@/lib/services/bi";

import { KpiCard } from "../../dashboard/_components/kpi-card";
import { HorizontalBarRankingLazy } from "../_components/charts/lazy";

export async function StockTab({ tc }: { tc?: string | null }) {
  const r = await getAnalisisStock();
  const money = (n: number) => fmtMoney(convertirAUsd(n.toString(), tc ?? null));
  const symbol = tc ? "USD " : "$ ";

  return (
    <div className="flex flex-col gap-3">
      <section className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <KpiCard
          label="Stock valorado"
          value={`${symbol}${money(r.kpis.valorado)}`}
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
          data={r.porDeposito}
          color="var(--chart-1)"
        />
        <HorizontalBarRankingLazy
          title="Top 10 productos por valor"
          description="Costo × cantidad acumulado por SKU"
          data={r.topProductosValor}
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
                      {symbol}
                      {money(s.valor)}
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
