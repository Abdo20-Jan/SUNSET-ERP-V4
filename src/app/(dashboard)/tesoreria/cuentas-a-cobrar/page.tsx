import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { Alert02Icon, Calendar03Icon, CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";

import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { auth } from "@/lib/auth";
import { fmtMoney, fmtMontoPres, pickSaldoNativo } from "@/lib/format";
import { toDecimal } from "@/lib/decimal";
import { convertirBucket, sumarBucketsNativos, sumarSaldosNativos } from "@/lib/aging-presentacion";
import { puedeVerSaldo } from "@/lib/permisos-masking";
import { getCotizacionParaFecha } from "@/lib/services/cotizacion";
import { listarCuentasACobrarWorklist } from "@/lib/services/cuentas-a-cobrar-worklist";
import type { CxCRow } from "@/lib/services/cuentas-a-cobrar";

import { CuentasACobrarWorklist } from "./cuentas-a-cobrar-worklist";
import { MonedaToggle, type Moneda } from "../../reportes/_components/moneda-toggle";

type SearchParams = Promise<{ filtro?: string; moneda?: string }>;

export const dynamic = "force-dynamic";

export default async function CuentasACobrarPage({ searchParams }: { searchParams: SearchParams }) {
  // Gate VER_SALDO (TES-03 · PR-025c, espejo de saldos-proveedores/PR-025b):
  // TODA la página son agregados de saldo (aging por cliente, KPIs, ventas
  // pendientes, valores a cobrar) → sin permiso se omite la superficie entera
  // ANTES de cualquier fetch (el motor de aging ni se invoca; nada monetario
  // entra al payload RSC). Aviso server-rendered — NO usar el PermissionGate
  // client como control (serializaría los datos igual).
  const verSaldo = await puedeVerSaldo();
  if (!verSaldo) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-[15px] font-semibold tracking-tight">Cuentas a cobrar</h1>
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 px-4 text-center">
          <p className="text-sm font-medium text-foreground">Acceso restringido</p>
          <p className="max-w-md text-xs text-muted-foreground">
            Necesitás el permiso de saldos de tesorería (tesoreria.verSaldo) para ver las cuentas a
            cobrar.
          </p>
        </div>
      </div>
    );
  }

  const [params, session, cotizacion, worklistData] = await Promise.all([
    searchParams,
    auth(),
    getCotizacionParaFecha(new Date()),
    listarCuentasACobrarWorklist(verSaldo),
  ]);
  const data = worklistData?.cuentas ?? { clientes: [], valoresACobrar: [], totalGeneral: "0.00" };
  const clientes = worklistData?.clientes ?? [];

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

  const conVencidas = clientes.filter((c) => toDecimal(c.vencido).gt(0));
  const list = filtro === "vencidas" ? conVencidas : clientes;

  // KPIs de aging: suma POR MONEDA NATIVA antes de convertir (lección
  // #262/#263), no ÷tc ciego sobre el agregado ARS.
  const buckets = sumarBucketsNativos(
    clientes.flatMap((c) =>
      c.ventas.map((v) => ({ bucket: v.bucket, moneda: v.moneda, montoNativo: v.montoNativo })),
    ),
  );
  const totalVencido = fmtMoney(convertirBucket(buckets.vencida, moneda, tc));
  const totalProximo = fmtMoney(convertirBucket(buckets.proxima, moneda, tc));
  const totalAlDia = fmtMoney(convertirBucket(buckets.al_dia, moneda, tc));
  // Saldo contable total: cada cuenta en su moneda nativa (pickSaldoNativo
  // agregado) → convertido por separado.
  const totalContable = fmtMoney(
    convertirBucket(
      sumarSaldosNativos(
        [...data.clientes, ...data.valoresACobrar].map((r) => ({
          saldoArs: r.saldo,
          saldoUsd: r.saldoUsd,
        })),
      ),
      moneda,
      tc,
    ),
  );

  // Links de filtro preservando la moneda de presentación.
  const qpTodos = new URLSearchParams();
  if (params.moneda) qpTodos.set("moneda", params.moneda);
  const hrefTodos = qpTodos.toString()
    ? `/tesoreria/cuentas-a-cobrar?${qpTodos}`
    : "/tesoreria/cuentas-a-cobrar";
  const qpVenc = new URLSearchParams({ filtro: "vencidas" });
  if (params.moneda) qpVenc.set("moneda", params.moneda);
  const hrefVencidas = `/tesoreria/cuentas-a-cobrar?${qpVenc}`;

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
        <KpiCard label="Saldo contable total" value={`${totalContable} ${moneda}`} tone="muted" />
      </div>

      <CuentasACobrarWorklist
        clientes={list}
        moneda={moneda}
        tc={tc}
        emptyMessage={
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
          moneda={moneda}
          tc={tc}
        />
      )}
    </div>
  );
}

// =============================================================
// Sección genérica — Valores a cobrar (cheques en cartera)
// =============================================================
function Section({
  title,
  subtitle,
  rows,
  moneda,
  tc,
}: {
  title: string;
  subtitle: string;
  rows: CxCRow[];
  moneda: Moneda;
  tc: string | null;
}) {
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
              <TableHead className="text-right">Saldo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const pick = pickSaldoNativo(r.saldo, r.saldoUsd);
              return (
                <TableRow key={r.cuentaId}>
                  <TableCell className="font-mono text-xs">{r.cuentaCodigo}</TableCell>
                  <TableCell>{r.cuentaNombre}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {fmtMontoPres(pick.valor, pick.monedaNativa, moneda, tc)} {moneda}
                  </TableCell>
                </TableRow>
              );
            })}
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
