import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { Alert02Icon, Calendar03Icon, CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";

import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { auth } from "@/lib/auth";
import { fmtMoney } from "@/lib/format";
import { convertirBucket, sumarBucketsNativos, sumarSaldosNativos } from "@/lib/aging-presentacion";
import { puedeVerSaldo } from "@/lib/permisos-masking";
import { getCotizacionParaFecha } from "@/lib/services/cotizacion";
import { listarSaldosProveedoresWorklist } from "@/lib/services/saldos-proveedores-worklist";

import {
  filtrarPorVista,
  type FinVista,
  flattenFacturasPendientes,
  ordenarPorUrgencia,
  resolverVista,
} from "./fin-cxp-presentacion";
import { FinCxpWorklist } from "./fin-cxp-worklist";
import { MonedaToggle, type Moneda } from "../../reportes/_components/moneda-toggle";

type SearchParams = Promise<{ vista?: string; moneda?: string }>;

export const dynamic = "force-dynamic";

const BASE_HREF = "/finanzas/cuentas-a-pagar";

const VISTAS: Array<{ id: FinVista; label: string }> = [
  { id: "todas", label: "Todas" },
  { id: "hoy", label: "Hoy" },
  { id: "prox7", label: "Próx. 7 días" },
  { id: "vencidas", label: "Vencidas" },
];

function vistaHref(vista: FinVista, moneda: string | undefined): string {
  const qp = new URLSearchParams();
  if (vista !== "todas") qp.set("vista", vista);
  if (moneda) qp.set("moneda", moneda);
  const qs = qp.toString();
  return qs ? `${BASE_HREF}?${qs}` : BASE_HREF;
}

export default async function FinCuentasAPagarPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  // Gate VER_SALDO (FIN-02 · PR-026, espejo página-entera de 025b/025c):
  // TODA la página son agregados de saldo (documentos pendientes del motor de
  // aging, KPIs) → sin permiso se omite la superficie entera ANTES de
  // cualquier fetch (el motor ni se invoca; nada monetario entra al payload
  // RSC). Aviso server-rendered — NO usar el PermissionGate client como
  // control. Nota: esta página NUEVA no hereda el bypass residual de
  // /tesoreria/cuentas-a-pagar (follow-up conocido de 025b).
  const verSaldo = await puedeVerSaldo();
  if (!verSaldo) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-[15px] font-semibold tracking-tight">Cuentas a pagar · Gestión</h1>
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 px-4 text-center">
          <p className="text-sm font-medium text-foreground">Acceso restringido</p>
          <p className="max-w-md text-xs text-muted-foreground">
            Necesitás el permiso de saldos de tesorería (tesoreria.verSaldo) para ver la gestión de
            cuentas a pagar.
          </p>
        </div>
      </div>
    );
  }

  const [params, session, cotizacion, proveedores] = await Promise.all([
    searchParams,
    auth(),
    getCotizacionParaFecha(new Date()),
    listarSaldosProveedoresWorklist(verSaldo),
  ]);

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

  // Flatten read-only del aging anidado (1 fila por documento pendiente) +
  // preset de vista server-side (lección PR-010) sobre la clasificación YA
  // hecha por el motor. Orden default = urgencia (presentación pura).
  const vista = resolverVista(params.vista);
  const rows = ordenarPorUrgencia(flattenFacturasPendientes(proveedores ?? []));
  const rowsVista = filtrarPorVista(rows, vista);

  // KPIs de aging sobre TODAS las filas (la vista filtra sólo el grid, espejo
  // 025c): suma POR MONEDA NATIVA antes de convertir (lección #262/#263) — la
  // igualdad con los totales del grid está trabada por el test de paridad.
  const buckets = sumarBucketsNativos(
    rows.map((r) => ({ bucket: r.bucket, moneda: r.moneda, montoNativo: r.montoNativo })),
  );
  const totalVencido = fmtMoney(convertirBucket(buckets.vencida, moneda, tc));
  const totalProximo = fmtMoney(convertirBucket(buckets.proxima, moneda, tc));
  const totalAlDia = fmtMoney(convertirBucket(buckets.al_dia, moneda, tc));
  // Saldo contable por proveedor: cada posición en su moneda nativa
  // (saldoTotalUsd sólo si es USD-nata) → convertido por separado.
  const totalContable = fmtMoney(
    convertirBucket(
      sumarSaldosNativos(
        (proveedores ?? []).map((p) => ({ saldoArs: p.saldoTotal, saldoUsd: p.saldoTotalUsd })),
      ),
      moneda,
      tc,
    ),
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[15px] font-semibold tracking-tight">Cuentas a pagar · Gestión</h1>
          <p className="text-sm text-muted-foreground">
            Un documento pendiente por fila (Finanzas programa · Tesorería ejecuta). La ejecución de
            pagos, VEP y retenciones vive en{" "}
            <Link href="/tesoreria/cuentas-a-pagar" className="underline underline-offset-2">
              Tesorería · Cuentas a pagar
            </Link>
            .
          </p>
        </div>
        <div className="flex items-center gap-2">
          <MonedaToggle current={moneda} tcInfo={tcInfo} />
          {VISTAS.map((v) => (
            <Link
              key={v.id}
              href={vistaHref(v.id, params.moneda)}
              className={buttonVariants({
                variant: vista === v.id ? "default" : "outline",
                size: "sm",
              })}
            >
              {v.label}
            </Link>
          ))}
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
          label="Saldo contable proveedores"
          value={`${totalContable} ${moneda}`}
          tone="muted"
        />
      </div>

      <FinCxpWorklist
        rows={rowsVista}
        moneda={moneda}
        tc={tc}
        emptyMessage={
          vista === "todas"
            ? "Sin documentos pendientes de pago."
            : "Ningún documento pendiente para la vista seleccionada."
        }
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
