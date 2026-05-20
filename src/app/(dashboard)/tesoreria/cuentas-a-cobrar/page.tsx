import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { Alert02Icon, Calendar03Icon, CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";

import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { DateBadge } from "@/components/ui/date-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtMoney } from "@/lib/format";
import { toDecimal } from "@/lib/decimal";
import {
  getCuentasACobrar,
  getSaldosPorClienteConAging,
  type CxCRow,
  type SaldoClienteAging,
  type VentaPendiente,
} from "@/lib/services/cuentas-a-cobrar";

type SearchParams = Promise<{ filtro?: string }>;

export const dynamic = "force-dynamic";

export default async function CuentasACobrarPage({ searchParams }: { searchParams: SearchParams }) {
  const { filtro } = await searchParams;

  const [data, clientes] = await Promise.all([getCuentasACobrar(), getSaldosPorClienteConAging()]);

  const conVencidas = clientes.filter((c) => toDecimal(c.vencido).gt(0));
  const list = filtro === "vencidas" ? conVencidas : clientes;

  const totalVencido = clientes
    .reduce((acc, c) => acc.plus(toDecimal(c.vencido)), toDecimal(0))
    .toFixed(2);
  const totalProximo = clientes
    .reduce((acc, c) => acc.plus(toDecimal(c.proximo)), toDecimal(0))
    .toFixed(2);
  const totalAlDia = clientes
    .reduce((acc, c) => acc.plus(toDecimal(c.alDia)), toDecimal(0))
    .toFixed(2);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[15px] font-semibold tracking-tight">Cuentas a cobrar</h1>
          <p className="text-sm text-muted-foreground">
            Saldos deudores derivados de los asientos contabilizados. Para registrar un cobro use{" "}
            <Link
              href="/tesoreria/movimientos/nuevo?tipo=COBRO"
              className="underline underline-offset-2"
            >
              Tesorería · Nuevo movimiento
            </Link>
            .
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/tesoreria/cuentas-a-cobrar"
            className={buttonVariants({
              variant: filtro === "vencidas" ? "outline" : "default",
              size: "sm",
            })}
          >
            Todos
          </Link>
          <Link
            href="/tesoreria/cuentas-a-cobrar?filtro=vencidas"
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
          value={`${fmtMoney(data.totalGeneral)} ARS`}
          tone="muted"
        />
      </div>

      <ClientesSection
        list={list}
        emptyMsg={
          filtro === "vencidas"
            ? "Ningún cliente con facturas vencidas."
            : "Sin saldos pendientes a cobrar."
        }
      />

      {data.valoresACobrar.length > 0 && (
        <Section
          title="Valores a cobrar (cheques de terceros)"
          subtitle="Cheques recibidos en cartera pendientes de acreditar en cuenta bancaria (cuenta 1.1.4.20)."
          rows={data.valoresACobrar}
        />
      )}
    </div>
  );
}

