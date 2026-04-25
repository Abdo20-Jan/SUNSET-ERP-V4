import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";

import {
  getAsientoDetalle,
  type AsientoDetalle,
} from "@/lib/actions/asientos";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type PageParams = Promise<{ id: string }>;

function estadoVariant(
  estado: AsientoDetalle["estado"],
): "default" | "outline" | "secondary" {
  switch (estado) {
    case "BORRADOR":
      return "outline";
    case "CONTABILIZADO":
      return "default";
    case "ANULADO":
      return "secondary";
  }
}

export default async function AsientoDetallePage({
  params,
}: {
  params: PageParams;
}) {
  const { id } = await params;
  const result = await getAsientoDetalle(id);
  if (!result.ok) notFound();
  const detalle = result.detalle;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href="/contabilidad/asientos"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" />
          Volver a la lista
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            Asiento Nº {detalle.numero}
          </h1>
          <Badge variant="outline" className="font-mono text-xs">
            {detalle.periodoCodigo}
          </Badge>
          <Badge variant={estadoVariant(detalle.estado)}>{detalle.estado}</Badge>
          <Badge variant="ghost" className="text-xs">
            {detalle.origen}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">{detalle.descripcion}</p>
      </div>

      <Card className="flex flex-col gap-0 overflow-hidden p-0">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 p-6 text-sm sm:grid-cols-4">
          <InfoRow label="Fecha" value={format(detalle.fecha, "dd/MM/yyyy")} />
          <InfoRow label="Período" value={detalle.periodoCodigo} />
          <InfoRow label="Moneda" value={detalle.moneda} />
          <InfoRow
            label="Tipo de cambio"
            value={Number(detalle.tipoCambio).toFixed(
              detalle.moneda === "ARS" ? 2 : 6,
            )}
          />
        </dl>

        <Separator />

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Código</TableHead>
                <TableHead>Cuenta</TableHead>
                <TableHead>Referencia</TableHead>
                <TableHead className="text-right">Debe</TableHead>
                <TableHead className="text-right">Haber</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detalle.lineas.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-mono text-xs">
                    {l.cuentaCodigo}
                  </TableCell>
                  <TableCell className="text-sm">{l.cuentaNombre}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {l.descripcion ?? "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">
                    {Number(l.debe) > 0 ? l.debe : ""}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">
                    {Number(l.haber) > 0 ? l.haber : ""}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="border-t-2">
                <TableCell
                  colSpan={3}
                  className="text-right text-sm font-medium"
                >
                  Totales
                </TableCell>
                <TableCell className="text-right font-mono text-sm font-semibold tabular-nums">
                  {detalle.totalDebe}
                </TableCell>
                <TableCell className="text-right font-mono text-sm font-semibold tabular-nums">
                  {detalle.totalHaber}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono text-sm">{value}</dd>
    </div>
  );
}
