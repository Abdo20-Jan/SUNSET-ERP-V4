import Link from "next/link";

import { auth } from "@/lib/auth";
import { getBalanceSumasYSaldos, pruneBalanceSinSaldo } from "@/lib/services/balance-sumas-saldos";
import { getCotizacionParaFecha } from "@/lib/services/cotizacion";
import { Card } from "@/components/ui/card";
import { DateRangeFilter } from "@/components/date-range-filter";
import { OcultarSinSaldoToggle } from "@/components/ocultar-sin-saldo-toggle";

import { MonedaToggle, type Moneda } from "@/app/(dashboard)/reportes/_components/moneda-toggle";

import { BalanceTreeTable } from "./balance-tree-table";

type SearchParams = Promise<{
  desde?: string;
  hasta?: string;
  todas?: string;
  moneda?: string;
}>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(value: string | undefined): Date | undefined {
  if (!value || !DATE_RE.test(value)) return undefined;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function endOfDay(value: string | undefined): Date | undefined {
  if (!value || !DATE_RE.test(value)) return undefined;
  const d = new Date(`${value}T23:59:59.999Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function firstOfMonthIso(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
}

export const dynamic = "force-dynamic";

export default async function BalancePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;

  const desdeStr = params.desde ?? firstOfMonthIso();
  const hastaStr = params.hasta ?? todayIso();
  const fechaDesde = parseDate(desdeStr);
  const fechaHasta = endOfDay(hastaStr);
  const mostrarTodas = params.todas === "1";

  const session = await auth();
  const monedaPreferida: Moneda = session?.user.monedaPreferida === "ARS" ? "ARS" : "USD";
  const moneda: Moneda =
    params.moneda === "ARS" ? "ARS" : params.moneda === "USD" ? "USD" : monedaPreferida;

  const cotizacion = await getCotizacionParaFecha(fechaHasta ?? new Date());
  const tcParaUsd = moneda === "USD" && cotizacion ? cotizacion.valor.toString() : null;

  const balance = await getBalanceSumasYSaldos({ fechaDesde, fechaHasta, tcParaUsd });

  const root = mostrarTodas ? balance.root : pruneBalanceSinSaldo(balance.root);

  const tcInfo = cotizacion
    ? {
        valor: cotizacion.valor.toString(),
        fecha: cotizacion.fecha.toISOString().slice(0, 10),
        fuente: cotizacion.fuente,
      }
    : null;

  const rangoLabel =
    fechaDesde && fechaHasta
      ? `Del ${desdeStr} al ${hastaStr}`
      : fechaHasta
        ? `Hasta ${hastaStr}`
        : fechaDesde
          ? `Desde ${desdeStr}`
          : "Histórico completo";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="text-[15px] font-semibold tracking-tight">Balance de Sumas y Saldos</h1>
        <p className="text-sm text-muted-foreground">{rangoLabel}</p>
        <p className="text-xs text-muted-foreground">
          Balancete (trial balance) — incluye <strong>todas las cuentas (1 a 5)</strong> para
          verificar que el Debe = Haber. Para el balance patrimonial (solo activo/pasivo/PN), ver{" "}
          <Link href="/reportes/balance-general" className="underline hover:text-foreground">
            Balance General
          </Link>
          ; para resultados (cuentas 4-5), ver{" "}
          <Link href="/reportes/estado-resultados" className="underline hover:text-foreground">
            Estado de Resultados
          </Link>
          .
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <DateRangeFilter initialDesde={desdeStr} initialHasta={hastaStr} />
        <div className="flex flex-wrap items-center gap-3">
          <MonedaToggle current={moneda} tcInfo={tcInfo} />
          <OcultarSinSaldoToggle />
        </div>
      </div>

      <Card className="py-0">
        <BalanceTreeTable root={root} moneda={moneda} />
      </Card>
    </div>
  );
}
