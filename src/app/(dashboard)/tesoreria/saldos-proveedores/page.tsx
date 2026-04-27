import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Alert02Icon,
  ArrowRight02Icon,
  Calendar03Icon,
  CheckmarkCircle02Icon,
} from "@hugeicons/core-free-icons";

import { getSaldosPorProveedorConAging } from "@/lib/services/cuentas-a-pagar";
import { fmtMoney } from "@/lib/format";
import { toDecimal } from "@/lib/decimal";
import { Card, CardContent } from "@/components/ui/card";
import { DateBadge } from "@/components/ui/date-badge";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type SearchParams = Promise<{ filtro?: string }>;

export default async function SaldosProveedoresPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { filtro } = await searchParams;
  const todos = await getSaldosPorProveedorConAging();

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
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
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

      <Card className="py-0">
        <Table>
          <caption className="sr-only">
            Saldos por proveedor con desglose de vencimientos
          </caption>
          <TableHeader>
            <TableRow>
              <TableHead>Proveedor</TableHead>
              <TableHead className="text-right">Vencido</TableHead>
              <TableHead className="text-right">A vencer 7d</TableHead>
              <TableHead className="text-right">Al día</TableHead>
              <TableHead className="text-right">Saldo contable</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center text-sm text-muted-foreground">
                  Sin saldos pendientes para los filtros seleccionados.
                </TableCell>
              </TableRow>
            ) : (
              list.map((p) => (
                <ProveedorRow key={p.proveedorId} p={p} />
              ))
            )}
          </TableBody>
        </Table>
      </Card>
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

function ProveedorRow({
  p,
}: {
  p: Awaited<ReturnType<typeof getSaldosPorProveedorConAging>>[number];
}) {
  const tieneVencidas = toDecimal(p.vencido).gt(0);
  const tieneProximas = toDecimal(p.proximo).gt(0);

  return (
    <>
      <TableRow className={tieneVencidas ? "bg-red-50/40 dark:bg-red-950/10" : undefined}>
        <TableCell>
          <div className="flex flex-col">
            <span className="font-medium">{p.proveedorNombre}</span>
            <span className="font-mono text-xs text-muted-foreground">
              {p.cuit} · {p.pais}
            </span>
          </div>
        </TableCell>
        <TableCell className="text-right font-mono tabular-nums">
          {tieneVencidas ? (
            <span className="font-semibold text-red-700 dark:text-red-300">
              {fmtMoney(p.vencido)}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </TableCell>
        <TableCell className="text-right font-mono tabular-nums">
          {tieneProximas ? (
            <span className="text-amber-700 dark:text-amber-300">
              {fmtMoney(p.proximo)}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </TableCell>
        <TableCell className="text-right font-mono tabular-nums">
          {toDecimal(p.alDia).gt(0) ? (
            fmtMoney(p.alDia)
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </TableCell>
        <TableCell className="text-right font-mono tabular-nums">
          {fmtMoney(p.saldoTotal)}
        </TableCell>
        <TableCell className="text-right">
          <Link
            href={
              p.cuentaContableId
                ? `/tesoreria/movimientos/nuevo?${new URLSearchParams({
                    tipo: "PAGO",
                    cuentaContableId: String(p.cuentaContableId),
                    monto: p.saldoTotal,
                    descripcion: `Pago a ${p.proveedorNombre}${p.facturas.length > 0 ? ` — ${p.facturas.length} factura(s)` : ""}`,
                  }).toString()}`
                : `/tesoreria/movimientos/nuevo?tipo=PAGO`
            }
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Pagar
            <HugeiconsIcon icon={ArrowRight02Icon} strokeWidth={2} />
          </Link>
        </TableCell>
      </TableRow>
      {p.facturas.length > 0 && (
        <TableRow>
          <TableCell colSpan={6} className="bg-muted/20 py-2">
            <div className="flex flex-wrap gap-2 px-2">
              {p.facturas.slice(0, 8).map((f) => (
                <span
                  key={`${f.origen}-${f.id}`}
                  className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs"
                >
                  <Badge
                    variant="outline"
                    className="text-[10px] uppercase tracking-wide"
                  >
                    {f.origen === "compra" ? "C" : "EMB"}
                  </Badge>
                  <span className="font-mono">{f.numero}</span>
                  <span className="font-mono text-muted-foreground tabular-nums">
                    {fmtMoney(f.monto)}
                  </span>
                  <DateBadge fecha={f.fechaVencimiento} relative />
                </span>
              ))}
              {p.facturas.length > 8 && (
                <span className="text-xs text-muted-foreground">
                  +{p.facturas.length - 8} más
                </span>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
