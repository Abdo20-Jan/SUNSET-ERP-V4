import { notFound } from "next/navigation";
import { format } from "date-fns";

import { getAsientoDetalle, type AsientoDetalle } from "@/lib/actions/asientos";
import { getAuditLog } from "@/lib/services/auditoria";
import { db } from "@/lib/db";
import { resolveActiveTab } from "@/lib/record-tabs";
import { AuditTrail } from "@/components/ui/audit-trail";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { RecordHeader } from "@/components/layout/record-header";
import { RecordTabs } from "@/components/ui/record-tabs";
import { StatusBadge } from "@/components/ui/status-badge";
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
type SearchParams = Promise<{ tab?: string }>;

export const dynamic = "force-dynamic";

export default async function AsientoDetallePage({
  params,
  searchParams,
}: {
  params: PageParams;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const result = await getAsientoDetalle(id);
  if (!result.ok) notFound();
  const detalle = result.detalle;

  const activeTab = resolveActiveTab(sp.tab, ["general", "historial"], "general");
  const historialCount = await db.auditLog.count({
    where: { tabla: "Asiento", registroId: id },
  });

  return (
    <div className="flex flex-col gap-3">
      <RecordHeader
        breadcrumb={[
          { label: "Asientos", href: "/contabilidad/asientos" },
          { label: `Asiento Nº ${detalle.numero}` },
        ]}
        title={`Asiento Nº ${detalle.numero}`}
        status={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge estado={detalle.estado} />
            <Badge variant="outline" className="font-mono text-xs">
              {detalle.periodoCodigo}
            </Badge>
            <Badge variant="ghost" className="text-xs">
              {detalle.origen}
            </Badge>
          </div>
        }
        subtitle={detalle.descripcion}
      />

      <RecordTabs
        activeValue={activeTab}
        tabs={[
          { value: "general", label: "General" },
          { value: "historial", label: "Historial", count: historialCount },
        ]}
      />

      {activeTab === "general" && <GeneralTab detalle={detalle} />}
      {activeTab === "historial" && <HistorialTab asientoId={id} />}
    </div>
  );
}

function GeneralTab({ detalle }: { detalle: AsientoDetalle }) {
  // Si el asiento toca cuentas USD-natas (proveedor exterior, préstamo USD),
  // mostramos columnas USD al lado de las ARS para que el usuario vea el
  // principal invariante a TC junto con la valuación ARS legal.
  const lineasUsd = detalle.lineas.filter((l) => l.monedaOrigen === "USD");
  const tieneUsd = lineasUsd.length > 0;
  const totalUsdDebe = lineasUsd.reduce(
    (acc, l) => (Number(l.debe) > 0 && l.montoOrigen ? acc + Number(l.montoOrigen) : acc),
    0,
  );
  const totalUsdHaber = lineasUsd.reduce(
    (acc, l) => (Number(l.haber) > 0 && l.montoOrigen ? acc + Number(l.montoOrigen) : acc),
    0,
  );

  return (
    <Card className="flex flex-col gap-0 overflow-hidden p-0">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 p-6 text-sm sm:grid-cols-4">
        <InfoRow label="Fecha" value={format(detalle.fecha, "dd/MM/yyyy")} />
        <InfoRow label="Período" value={detalle.periodoCodigo} />
        <InfoRow label="Moneda" value={detalle.moneda} />
        <InfoRow
          label="Tipo de cambio"
          value={Number(detalle.tipoCambio).toFixed(detalle.moneda === "ARS" ? 2 : 6)}
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
              {tieneUsd && (
                <>
                  <TableHead className="text-right text-muted-foreground">Debe (USD)</TableHead>
                  <TableHead className="text-right text-muted-foreground">Haber (USD)</TableHead>
                </>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {detalle.lineas.map((l) => {
              const debeUsd =
                l.monedaOrigen === "USD" && Number(l.debe) > 0 && l.montoOrigen
                  ? l.montoOrigen
                  : null;
              const haberUsd =
                l.monedaOrigen === "USD" && Number(l.haber) > 0 && l.montoOrigen
                  ? l.montoOrigen
                  : null;
              return (
                <TableRow key={l.id}>
                  <TableCell className="font-mono text-xs">{l.cuentaCodigo}</TableCell>
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
                  {tieneUsd && (
                    <>
                      <TableCell className="text-right font-mono text-sm tabular-nums text-muted-foreground">
                        {debeUsd ? `US$ ${debeUsd}` : ""}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm tabular-nums text-muted-foreground">
                        {haberUsd ? `US$ ${haberUsd}` : ""}
                      </TableCell>
                    </>
                  )}
                </TableRow>
              );
            })}
            <TableRow className="border-t-2">
              <TableCell colSpan={3} className="text-right text-sm font-medium">
                Totales
              </TableCell>
              <TableCell className="text-right font-mono text-sm font-semibold tabular-nums">
                {detalle.totalDebe}
              </TableCell>
              <TableCell className="text-right font-mono text-sm font-semibold tabular-nums">
                {detalle.totalHaber}
              </TableCell>
              {tieneUsd && (
                <>
                  <TableCell className="text-right font-mono text-sm font-semibold tabular-nums text-muted-foreground">
                    US$ {totalUsdDebe.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm font-semibold tabular-nums text-muted-foreground">
                    US$ {totalUsdHaber.toFixed(2)}
                  </TableCell>
                </>
              )}
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

async function HistorialTab({ asientoId }: { asientoId: string }) {
  const entries = await getAuditLog("Asiento", asientoId);
  return <AuditTrail entries={entries} />;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono text-sm">{value}</dd>
    </div>
  );
}
