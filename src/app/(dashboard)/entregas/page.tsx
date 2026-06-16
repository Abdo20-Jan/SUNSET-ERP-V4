import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listarVentasConEntregaPendiente } from "@/lib/actions/entregas";
import { isStockDualEnabled } from "@/lib/features";
import { fmtDate, fmtInt } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function EntregasHubPage() {
  if (!isStockDualEnabled()) {
    return (
      <main className="container mx-auto space-y-4 p-6">
        <h1 className="text-2xl font-semibold">Entregas</h1>
        <p className="text-muted-foreground">
          El módulo de entregas (stock dual) no está habilitado en este ambiente. Setear{" "}
          <code>STOCK_DUAL_ENABLED=true</code> para activarlo.
        </p>
      </main>
    );
  }

  const ventas = await listarVentasConEntregaPendiente();
  const totalUnidades = ventas.reduce((a, v) => a + v.unidadesPendientes, 0);

  return (
    <main className="container mx-auto space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Entregas pendientes</h1>
        <p className="text-sm text-muted-foreground">
          {ventas.length} venta(s) con despacho pendiente · {fmtInt(totalUnidades)} unidades por
          entregar
        </p>
      </header>

      {ventas.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No hay ventas con entregas pendientes. Todo lo emitido fue despachado.
          </CardContent>
        </Card>
      ) : (
        <Card className="py-0">
          <Table>
            <caption className="sr-only">Ventas con despacho pendiente</caption>
            <TableHeader>
              <TableRow>
                <TableHead>Venta</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead className="text-right">Pendiente / Vendido</TableHead>
                <TableHead>Remitos</TableHead>
                <TableHead className="text-right">Acción</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ventas.map((v) => (
                <TableRow key={v.ventaId}>
                  <TableCell className="font-mono text-xs">{v.numero.trim()}</TableCell>
                  <TableCell>{v.clienteNombre}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {fmtDate(v.fecha)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {fmtInt(v.unidadesPendientes)} / {fmtInt(v.unidadesVendidas)}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {v.nBorrador > 0 && <Badge variant="secondary">{v.nBorrador} borrador</Badge>}
                      {v.nConfirmadas > 0 && (
                        <Badge variant="outline">{v.nConfirmadas} confirm.</Badge>
                      )}
                      {v.nBorrador === 0 && v.nConfirmadas === 0 && (
                        <Badge variant="destructive">sin remito</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/ventas/${v.ventaId}/entregas`}
                      className={buttonVariants({ variant: "default", size: "sm" })}
                    >
                      Despachar
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </main>
  );
}