// =============================================================
// Sección principal — Clientes con detalle de ventas pendientes
// =============================================================
function ClientesSection({ list, emptyMsg }: { list: SaldoClienteAging[]; emptyMsg: string }) {
  if (list.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Clientes</h2>
          <p className="rounded-lg border border-dashed bg-muted/30 p-4 text-center text-sm text-muted-foreground">
            {emptyMsg}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-semibold">Clientes</h2>
          <p className="text-xs text-muted-foreground">
            {list.length} cliente{list.length === 1 ? "" : "s"} con saldo deudor. Detalle de
            facturas con aging de vencimiento.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          {list.map((c) => (
            <ClienteCard key={c.clienteId} cliente={c} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ClienteCard({ cliente }: { cliente: SaldoClienteAging }) {
  const cobrarHref = (() => {
    const params = new URLSearchParams({
      tipo: "COBRO",
      monto: cliente.saldoTotal,
      descripcion: `Cobro de ${cliente.clienteNombre}`,
    });
    if (cliente.cuentaContableId != null) {
      params.set("cuentaContableId", String(cliente.cuentaContableId));
    }
    return `/tesoreria/movimientos/nuevo?${params.toString()}`;
  })();

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-start justify-between gap-3 border-b p-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{cliente.clienteNombre}</span>
            {cliente.cuentaCodigo && (
              <span className="font-mono text-[11px] text-muted-foreground">
                {cliente.cuentaCodigo}
              </span>
            )}
          </div>
          {cliente.cuit && (
            <span className="text-xs text-muted-foreground">CUIT {cliente.cuit}</span>
          )}
          <div className="mt-1 flex items-center gap-2 text-xs">
            {toDecimal(cliente.vencido).gt(0) && (
              <span className="rounded-full border border-red-300 bg-red-50 px-2 py-0.5 font-medium text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                Vencido: {fmtMoney(cliente.vencido)}
              </span>
            )}
            {toDecimal(cliente.proximo).gt(0) && (
              <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 font-medium text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                ≤ 7d: {fmtMoney(cliente.proximo)}
              </span>
            )}
            {toDecimal(cliente.alDia).gt(0) && (
              <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 font-medium text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                Al día: {fmtMoney(cliente.alDia)}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className="font-mono text-base font-semibold tabular-nums">
            ARS {fmtMoney(cliente.saldoTotal)}
          </span>
          <Link href={cobrarHref} className={buttonVariants({ variant: "default", size: "sm" })}>
            <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} className="size-3.5" />
            Cobrar
          </Link>
        </div>
      </div>

      {cliente.ventas.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-44">Venta</TableHead>
              <TableHead className="w-32">Fecha</TableHead>
              <TableHead className="w-32">Vencimiento</TableHead>
              <TableHead className="w-20">Estado</TableHead>
              <TableHead className="text-right">Pendiente</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cliente.ventas.map((v) => (
              <VentaRow key={v.id} venta={v} />
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function VentaRow({ venta }: { venta: VentaPendiente }) {
  const fechaVenc = venta.fechaVencimiento ? new Date(venta.fechaVencimiento) : null;
  const fecha = new Date(venta.fecha);

  const bucketLabel: Record<VentaPendiente["bucket"], string> = {
    vencida: "Vencida",
    proxima: "Próxima",
    al_dia: "Al día",
    sin_fecha: "—",
  };

  const bucketClass: Record<VentaPendiente["bucket"], string> = {
    vencida:
      "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200",
    proxima:
      "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
    al_dia:
      "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
    sin_fecha: "border-muted bg-muted/50 text-muted-foreground",
  };

  return (
    <TableRow>
      <TableCell className="font-mono text-xs">
        <Link
          href={`/ventas/${venta.id}`}
          className="underline underline-offset-2 hover:text-foreground"
        >
          {venta.numero}
        </Link>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {fecha.toLocaleDateString("es-AR", { timeZone: "UTC" })}
      </TableCell>
      <TableCell>
        <DateBadge fecha={fechaVenc} />
      </TableCell>
      <TableCell>
        <span
          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${bucketClass[venta.bucket]}`}
        >
          {bucketLabel[venta.bucket]}
        </span>
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums">
        ARS {fmtMoney(venta.monto)}
      </TableCell>
    </TableRow>
  );
}

// =============================================================
// Sección genérica — Valores a cobrar (cheques en cartera)
// =============================================================
function Section({ title, subtitle, rows }: { title: string; subtitle: string; rows: CxCRow[] }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-32">Cuenta</TableHead>
              <TableHead>Nombre</TableHead>
              <TableHead className="text-right">Saldo (ARS)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.cuentaId}>
                <TableCell className="font-mono text-xs">{r.cuentaCodigo}</TableCell>
                <TableCell>{r.cuentaNombre}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {fmtMoney(r.saldo)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
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
          {icon && <HugeiconsIcon icon={icon} strokeWidth={2} className="size-3" />}
          <span>{label}</span>
        </div>
        <span className="font-mono text-xl font-semibold tabular-nums">{value}</span>
      </CardContent>
    </Card>
  );
}
