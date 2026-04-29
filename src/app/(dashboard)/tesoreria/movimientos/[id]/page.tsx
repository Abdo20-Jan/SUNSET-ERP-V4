import Link from "next/link";
import { notFound } from "next/navigation";

import { db } from "@/lib/db";
import { toDecimal } from "@/lib/decimal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtMoney } from "../../../reportes/_components/money";

import { AnularAsientoButton } from "./anular-asiento-button";

type PageParams = Promise<{ id: string }>;

export const dynamic = "force-dynamic";

export default async function MovimientoDetallePage({
  params,
}: {
  params: PageParams;
}) {
  const { id } = await params;

  const mov = await db.movimientoTesoreria.findUnique({
    where: { id },
    select: {
      id: true,
      tipo: true,
      fecha: true,
      monto: true,
      moneda: true,
      tipoCambio: true,
      descripcion: true,
      comprobante: true,
      referenciaBanco: true,
      createdAt: true,
      cuentaBancaria: {
        select: {
          id: true,
          banco: true,
          moneda: true,
          numero: true,
          cbu: true,
          cuentaContable: { select: { codigo: true, nombre: true } },
        },
      },
      cuentaContable: { select: { codigo: true, nombre: true } },
      asiento: {
        select: {
          id: true,
          numero: true,
          fecha: true,
          descripcion: true,
          estado: true,
          origen: true,
          totalDebe: true,
          totalHaber: true,
          periodo: { select: { codigo: true } },
          lineas: {
            orderBy: { id: "asc" },
            select: {
              id: true,
              debe: true,
              haber: true,
              descripcion: true,
              cuenta: {
                select: { id: true, codigo: true, nombre: true, categoria: true },
              },
            },
          },
        },
      },
      lineaExtracto: {
        select: {
          importacion: { select: { id: true } },
          confianza: true,
          razonSugerencia: true,
        },
      },
    },
  });

  if (!mov) notFound();

  const fechaStr = formatFecha(mov.fecha);
  const tipoLabel =
    mov.tipo === "PAGO"
      ? "Pago"
      : mov.tipo === "COBRO"
        ? "Cobro"
        : "Transferencia";
  const tipoBadgeVariant =
    mov.tipo === "PAGO"
      ? "secondary"
      : mov.tipo === "COBRO"
        ? "default"
        : "outline";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3 border-b border-border/60 pb-2">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <h1 className="text-[15px] font-semibold tracking-tight">
              {tipoLabel} de Tesorería
            </h1>
            <Badge variant={tipoBadgeVariant}>{mov.tipo}</Badge>
            {mov.asiento && (
              <Badge
                variant={
                  mov.asiento.estado === "CONTABILIZADO"
                    ? "default"
                    : mov.asiento.estado === "ANULADO"
                      ? "destructive"
                      : "outline"
                }
              >
                {mov.asiento.estado}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {fechaStr} · ID: <span className="font-mono">{mov.id.slice(0, 8)}…</span>
            {mov.asiento && (
              <>
                {" "}
                · Asiento{" "}
                <Link
                  href={`/contabilidad/asientos/${mov.asiento.id}`}
                  className="text-primary underline-offset-2 hover:underline"
                >
                  Nº {mov.asiento.numero}
                </Link>{" "}
                · Período {mov.asiento.periodo.codigo}
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/tesoreria/movimientos">
            <Button variant="outline" size="sm">
              ← Volver
            </Button>
          </Link>
          {mov.asiento && mov.asiento.estado === "CONTABILIZADO" && (
            <AnularAsientoButton
              asientoId={mov.asiento.id}
              asientoNumero={mov.asiento.numero}
            />
          )}
        </div>
      </div>

      {/* KPIs principales */}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        <Card className="border-l-4 border-l-primary">
          <CardContent className="flex flex-col gap-0.5">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Monto
            </span>
            <span className="font-mono text-[18px] font-semibold tabular-nums">
              {mov.moneda} {fmtMoney(mov.monto.toString())}
            </span>
            {mov.moneda !== "ARS" && (
              <span className="text-[11px] text-muted-foreground">
                TC {Number(mov.tipoCambio).toFixed(2)} · ARS{" "}
                {fmtMoney(
                  toDecimal(mov.monto)
                    .times(toDecimal(mov.tipoCambio))
                    .toFixed(2),
                )}
              </span>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-0.5">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Cuenta bancaria
            </span>
            <span className="text-sm font-medium">
              {mov.cuentaBancaria.banco}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {mov.cuentaBancaria.numero ?? "—"} · {mov.cuentaBancaria.moneda}
            </span>
            <span className="font-mono text-[10px] text-muted-foreground">
              {mov.cuentaBancaria.cuentaContable.codigo}{" "}
              {mov.cuentaBancaria.cuentaContable.nombre}
            </span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-0.5">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Contrapartida principal
            </span>
            <span className="text-sm font-medium">
              {mov.cuentaContable.nombre}
            </span>
            <span className="font-mono text-[10px] text-muted-foreground">
              {mov.cuentaContable.codigo}
            </span>
          </CardContent>
        </Card>
      </div>

      {/* Datos del pago */}
      <Card>
        <CardHeader>
          <CardTitle className="text-[14px]">Datos del movimiento</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-[13px] md:grid-cols-2">
            <DataRow label="Fecha" value={fechaStr} />
            <DataRow label="Tipo" value={tipoLabel} />
            <DataRow
              label="Comprobante"
              value={mov.comprobante ?? "—"}
              mono
            />
            <DataRow
              label="Referencia banco"
              value={mov.referenciaBanco ?? "—"}
              mono
            />
            {mov.cuentaBancaria.cbu && (
              <DataRow
                label="CBU cuenta"
                value={mov.cuentaBancaria.cbu}
                mono
              />
            )}
            <DataRow
              label="Registrado el"
              value={formatFecha(mov.createdAt)}
            />
            {mov.descripcion && (
              <div className="col-span-full flex flex-col gap-0.5">
                <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Descripción
                </dt>
                <dd className="text-[13px]">{mov.descripcion}</dd>
              </div>
            )}
            {mov.lineaExtracto && (
              <div className="col-span-full rounded-md border border-indigo-300/60 bg-indigo-50/60 px-3 py-2 text-[12px] text-indigo-900 dark:border-indigo-700/50 dark:bg-indigo-950/20 dark:text-indigo-200">
                <strong>Importado de extracto bancario</strong>
                {mov.lineaExtracto.confianza
                  ? ` (confianza IA: ${mov.lineaExtracto.confianza})`
                  : ""}
                {mov.lineaExtracto.razonSugerencia && (
                  <p className="mt-1">{mov.lineaExtracto.razonSugerencia}</p>
                )}
              </div>
            )}
          </dl>
        </CardContent>
      </Card>

      {/* Asiento contable */}
      {mov.asiento ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-[14px]">
              Asiento contable Nº {mov.asiento.numero}
            </CardTitle>
            <CardDescription>
              {mov.asiento.descripcion} · Origen: {mov.asiento.origen} ·
              Período {mov.asiento.periodo.codigo}
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Pos.</TableHead>
                  <TableHead className="w-32">Cuenta</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Descripción línea</TableHead>
                  <TableHead className="w-28 text-right">Debe</TableHead>
                  <TableHead className="w-28 text-right">Haber</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mov.asiento.lineas.map((l, i) => {
                  const debeNum = toDecimal(l.debe).toNumber();
                  const haberNum = toDecimal(l.haber).toNumber();
                  return (
                    <TableRow key={l.id}>
                      <TableCell className="text-[11px] uppercase tracking-wider text-muted-foreground">
                        {debeNum > 0 ? "DEBE" : haberNum > 0 ? "HABER" : "—"}{" "}
                        {i + 1}
                      </TableCell>
                      <TableCell className="font-mono text-[12px]">
                        {l.cuenta.codigo}
                      </TableCell>
                      <TableCell className="text-[13px]">
                        {l.cuenta.nombre}
                        <span className="ml-2 text-[10px] uppercase text-muted-foreground">
                          {l.cuenta.categoria}
                        </span>
                      </TableCell>
                      <TableCell className="text-[12px] text-muted-foreground">
                        {l.descripcion ?? "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[13px] tabular-nums">
                        {debeNum > 0 ? fmtMoney(l.debe.toString()) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[13px] tabular-nums">
                        {haberNum > 0 ? fmtMoney(l.haber.toString()) : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
                <TableRow className="border-t-2 bg-muted/40 font-semibold">
                  <TableCell colSpan={4} className="text-right text-[12px]">
                    Totales
                  </TableCell>
                  <TableCell className="text-right font-mono text-[13px] tabular-nums">
                    {fmtMoney(mov.asiento.totalDebe.toString())}
                  </TableCell>
                  <TableCell className="text-right font-mono text-[13px] tabular-nums">
                    {fmtMoney(mov.asiento.totalHaber.toString())}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="text-sm text-muted-foreground">
            Este movimiento no tiene asiento asociado (puede haber sido anulado
            o no contabilizado).
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function DataRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className={mono ? "font-mono text-[12px]" : "text-[13px]"}>
        {value}
      </dd>
    </div>
  );
}

function formatFecha(d: Date): string {
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const year = d.getUTCFullYear();
  return `${day}/${month}/${year}`;
}
