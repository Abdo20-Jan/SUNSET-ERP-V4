import { fmtDate, fmtMontoPres } from "@/lib/format";
import { EntityLink } from "@/components/data-grid/entity-link";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Moneda } from "../../../../reportes/_components/moneda-toggle";

/*
 * PedidoCompraComprasTab (PR-029) — aba "Compras vinculadas" do record da OC.
 * READ-ONLY: lista las facturas de compra con `Compra.pedidoCompraId = OC`
 * (query page-level, misma fuente del card del detalle bespoke anterior).
 * Montos native-first vía fmtMontoPres (lección anti-÷tc-ciego).
 */
export type CompraVinculadaRow = {
  id: string;
  numero: string;
  fecha: string;
  estado: string;
  moneda: Moneda;
  total: string;
};

type Props = {
  compras: CompraVinculadaRow[];
  moneda: Moneda;
  tc: string | null;
};

export function PedidoCompraComprasTab({ compras, moneda, tc }: Props) {
  if (compras.length === 0) {
    return (
      <Card className="p-6">
        <p className="text-sm text-muted-foreground">
          Sin facturas creadas desde este pedido. Use «Crear factura desde pedido» en la barra de
          acciones.
        </p>
      </Card>
    );
  }
  return (
    <Card className="py-0">
      <Table>
        <caption className="sr-only">Facturas de compra vinculadas al pedido</caption>
        <TableHeader>
          <TableRow>
            <TableHead>Número</TableHead>
            <TableHead>Fecha</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead>Moneda</TableHead>
            <TableHead className="text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {compras.map((c) => (
            <TableRow key={c.id}>
              <TableCell>
                <EntityLink label={c.numero} href={`/compras/${c.id}`} />
              </TableCell>
              <TableCell>{fmtDate(new Date(c.fecha))}</TableCell>
              <TableCell>
                <StatusBadge estado={c.estado} />
              </TableCell>
              <TableCell>{c.moneda}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {fmtMontoPres(c.total, c.moneda, moneda, tc)} {moneda}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
