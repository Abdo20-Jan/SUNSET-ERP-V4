import Link from "next/link";
import { format } from "date-fns";

import { db } from "@/lib/db";
import { getLibroMayor, LibroMayorError } from "@/lib/services/reportes";
import { getCotizacionParaFecha } from "@/lib/services/cotizacion";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { DateRangeFilter } from "@/components/date-range-filter";
import { convertirAUsd } from "@/lib/format";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { fmtMoney } from "../_components/money";
import { MonedaToggle, type Moneda } from "../_components/moneda-toggle";
import { MayorFilters } from "./mayor-filters";

type SearchParams = Promise<{
  cuentaId?: string;
  desde?: string;
  hasta?: string;
  moneda?: string;
}>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseId(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value || !DATE_RE.test(value)) return undefined;
  const d = new Date(value + "T00:00:00Z");
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function endOfDay(value: string | undefined): Date | undefined {
  if (!value || !DATE_RE.test(value)) return undefined;
  const d = new Date(value + "T23:59:59.999Z");
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function firstOfMonthIso(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .slice(0, 10);
}

export default async function LibroMayorPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;

  const cuentas = await db.cuentaContable.findMany({
    where: { tipo: "ANALITICA", activa: true },
    orderBy: { codigo: "asc" },
    select: { id: true, codigo: true, nombre: true },
  });

  const cuentaId = parseId(params.cuentaId);

  const desdeStr = params.desde ?? firstOfMonthIso();
  const hastaStr = params.hasta ?? todayIso();
  const fechaDesde = parseDate(desdeStr);
  const fechaHasta = endOfDay(hastaStr);

  let mayor: Awaited<ReturnType<typeof getLibroMayor>> | null = null;
  let errorMessage: string | null = null;
  if (cuentaId != null) {
    try {
      mayor = await getLibroMayor(cuentaId, { fechaDesde, fechaHasta });
    } catch (e) {
      if (e instanceof LibroMayorError) errorMessage = e.message;
      else throw e;
    }
  }

  const moneda: Moneda = params.moneda === "USD" ? "USD" : "ARS";
  const fechaCorte = fechaHasta ?? new Date();
  const cotizacion = await getCotizacionParaFecha(fechaCorte);
  const tcParaUsd =
    moneda === "USD" && cotizacion ? cotizacion.valor.toString() : null;
  const tcInfo = cotizacion
    ? {
        valor: cotizacion.valor.toString(),
        fecha: cotizacion.fecha.toISOString().slice(0, 10),
        fuente: cotizacion.fuente,
      }
    : null;
  const fmt = (v: string) => fmtMoney(convertirAUsd(v, tcParaUsd));

  const rangoLabel =
    fechaDesde && fechaHasta
      ? `Del ${desdeStr} al ${hastaStr}`
      : fechaHasta
        ? `Hasta ${hastaStr}`
        : fechaDesde
          ? `Desde ${desdeStr}`
          : "Histórico completo";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Libro Mayor</h1>
        <p className="text-sm text-muted-foreground">
          Movimientos por cuenta analítica con saldo acumulado.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <MayorFilters cuentas={cuentas} selectedCuentaId={cuentaId} />
        <DateRangeFilter
          initialDesde={desdeStr}
          initialHasta={hastaStr}
        />
        <MonedaToggle current={moneda} tcInfo={tcInfo} />
      </div>

      {errorMessage ? (
        <Card className="py-6">
          <p className="px-6 text-sm text-destructive">{errorMessage}</p>
        </Card>
      ) : mayor ? (
        <Card className="py-0">
          <div className="flex flex-wrap items-center gap-3 border-b px-6 py-4">
            <span className="font-mono text-sm">{mayor.cuenta.codigo}</span>
            <span className="font-medium">{mayor.cuenta.nombre}</span>
            <Badge variant="secondary">{mayor.cuenta.categoria}</Badge>
            <span className="ml-auto text-xs text-muted-foreground">
              {rangoLabel}
            </span>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Fecha</TableHead>
                <TableHead className="w-28">Asiento</TableHead>
                <TableHead>Descripción</TableHead>
                <TableHead className="w-32 text-right">Debe</TableHead>
                <TableHead className="w-32 text-right">Haber</TableHead>
                <TableHead className="w-36 text-right">
                  Saldo Acumulado
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!mayor.saldoInicial.isZero() ? (
                <TableRow className="bg-muted/30">
                  <TableCell colSpan={5} className="py-2 text-xs italic text-muted-foreground">
                    Saldo inicial al {desdeStr}
                  </TableCell>
                  <TableCell className="py-2 text-right font-mono text-xs tabular-nums">
                    {fmt(mayor.saldoInicial.toFixed(2))}
                  </TableCell>
                </TableRow>
              ) : null}
              {mayor.lineas.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-12 text-center text-sm text-muted-foreground"
                  >
                    Sin movimientos en esta cuenta para el rango.
                  </TableCell>
                </TableRow>
              ) : (
                mayor.lineas.map((l) => (
                  <TableRow key={l.lineaId}>
                    <TableCell className="py-2 font-mono text-xs">
                      {format(new Date(l.fecha), "yyyy-MM-dd")}
                    </TableCell>
                    <TableCell className="py-2">
                      <Link
                        href={`/contabilidad/asientos/${l.asientoId}`}
                        className="font-mono text-xs text-primary underline-offset-2 hover:underline"
                      >
                        #{l.asientoNumero}
                      </Link>
                    </TableCell>
                    <TableCell className="py-2 text-xs">
                      <span className="block">{l.asientoDescripcion}</span>
                      {l.descripcion ? (
                        <span className="block text-muted-foreground">
                          {l.descripcion}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="py-2 text-right font-mono text-xs tabular-nums">
                      {fmt(l.debe.toFixed(2))}
                    </TableCell>
                    <TableCell className="py-2 text-right font-mono text-xs tabular-nums">
                      {fmt(l.haber.toFixed(2))}
                    </TableCell>
                    <TableCell className="py-2 text-right font-mono text-xs tabular-nums">
                      {fmt(l.saldoAcumulado.toFixed(2))}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
            {mayor.lineas.length > 0 ? (
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={3} className="py-3 font-semibold">
                    Totales
                  </TableCell>
                  <TableCell className="py-3 text-right font-mono text-sm tabular-nums">
                    {fmt(mayor.totalDebe.toFixed(2))}
                  </TableCell>
                  <TableCell className="py-3 text-right font-mono text-sm tabular-nums">
                    {fmt(mayor.totalHaber.toFixed(2))}
                  </TableCell>
                  <TableCell className="py-3 text-right font-mono text-sm font-bold tabular-nums">
                    {fmt(mayor.saldoFinal.toFixed(2))}
                  </TableCell>
                </TableRow>
              </TableFooter>
            ) : null}
          </Table>
        </Card>
      ) : (
        <Card className="py-12">
          <p className="text-center text-sm text-muted-foreground">
            Seleccioná una cuenta analítica para ver sus movimientos.
          </p>
        </Card>
      )}
    </div>
  );
}
