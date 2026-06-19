import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { Alert02Icon, Calendar03Icon, CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";

import {
  getSaldosPorProveedorConAging,
  listarProveedoresParaIntermediario,
} from "@/lib/services/cuentas-a-pagar";
import { listarCuentasBancariasParaMovimiento } from "@/lib/actions/movimientos-tesoreria";
import { getDefaultFecha } from "@/lib/server/fecha-default";
import { auth } from "@/lib/auth";
import { fmtMoney } from "@/lib/format";
import { convertirBucket, sumarBucketsNativos, sumarSaldosNativos } from "@/lib/aging-presentacion";
import { getCotizacionParaFecha } from "@/lib/services/cotizacion";
import { toDecimal } from "@/lib/decimal";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";

import { MonedaToggle, type Moneda } from "../../reportes/_components/moneda-toggle";
import { SaldosBatchPago } from "./saldos-batch-pago";

type SearchParams = Promise<{ filtro?: string; moneda?: string }>;

export const dynamic = "force-dynamic";

export default async function SaldosProveedoresPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const [params, session, cotizacion, todos, cuentasBancarias, intermediarios, defaultFecha] =
    await Promise.all([
      searchParams,
      auth(),
      getCotizacionParaFecha(new Date()),
      getSaldosPorProveedorConAging(),
      listarCuentasBancariasParaMovimiento(),
      listarProveedoresParaIntermediario(),
      getDefaultFecha(),
    ]);

  const { filtro } = params;
  const monedaPreferida: Moneda = session?.user.monedaPreferida === "ARS" ? "ARS" : "USD";
  const moneda: Moneda =
    params.moneda === "ARS" ? "ARS" : params.moneda === "USD" ? "USD" : monedaPreferida;
  const tc = cotizacion ? cotizacion.valor.toString() : null;
  const tcInfo = cotizacion
    ? {
        valor: cotizacion.valor.toString(),
        fecha: cotizacion.fecha.toISOString().slice(0, 10),
        fuente: cotizacion.fuente,
      }
    : null;

  const conVencidas = todos.filter((p) => toDecimal(p.vencido).gt(0));
  const list = filtro === "vencidas" ? conVencidas : todos;

  // KPIs de aging: suma POR MONEDA NATIVA antes de convertir (lección
  // #262/#263), no ÷tc ciego sobre el agregado ARS.
  const buckets = sumarBucketsNativos(
    todos.flatMap((p) =>
      p.facturas.map((f) => ({ bucket: f.bucket, moneda: f.moneda, montoNativo: f.montoNativo })),
    ),
  );
  const totalVencido = fmtMoney(convertirBucket(buckets.vencida, moneda, tc));
  const totalProximo = fmtMoney(convertirBucket(buckets.proxima, moneda, tc));
  const totalAlDia = fmtMoney(convertirBucket(buckets.al_dia, moneda, tc));
  const totalSaldoContable = fmtMoney(
    convertirBucket(
      sumarSaldosNativos(todos.map((p) => ({ saldoArs: p.saldoTotal, saldoUsd: p.saldoTotalUsd }))),
      moneda,
      tc,
    ),
  );

  // Links de filtro preservando la moneda de presentación.
  const qpTodos = new URLSearchParams();
  if (params.moneda) qpTodos.set("moneda", params.moneda);
  const hrefTodos = qpTodos.toString()
    ? `/tesoreria/saldos-proveedores?${qpTodos}`
    : "/tesoreria/saldos-proveedores";
  const qpVenc = new URLSearchParams({ filtro: "vencidas" });
  if (params.moneda) qpVenc.set("moneda", params.moneda);
  const hrefVencidas = `/tesoreria/saldos-proveedores?${qpVenc}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[15px] font-semibold tracking-tight">Saldos por proveedor</h1>
          <p className="text-sm text-muted-foreground">
            {list.length} proveedor{list.length === 1 ? "" : "es"} con saldo pendiente ·
            Vencimientos basados en facturas individuales (Compras y Embarques).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <MonedaToggle current={moneda} tcInfo={tcInfo} />
          <Link
            href={hrefTodos}
            className={buttonVariants({
              variant: filtro === "vencidas" ? "outline" : "default",
              size: "sm",
            })}
          >
            Todos
          </Link>
          <Link
            href={hrefVencidas}
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
          value={`${totalVencido} ${moneda}`}
          tone="danger"
          icon={Alert02Icon}
        />
        <KpiCard
          label="A vencer ≤ 7d"
          value={`${totalProximo} ${moneda}`}
          tone="warning"
          icon={Calendar03Icon}
        />
        <KpiCard
          label="Al día"
          value={`${totalAlDia} ${moneda}`}
          tone="ok"
          icon={CheckmarkCircle02Icon}
        />
        <KpiCard
          label="Saldo contable total"
          value={`${totalSaldoContable} ${moneda}`}
          tone="muted"
        />
      </div>

      <SaldosBatchPago
        proveedores={list}
        intermediarios={intermediarios}
        cuentasBancarias={cuentasBancarias}
        defaultFecha={defaultFecha}
        moneda={moneda}
        tc={tc}
      />
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
          {icon && <HugeiconsIcon icon={icon} strokeWidth={2} className="size-3" />}
          <span>{label}</span>
        </div>
        <span className="font-mono text-xl font-semibold tabular-nums">{value}</span>
      </CardContent>
    </Card>
  );
}
