"use client";

/**
 * Libro Mayor embebido de una cuenta analítica (CONT-02 · PR-028, Q&A
 * estructural 6): FloatingWorkWindow read-only abierta al click en la
 * analítica del árbol. Display modelado en /reportes/libro-mayor (ARS-only
 * v1) — la data sale del wrapper CALL-only `getLibroMayorDetalle` (que llama
 * `getLibroMayor` intocado + docs de origen batch + historial AuditLog).
 * Filtro de período interno (default: 1º del mes → hoy, mismos defaults del
 * reporte). Cap 500 líneas con aviso honesto + link al reporte completo.
 * Sección Historial (Q&A 7): sin CRUD de cuenta hoy → empty-state honesto.
 */

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { getLibroMayorDetalle, type LibroMayorDetalle } from "@/lib/actions/libro-mayor-detalle";
import { fmtMoney } from "@/lib/format";
import { AuditTrail } from "@/components/ui/audit-trail";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FloatingWorkWindow } from "@/components/record/floating-work-window";

export type CuentaLibroMayorTarget = {
  id: number;
  codigo: string;
  nombre: string;
};

type Props = {
  cuenta: CuentaLibroMayorTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function firstOfMonthIso(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
}

// Los valores de los inputs de fecha se URL-encodean (URLSearchParams) antes
// de entrar al href (CodeQL js/xss-through-dom — texto del DOM jamás crudo).
function buildReporteHref(
  cuenta: CuentaLibroMayorTarget | null,
  desde: string,
  hasta: string,
): string {
  if (!cuenta) return "/reportes/libro-mayor";
  const qs = new URLSearchParams({ cuentaId: String(cuenta.id), desde, hasta });
  return `/reportes/libro-mayor?${qs.toString()}`;
}

export function CuentaLibroMayorWindow({ cuenta, open, onOpenChange }: Props) {
  const [detalle, setDetalle] = useState<LibroMayorDetalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [desde, setDesde] = useState(firstOfMonthIso());
  const [hasta, setHasta] = useState(todayIso());
  const [isFetching, startTransition] = useTransition();

  const cuentaId = cuenta?.id ?? null;

  const fetchDetalle = (id: number, rango: { desde: string; hasta: string }) => {
    startTransition(async () => {
      const result = await getLibroMayorDetalle({ cuentaId: id, ...rango });
      if (result.ok) {
        setDetalle(result.detalle);
        setError(null);
      } else {
        setDetalle(null);
        setError(result.error);
      }
    });
  };

  useEffect(() => {
    if (!open || cuentaId === null) {
      return;
    }
    const rangoInicial = { desde: firstOfMonthIso(), hasta: todayIso() };
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset state antes de fetch dependente de prop
    setDetalle(null);
    setError(null);
    setDesde(rangoInicial.desde);
    setHasta(rangoInicial.hasta);
    fetchDetalle(cuentaId, rangoInicial);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchDetalle es estable (transition wrapper)
  }, [open, cuentaId]);

  const onAplicar = () => {
    if (cuentaId === null) return;
    if (!desde || !hasta) {
      toast.error("Elegí un rango de fechas válido.");
      return;
    }
    fetchDetalle(cuentaId, { desde, hasta });
  };

  const reporteHref = buildReporteHref(cuenta, desde, hasta);

  return (
    <FloatingWorkWindow
      open={open}
      onOpenChange={onOpenChange}
      title={
        <span className="flex items-center gap-3">
          <span className="font-mono">{cuenta?.codigo ?? ""}</span>
          <span>{cuenta?.nombre ?? "Libro Mayor"}</span>
          {detalle && <Badge variant="secondary">{detalle.cuenta.categoria}</Badge>}
          {detalle?.saldoUsdFinal && (
            <Badge variant="outline" className="font-mono">
              Saldo USD nativo: US$ {fmtMoney(detalle.saldoUsdFinal)}
            </Badge>
          )}
        </span>
      }
      description="Movimientos de la cuenta con saldo acumulado (Libro Mayor embebido, sólo lectura)."
      initialWidth={920}
      initialHeight={600}
    >
      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lm-desde" className="text-xs text-muted-foreground">
              Desde
            </Label>
            <Input
              id="lm-desde"
              type="date"
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
              className="w-40"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lm-hasta" className="text-xs text-muted-foreground">
              Hasta
            </Label>
            <Input
              id="lm-hasta"
              type="date"
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
              className="w-40"
            />
          </div>
          <Button variant="outline" size="sm" onClick={onAplicar} disabled={isFetching}>
            {isFetching ? "Cargando…" : "Aplicar"}
          </Button>
          <Link
            href={reporteHref}
            className="ml-auto text-xs text-primary underline-offset-2 hover:underline"
          >
            Abrir en Libro Mayor →
          </Link>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {!detalle && !error && <Skeleton className="h-64" />}

        {detalle && (
          <>
            {detalle.truncado && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Mostrando las primeras {detalle.lineas.length} líneas de {detalle.totalLineas} —
                abrí el reporte completo para ver el resto.
              </p>
            )}

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">Fecha</TableHead>
                    <TableHead className="w-28">Asiento</TableHead>
                    <TableHead>Descripción</TableHead>
                    <TableHead className="w-32 text-right">Debe</TableHead>
                    <TableHead className="w-32 text-right">Haber</TableHead>
                    <TableHead className="w-36 text-right">Saldo Acumulado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Number.parseFloat(detalle.saldoInicial) !== 0 && (
                    <TableRow className="bg-muted/30">
                      <TableCell colSpan={5} className="py-2 text-xs italic text-muted-foreground">
                        Saldo inicial al {detalle.rango.desde ?? "inicio"}
                      </TableCell>
                      <TableCell className="py-2 text-right font-mono text-xs tabular-nums">
                        {fmtMoney(detalle.saldoInicial)}
                      </TableCell>
                    </TableRow>
                  )}
                  {detalle.lineas.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="py-12 text-center text-sm text-muted-foreground"
                      >
                        Sin movimientos en esta cuenta para el rango.
                      </TableCell>
                    </TableRow>
                  ) : (
                    detalle.lineas.map((l) => (
                      <TableRow key={l.lineaId}>
                        <TableCell className="py-2 font-mono text-xs">{l.fecha}</TableCell>
                        <TableCell className="py-2">
                          <Link
                            href={`/contabilidad/asientos/${l.asientoId}`}
                            className="font-mono text-xs text-primary underline-offset-2 hover:underline"
                          >
                            #{l.asientoNumero}
                          </Link>
                          {l.doc && (
                            <Link
                              href={l.doc.href}
                              className="block text-[11px] text-muted-foreground underline-offset-2 hover:underline"
                            >
                              {l.doc.etiqueta}
                            </Link>
                          )}
                        </TableCell>
                        <TableCell className="py-2 text-xs">
                          <span className="block">{l.asientoDescripcion}</span>
                          {l.descripcion && (
                            <span className="block text-muted-foreground">{l.descripcion}</span>
                          )}
                        </TableCell>
                        <TableCell className="py-2 text-right font-mono text-xs tabular-nums">
                          {fmtMoney(l.debe)}
                        </TableCell>
                        <TableCell className="py-2 text-right font-mono text-xs tabular-nums">
                          {fmtMoney(l.haber)}
                        </TableCell>
                        <TableCell className="py-2 text-right font-mono text-xs tabular-nums">
                          {fmtMoney(l.saldoAcumulado)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
                {detalle.lineas.length > 0 && (
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={3} className="py-3 font-semibold">
                        Totales
                      </TableCell>
                      <TableCell className="py-3 text-right font-mono text-sm tabular-nums">
                        {fmtMoney(detalle.totalDebe)}
                      </TableCell>
                      <TableCell className="py-3 text-right font-mono text-sm tabular-nums">
                        {fmtMoney(detalle.totalHaber)}
                      </TableCell>
                      <TableCell className="py-3 text-right font-mono text-sm font-bold tabular-nums">
                        {fmtMoney(detalle.saldoFinal)}
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                )}
              </Table>
            </div>

            <details className="rounded-md border border-border px-3 py-2">
              <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Historial de la cuenta ({detalle.historial.length})
              </summary>
              <div className="pt-3">
                {detalle.historial.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Sin cambios registrados — el plan de cuentas es catálogo/seed (sin CRUD de
                    cuentas por UI).
                  </p>
                ) : (
                  <AuditTrail entries={detalle.historial} />
                )}
              </div>
            </details>
          </>
        )}
      </div>
    </FloatingWorkWindow>
  );
}
