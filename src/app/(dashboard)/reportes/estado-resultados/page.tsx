import { db } from "@/lib/db";
import { getEstadoResultados } from "@/lib/services/reportes";
import { PeriodoEstado } from "@/generated/prisma/client";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import {
  PeriodoSelect,
  type PeriodoOption,
} from "../_components/periodo-select";
import { fmtMoney, fmtSigno } from "../_components/money";
import { CuentaTreeTable } from "../_components/cuenta-tree-table";
import { serializeTreeNode } from "../_components/cuenta-tree-node";

type SearchParams = Promise<{ periodoId?: string }>;

function parsePeriodoId(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export default async function EstadoResultadosPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;

  const periodos = await db.periodoContable.findMany({
    orderBy: { codigo: "desc" },
    select: {
      id: true,
      codigo: true,
      estado: true,
      fechaInicio: true,
      fechaFin: true,
    },
  });

  const now = new Date();
  const periodoIdFromUrl = parsePeriodoId(params.periodoId);
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
  const er = periodoId ? await getEstadoResultados(periodoId) : null;

  const periodoOptions: PeriodoOption[] = periodos.map((p) => ({
    id: p.id,
    codigo: p.codigo,
    estado: p.estado,
  }));

  const resultadoStr = er?.resultado.toFixed(2) ?? "0.00";
  const signo = fmtSigno(resultadoStr);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Estado de Resultados
        </h1>
        <p className="text-sm text-muted-foreground">
          {er
            ? `Período ${er.periodo.codigo} · ${er.periodo.nombre}`
            : "Seleccioná un período."}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <PeriodoSelect
          periodos={periodoOptions}
          selectedPeriodoId={periodoId !== null ? String(periodoId) : ""}
        />
      </div>

      {er ? (
        <>
          <Card className="py-0">
            <CardHeader className="border-b py-4">
              <CardTitle className="text-base">Ingresos</CardTitle>
            </CardHeader>
            <CuentaTreeTable
              data={er.ingresos.map(serializeTreeNode)}
              periodoIdForLibroMayor={er.periodo.id}
              totalLabel="Total Ingresos"
              totalValue={er.totalIngresos.toFixed(2)}
            />
          </Card>

          <Card className="py-0">
            <CardHeader className="border-b py-4">
              <CardTitle className="text-base">Egresos</CardTitle>
            </CardHeader>
            <CuentaTreeTable
              data={er.egresos.map(serializeTreeNode)}
              periodoIdForLibroMayor={er.periodo.id}
              totalLabel="Total Egresos"
              totalValue={er.totalEgresos.toFixed(2)}
            />
          </Card>

          <Card className="flex-row items-center gap-6 px-6 py-6">
            <div className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                Resultado del Período
              </span>
              <span className="text-xs text-muted-foreground">
                Ingresos − Egresos
              </span>
            </div>
            <span
              className={cn(
                "ml-auto font-mono text-3xl font-bold tabular-nums",
                signo === "positive" &&
                  "text-emerald-700 dark:text-emerald-400",
                signo === "negative" && "text-destructive",
                signo === "zero" && "text-muted-foreground",
              )}
            >
              {fmtMoney(resultadoStr)}
            </span>
          </Card>
        </>
      ) : (
        <Card className="py-12">
          <p className="text-center text-sm text-muted-foreground">
            No hay períodos contables disponibles.
          </p>
        </Card>
      )}
    </div>
  );
}
