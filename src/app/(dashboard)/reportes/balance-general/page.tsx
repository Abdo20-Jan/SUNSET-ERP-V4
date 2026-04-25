import { db } from "@/lib/db";
import { getBalanceGeneral } from "@/lib/services/reportes";
import { PeriodoEstado } from "@/generated/prisma/client";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import {
  PeriodoSelect,
  type PeriodoOption,
} from "../_components/periodo-select";
import { fmtMoney } from "../_components/money";
import { CuentaTreeTable } from "../_components/cuenta-tree-table";
import { serializeTreeNode } from "../_components/cuenta-tree-node";

type SearchParams = Promise<{ periodoId?: string }>;

function parsePeriodoId(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export default async function BalanceGeneralPage({
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
  const bg = periodoId ? await getBalanceGeneral(periodoId) : null;

  const periodoOptions: PeriodoOption[] = periodos.map((p) => ({
    id: p.id,
    codigo: p.codigo,
    estado: p.estado,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Balance General
          </h1>
          <p className="text-sm text-muted-foreground">
            {bg
              ? `Período ${bg.periodo.codigo} · ${bg.periodo.nombre}`
              : "Seleccioná un período."}
          </p>
        </div>
        {bg ? (
          bg.cuadra ? (
            <Badge
              variant="default"
              className="bg-emerald-600 text-white hover:bg-emerald-600"
            >
              ✓ Cuadra
            </Badge>
          ) : (
            <Badge variant="destructive">
              ✗ No cuadra — diferencia {fmtMoney(bg.diferencia.toFixed(2))}
            </Badge>
          )
        ) : null}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <PeriodoSelect
          periodos={periodoOptions}
          selectedPeriodoId={periodoId !== null ? String(periodoId) : ""}
        />
      </div>

      {bg ? (
        <>
          <Card className="py-0">
            <CardHeader className="border-b py-4">
              <CardTitle className="text-base">Activo</CardTitle>
            </CardHeader>
            <CuentaTreeTable
              data={bg.activo.map(serializeTreeNode)}
              periodoIdForLibroMayor={bg.periodo.id}
              totalLabel="Total Activo"
              totalValue={bg.totalActivo.toFixed(2)}
            />
          </Card>

          <Card className="py-0">
            <CardHeader className="border-b py-4">
              <CardTitle className="text-base">Pasivo</CardTitle>
            </CardHeader>
            <CuentaTreeTable
              data={bg.pasivo.map(serializeTreeNode)}
              periodoIdForLibroMayor={bg.periodo.id}
              totalLabel="Total Pasivo"
              totalValue={bg.totalPasivo.toFixed(2)}
            />
          </Card>

          <Card className="py-0">
            <CardHeader className="border-b py-4">
              <CardTitle className="text-base">Patrimonio Neto</CardTitle>
            </CardHeader>
            <CuentaTreeTable
              data={bg.patrimonio.map(serializeTreeNode)}
              periodoIdForLibroMayor={bg.periodo.id}
              totalLabel="Total Patrimonio"
              totalValue={bg.totalPatrimonio.toFixed(2)}
            />
          </Card>

          <Card size="sm" className="px-6 py-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <Summary
                label="Total Activo"
                value={fmtMoney(bg.totalActivo.toFixed(2))}
              />
              <Summary
                label="Total Pasivo"
                value={fmtMoney(bg.totalPasivo.toFixed(2))}
              />
              <Summary
                label="Patrimonio Ajustado"
                value={fmtMoney(bg.totalPatrimonioAjustado.toFixed(2))}
                hint={
                  bg.resultadoEjercicio.isZero()
                    ? undefined
                    : `incluye resultado del ejercicio ${fmtMoney(bg.resultadoEjercicio.toFixed(2))}`
                }
              />
              <Summary
                label="Pasivo + Patrimonio"
                value={fmtMoney(
                  bg.totalPasivo.plus(bg.totalPatrimonioAjustado).toFixed(2),
                )}
                emphasis={bg.cuadra ? "positive" : "negative"}
              />
            </div>
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

function Summary({
  label,
  value,
  hint,
  emphasis,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasis?: "positive" | "negative";
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={cn(
          "font-mono text-lg tabular-nums",
          emphasis === "positive" &&
            "text-emerald-700 dark:text-emerald-400",
          emphasis === "negative" && "text-destructive",
        )}
      >
        {value}
      </span>
      {hint ? (
        <span className="text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </div>
  );
}
