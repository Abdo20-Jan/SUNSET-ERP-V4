import { getBalanceGeneralByFecha } from "@/lib/services/reportes";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { fmtMoney } from "../_components/money";
import { CuentaTreeTable } from "../_components/cuenta-tree-table";
import { serializeTreeNode } from "../_components/cuenta-tree-node";

import { BalanceFechaFilter } from "./balance-fecha-filter";

type SearchParams = Promise<{ desde?: string; hasta?: string }>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

export default async function BalanceGeneralPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;

  // Default: hasta = hoy, desde = vacío (saldo acumulado al día)
  const hastaStr = params.hasta ?? todayIso();
  const desdeStr = params.desde ?? "";

  const fechaDesde = parseDate(desdeStr);
  const fechaHasta = endOfDay(hastaStr);

  const bg = await getBalanceGeneralByFecha({ fechaDesde, fechaHasta });

  const titulo =
    bg.contexto.tipo === "fecha"
      ? bg.contexto.fechaDesde && bg.contexto.fechaHasta
        ? `Del ${bg.contexto.fechaDesde.toISOString().slice(0, 10)} al ${bg.contexto.fechaHasta.toISOString().slice(0, 10)}`
        : bg.contexto.fechaHasta
          ? `Saldo al ${bg.contexto.fechaHasta.toISOString().slice(0, 10)}`
          : "Histórico completo"
      : "";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Balance General
          </h1>
          <p className="text-sm text-muted-foreground">{titulo}</p>
        </div>
        {bg.cuadra ? (
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
        )}
      </div>

      <BalanceFechaFilter
        initialDesde={desdeStr}
        initialHasta={hastaStr}
      />

      <Card className="py-0">
        <CardHeader className="border-b py-4">
          <CardTitle className="text-base">Activo</CardTitle>
        </CardHeader>
        <CuentaTreeTable
          data={bg.activo.map(serializeTreeNode)}
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
