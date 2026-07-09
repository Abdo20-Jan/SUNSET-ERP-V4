import Link from "next/link";

import { fmtDate, fmtMoney } from "@/lib/format";
import { buttonVariants } from "@/components/ui/button";
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

/*
 * PedidoCompraComexTab (PR-029) — aba "Comex" do record da OC.
 * READ-ONLY: lista embarques con `Embarque.pedidoCompraId = OC` (select estrecho,
 * SIN costos landed — canon A.2 da `Ver costo landed = ❌` al perfil Compras; el FOB
 * es abierto, patrón CX-02). "Generar proceso Comex" = LINK SIMPLE a
 * /comex/embarques/nuevo (preflight-5 caso (b): el circuito Comex no conoce
 * `pedidoCompraId` hoy; el prefill/vínculo automático se difiere a un PR propio —
 * activaría lógica dormida de CxP exterior). Motor Comex: cero toque (09/G-09).
 */
export type EmbarqueVinculadoRow = {
  id: string;
  codigo: string;
  estado: string;
  fechaSalida: string | null;
  fechaLlegada: string | null;
  moneda: string;
  fobTotal: string;
};

type Props = {
  embarques: EmbarqueVinculadoRow[];
};

function GenerarProcesoButton() {
  return (
    <Link href="/comex/embarques/nuevo" className={buttonVariants({ size: "sm" })}>
      Generar proceso Comex
    </Link>
  );
}

export function PedidoCompraComexTab({ embarques }: Props) {
  if (embarques.length === 0) {
    return (
      <Card className="flex flex-col items-start gap-3 p-6">
        <p className="text-sm text-muted-foreground">
          Ningún proceso Comex vinculado a este pedido. El vínculo automático OC→Embarque llega en
          un PR futuro; por ahora el embarque se crea desde Comex.
        </p>
        <GenerarProcesoButton />
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <GenerarProcesoButton />
      </div>
      <Card className="py-0">
        <Table>
          <caption className="sr-only">Embarques vinculados al pedido</caption>
          <TableHeader>
            <TableRow>
              <TableHead>Embarque</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Salida</TableHead>
              <TableHead>Llegada</TableHead>
              <TableHead>Moneda</TableHead>
              <TableHead className="text-right">FOB total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {embarques.map((e) => (
              <TableRow key={e.id}>
                <TableCell>
                  <EntityLink label={e.codigo} href={`/comex/embarques/${e.id}`} />
                </TableCell>
                <TableCell>
                  <StatusBadge estado={e.estado} />
                </TableCell>
                <TableCell>{e.fechaSalida ? fmtDate(new Date(e.fechaSalida)) : "—"}</TableCell>
                <TableCell>{e.fechaLlegada ? fmtDate(new Date(e.fechaLlegada)) : "—"}</TableCell>
                <TableCell>{e.moneda}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {fmtMoney(e.fobTotal)} {e.moneda}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
