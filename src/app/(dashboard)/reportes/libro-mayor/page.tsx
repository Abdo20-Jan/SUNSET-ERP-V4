import Link from "next/link";
import { format } from "date-fns";

import { db } from "@/lib/db";
import { getLibroMayor, LibroMayorError } from "@/lib/services/reportes";
import { PeriodoEstado } from "@/generated/prisma/client";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
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
import { MayorFilters, type PeriodoOption } from "./mayor-filters";

type SearchParams = Promise<{ periodoId?: string; cuentaId?: string }>;

function parseId(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export default async function LibroMayorPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;

  const [periodos, cuentas] = await Promise.all([
    db.periodoContable.findMany({
      orderBy: { codigo: "desc" },
      select: {
        id: true,
        codigo: true,
        estado: true,
        fechaInicio: true,
        fechaFin: true,
      },
    }),
    db.cuentaContable.findMany({
      where: { tipo: "ANALITICA", activa: true },
      orderBy: { codigo: "asc" },
      select: { id: true, codigo: true, nombre: true },
    }),
  ]);

  const now = new Date();
  const periodoIdFromUrl = parseId(params.periodoId);
  const cuentaId = parseId(params.cuentaId);

  const defaultPeriodo =
    periodos.find(
      (p) =>
        p.estado === PeriodoEstado.ABIERTO &&
        p.fechaInicio <= now &&
        p.fechaFin >= now,
    ) ??
    periodos.find((p) => p.estado === PeriodoEstado.ABIERTO) ??
    periodos[0] ??
    null;

  const periodoId = periodoIdFromUrl ?? defaultPeriodo?.id ?? null;

  let mayor: Awaited<ReturnType<typeof getLibroMayor>> | null = null;
  let errorMessage: string | null = null;
  if (cuentaId != null && periodoId != null) {
    try {
      mayor = await getLibroMayor(cuentaId, periodoId);
    } catch (e) {
      if (e instanceof LibroMayorError) errorMessage = e.message;
      else throw e;
    }
  }

  const periodoOptions: PeriodoOption[] = periodos.map((p) => ({
    id: p.id,
    codigo: p.codigo,
    estado: p.estado,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Libro Mayor</h1>
        <p className="text-sm text-muted-foreground">
          Movimientos por cuenta analítica con saldo acumulado.
        </p>
      </div>

      <MayorFilters
        periodos={periodoOptions}
        cuentas={cuentas}
        selectedPeriodoId={periodoId !== null ? String(periodoId) : ""}
        selectedCuentaId={cuentaId}
      />

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
              Período {mayor.periodo.codigo}
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
              {mayor.lineas.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-12 text-center text-sm text-muted-foreground"
                  >
                    Sin movimientos en esta cuenta para el período.
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
                      {fmtMoney(l.debe.toFixed(2))}
                    </TableCell>
                    <TableCell className="py-2 text-right font-mono text-xs tabular-nums">
                      {fmtMoney(l.haber.toFixed(2))}
                    </TableCell>
                    <TableCell className="py-2 text-right font-mono text-xs tabular-nums">
                      {fmtMoney(l.saldoAcumulado.toFixed(2))}
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
                    {fmtMoney(mayor.totalDebe.toFixed(2))}
                  </TableCell>
                  <TableCell className="py-3 text-right font-mono text-sm tabular-nums">
                    {fmtMoney(mayor.totalHaber.toFixed(2))}
                  </TableCell>
                  <TableCell className="py-3 text-right font-mono text-sm font-bold tabular-nums">
                    {fmtMoney(mayor.saldoFinal.toFixed(2))}
                  </TableCell>
                </TableRow>
              </TableFooter>
            ) : null}
          </Table>
        </Card>
      ) : (
        <Card className="py-12">
          <p className="text-center text-sm text-muted-foreground">
            Seleccioná una cuenta analítica y un período.
          </p>
        </Card>
      )}
    </div>
  );
}
