import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Alert02Icon,
  ArrowRight02Icon,
  Calendar03Icon,
  CheckmarkCircle02Icon,
} from "@hugeicons/core-free-icons";

import { getSaldosPorProveedorConAging } from "@/lib/services/cuentas-a-pagar";
import { listarCuentasBancariasParaMovimiento } from "@/lib/actions/movimientos-tesoreria";
import { fmtMoney } from "@/lib/format";
import { toDecimal } from "@/lib/decimal";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";

import { SaldosBatchPago } from "./saldos-batch-pago";

type SearchParams = Promise<{ filtro?: string }>;

export default async function SaldosProveedoresPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { filtro } = await searchParams;
  const [todos, cuentasBancarias] = await Promise.all([
    getSaldosPorProveedorConAging(),
    listarCuentasBancariasParaMovimiento(),
  ]);

  const conVencidas = todos.filter((p) => toDecimal(p.vencido).gt(0));
  const list = filtro === "vencidas" ? conVencidas : todos;

  const totalVencido = todos
    .reduce((acc, p) => acc.plus(toDecimal(p.vencido)), toDecimal(0))
    .toFixed(2);
  const totalProximo = todos
    .reduce((acc, p) => acc.plus(toDecimal(p.proximo)), toDecimal(0))
    .toFixed(2);
  const totalAlDia = todos
    .reduce((acc, p) => acc.plus(toDecimal(p.alDia)), toDecimal(0))
    .toFixed(2);
  const totalSaldoContable = todos
    .reduce((acc, p) => acc.plus(toDecimal(p.saldoTotal)), toDecimal(0))
    .toFixed(2);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[15px] font-semibold tracking-tight">
            Saldos por proveedor
          </h1>
          <p className="text-sm text-muted-foreground">
            {list.length} proveedor{list.length === 1 ? "" : "es"} con saldo
            pendiente · Vencimientos basados en facturas individuales (Compras y
            Embarques).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/tesoreria/saldos-proveedores"
            className={buttonVariants({
              variant: filtro === "vencidas" ? "outline" : "default",
              size: "sm",
            })}
          >
            Todos
          </Link>
          <Link
            href="/tesoreria/saldos-proveedores?filtro=vencidas"
            className={buttonVariants({
              variant: filtro === "vencidas" ? "default" : "outline",
              size: "sm",
            })}
          >
            Solo con vencidas
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <KpiCard
          label="Total vencido"
          value={`${fmtMoney(totalVencido)} ARS`}
          tone="danger"
          icon={Alert02Icon}
        />
        <KpiCard
          label="A vencer ≤ 7d"
          value={`${fmtMoney(totalProximo)} ARS`}
          tone="warning"
          icon={Calendar03Icon}
        />
        <KpiCard
          label="Al día"
          value={`${fmtMoney(totalAlDia)} ARS`}
          tone="ok"
          icon={CheckmarkCircle02Icon}
        />
        <KpiCard
          label="Saldo contable total"
          value={`${fmtMoney(totalSaldoContable)} ARS`}
          tone="muted"
        />
      </div>

      <SaldosBatchPago proveedores={list} cuentasBancarias={cuentasBancarias} />
    </div>
  );
}

function KpiCard({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: string;
  tone: "danger" | "warning" | "ok" | "muted";
  icon?: typeof Alert02Icon;
}) {
  const toneClass = {
    danger:
      "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200",
    warning:
      "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200",
    ok: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200",
    muted: "",
  }[tone];

  return (
    <Card className={tone === "muted" ? undefined : toneClass}>
      <CardContent className="flex flex-col gap-1">
        <div className="flex items-center gap-1 text-xs uppercase tracking-wide text-muted-foreground">
          {icon && (
            <HugeiconsIcon icon={icon} strokeWidth={2} className="size-3" />
          )}
          <span>{label}</span>
        </div>
        <span className="font-mono text-xl font-semibold tabular-nums">
          {value}
        </span>
      </CardContent>
    </Card>
  );
}

