import { db } from "@/lib/db";
import { getBalanceSumasYSaldos } from "@/lib/services/balance-sumas-saldos";
import { PeriodoEstado } from "@/generated/prisma/client";
import { Card } from "@/components/ui/card";

import { BalanceFilters, type PeriodoOption } from "./balance-filters";
import { BalanceTreeTable } from "./balance-tree-table";

type SearchParams = Promise<{ periodoId?: string }>;

function parsePeriodoId(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export default async function BalancePage({
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
  const balance = periodoId ? await getBalanceSumasYSaldos(periodoId) : null;

  const periodoOptions: PeriodoOption[] = periodos.map((p) => ({
    id: p.id,
    codigo: p.codigo,
    estado: p.estado,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Balance de Sumas y Saldos
        </h1>
        <p className="text-sm text-muted-foreground">
          {balance
            ? `Período ${balance.periodo.codigo} · ${balance.periodo.nombre}`
            : "Seleccioná un período."}
        </p>
      </div>

      <BalanceFilters
        periodos={periodoOptions}
        selectedPeriodoId={periodoId !== null ? String(periodoId) : ""}
      />

      {balance ? (
        <Card className="py-0">
          <BalanceTreeTable root={balance.root} />
        </Card>
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
