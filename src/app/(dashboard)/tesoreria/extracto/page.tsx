import Link from "next/link";

import { db } from "@/lib/db";
import { getExtractoBancario } from "@/lib/services/extracto-bancario";
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
import { fmtMoney } from "../../reportes/_components/money";
import { DateRangeFilter } from "@/components/date-range-filter";

import { CuentaBancariaSelect } from "./cuenta-select";

type SearchParams = Promise<{
  cuenta?: string;
  desde?: string;
  hasta?: string;
}>;

function parseIsoDate(value: string | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) {
    return null;
  }
  return new Date(Date.UTC(y, mo - 1, d, 0, 0, 0));
}

function lastDayUtc(value: string | undefined): Date | null {
  const d = parseIsoDate(value);
  if (!d) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}

function todayIso(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function firstDayOfMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export const dynamic = "force-dynamic";

export default async function ExtractoPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;

  const cuentas = await db.cuentaBancaria.findMany({
    orderBy: [{ banco: "asc" }, { moneda: "asc" }],
    select: {
      id: true,
      banco: true,
      moneda: true,
      numero: true,
    },
  });

  // Default: primera cuenta + mes en curso
  const cuentaId = params.cuenta || cuentas[0]?.id || null;
  const desdeStr = params.desde || firstDayOfMonth();
  const hastaStr = params.hasta || todayIso();

  const extracto = cuentaId
    ? await getExtractoBancario({
        cuentaBancariaId: cuentaId,
        desde: parseIsoDate(desdeStr),
        hasta: lastDayUtc(hastaStr),
      })
    : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="text-[15px] font-semibold tracking-tight">
          Extracto bancario
        </h1>
        <p className="text-sm text-muted-foreground">
          Movimientos de una cuenta bancaria con saldo corrido — equivalente
          al extracto del banco. Saldo inicial calculado de los movimientos
          previos al rango. Saldo final = saldo inicial + Σ (débitos −
          créditos) del rango.
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 md:flex-row md:items-end md:gap-4">
          <div className="flex flex-1 flex-col gap-1">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Cuenta bancaria
            </span>
            <CuentaBancariaSelect
              cuentas={cuentas}
              selectedId={cuentaId}
              desde={desdeStr}
              hasta={hastaStr}
            />
          </div>
          <div className="md:flex-shrink-0">
            <DateRangeFilter
              initialDesde={desdeStr}
              initialHasta={hastaStr}
              hoyLabel="Hoy"
            />
          </div>
        </CardContent>
      </Card>

      {!extracto ? (
        <Card>
          <CardContent className="text-sm text-muted-foreground">
            Seleccioná una cuenta bancaria para ver su extracto.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
            <KpiCard
              label="Saldo inicial"
              value={extracto.saldoInicial}
              hint={extracto.desde ? extracto.desde.toISOString().slice(0, 10) : "—"}
            />
            <KpiCard
              label="Total débitos (entradas)"
              value={extracto.totalDebe}
              tone="positive"
            />
            <KpiCard
              label="Total créditos (salidas)"
              value={extracto.totalHaber}
              tone="negative"
            />
            <KpiCard
              label="Saldo final"
              value={extracto.saldoFinal}
              hint={extracto.hasta ? extracto.hasta.toISOString().slice(0, 10) : "—"}
              destacar
            />
          </div>

          <Card className="py-0">
            <CardHeader className="flex flex-row items-center justify-between gap-2 py-3">
              <div className="flex flex-col gap-0.5">
                <CardTitle className="text-[14px]">
                  {extracto.cuentaBancaria.banco} ·{" "}
                  {extracto.cuentaBancaria.numero ?? "—"} ·{" "}
                  {extracto.cuentaBancaria.moneda}
                </CardTitle>
                <CardDescription>
                  {extracto.cuentaBancaria.cuentaContableCodigo}{" "}
                  {extracto.cuentaBancaria.cuentaContableNombre}
                  {extracto.cuentaBancaria.cbu
                    ? ` · CBU ${extracto.cuentaBancaria.cbu}`
                    : null}
                </CardDescription>
              </div>
              <span className="text-[12px] text-muted-foreground">
                {extracto.lineas.length} movimiento
                {extracto.lineas.length === 1 ? "" : "s"}
              </span>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-24">Fecha</TableHead>
                      <TableHead className="w-32">Ref. bancaria</TableHead>
                      <TableHead className="w-32">Factura</TableHead>
                      <TableHead>Proveedor / Contrapartida</TableHead>
                      <TableHead>Descripción</TableHead>
                      <TableHead className="w-32 text-right">
                        Débito (entrada)
                      </TableHead>
                      <TableHead className="w-32 text-right">
                        Crédito (salida)
                      </TableHead>
                      <TableHead className="w-32 text-right">
                        Saldo final
                      </TableHead>
                      <TableHead className="w-16"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {/* Fila de saldo inicial */}
                    <TableRow className="bg-muted/40">
                      <TableCell
                        colSpan={7}
                        className="text-[12px] uppercase tracking-wider text-muted-foreground"
                      >
                        Saldo inicial al{" "}
                        {extracto.desde
                          ? extracto.desde.toISOString().slice(0, 10)
                          : "(inicio)"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[13px] font-semibold tabular-nums">
                        {fmtMoney(extracto.saldoInicial)}
                      </TableCell>
                      <TableCell></TableCell>
                    </TableRow>

                    {extracto.lineas.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={9}
                          className="py-6 text-center text-sm text-muted-foreground"
                        >
                          Sin movimientos en el rango.
                        </TableCell>
                      </TableRow>
                    )}

                    {extracto.lineas.map((l) => {
                      const fecha = new Date(l.fecha);
                      const fechaStr = `${String(fecha.getUTCDate()).padStart(2, "0")}/${String(fecha.getUTCMonth() + 1).padStart(2, "0")}/${fecha.getUTCFullYear()}`;
                      const debeNum = Number(l.debe);
                      const haberNum = Number(l.haber);
                      const saldoNum = Number(l.saldoFinal);
                      return (
                        <TableRow key={`${l.asientoId}-${fechaStr}`}>
                          <TableCell className="font-mono text-[12px] tabular-nums">
                            {fechaStr}
                          </TableCell>
                          <TableCell className="font-mono text-[11px] text-muted-foreground">
                            {l.referenciaBanco ?? "—"}
                          </TableCell>
                          <TableCell className="font-mono text-[11px] text-muted-foreground">
                            {l.factura ?? "—"}
                          </TableCell>
                          <TableCell className="text-[13px]">
                            {l.proveedor ? (
                              <div className="flex flex-col gap-0.5">
                                <span>{l.proveedor}</span>
                                {l.proveedorCodigo && (
                                  <span className="font-mono text-[10px] text-muted-foreground">
                                    {l.proveedorCodigo}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-[12px] text-muted-foreground">
                            <span className="line-clamp-2">
                              {l.descripcion}
                            </span>
                          </TableCell>
                          <TableCell className="text-right font-mono text-[13px] tabular-nums">
                            {debeNum > 0 ? (
                              <span className="text-emerald-700 dark:text-emerald-400">
                                {fmtMoney(l.debe)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono text-[13px] tabular-nums">
                            {haberNum > 0 ? (
                              <span className="text-rose-700 dark:text-rose-400">
                                {fmtMoney(l.haber)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono text-[13px] font-semibold tabular-nums">
                            <span
                              className={
                                saldoNum < 0
                                  ? "text-rose-700 dark:text-rose-400"
                                  : ""
                              }
                            >
                              {saldoNum < 0
                                ? `(${fmtMoney(Math.abs(saldoNum).toFixed(2))})`
                                : fmtMoney(l.saldoFinal)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <Link
                              href={`/contabilidad/asientos/${l.asientoId}`}
                              className="text-[11px] text-primary underline-offset-2 hover:underline"
                              title="Ver asiento contable"
                            >
                              #{l.asientoNumero}
                            </Link>
                          </TableCell>
                        </TableRow>
                      );
                    })}

                    {/* Fila de saldo final */}
                    {extracto.lineas.length > 0 && (
                      <TableRow className="border-t-2 bg-muted/40">
                        <TableCell
                          colSpan={5}
                          className="text-[12px] uppercase tracking-wider text-muted-foreground"
                        >
                          Saldo final al{" "}
                          {extracto.hasta
                            ? extracto.hasta.toISOString().slice(0, 10)
                            : "(hoy)"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-[13px] font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                          {fmtMoney(extracto.totalDebe)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-[13px] font-semibold tabular-nums text-rose-700 dark:text-rose-400">
                          {fmtMoney(extracto.totalHaber)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-[13px] font-bold tabular-nums">
                          {(() => {
                            const v = Number(extracto.saldoFinal);
                            return v < 0
                              ? `(${fmtMoney(Math.abs(v).toFixed(2))})`
                              : fmtMoney(extracto.saldoFinal);
                          })()}
                        </TableCell>
                        <TableCell></TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  hint,
  tone,
  destacar = false,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "positive" | "negative";
  destacar?: boolean;
}) {
  const num = Number(value);
  const cls =
    tone === "positive"
      ? "text-emerald-700 dark:text-emerald-400"
      : tone === "negative"
        ? "text-rose-700 dark:text-rose-400"
        : num < 0
          ? "text-rose-700 dark:text-rose-400"
          : "";
  return (
    <Card
      className={
        destacar
          ? "border-l-4 border-l-primary"
          : ""
      }
    >
      <CardContent className="flex flex-col gap-0.5">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <span className={`font-mono text-[15px] font-semibold tabular-nums ${cls}`}>
          {num < 0
            ? `(${fmtMoney(Math.abs(num).toFixed(2))})`
            : fmtMoney(value)}
        </span>
        {hint && (
          <span className="text-[10px] text-muted-foreground">{hint}</span>
        )}
      </CardContent>
    </Card>
  );
}
