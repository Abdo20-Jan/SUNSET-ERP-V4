import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon } from "@hugeicons/core-free-icons";

import { listarGastos } from "@/lib/actions/gastos";
import { auth } from "@/lib/auth";
import { getCotizacionParaFecha } from "@/lib/services/cotizacion";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DateRangeFilter } from "@/components/date-range-filter";

import { MonedaToggle, type Moneda } from "../reportes/_components/moneda-toggle";
import { GastosTable } from "./_components/gastos-table";

export const dynamic = "force-dynamic";

export default async function GastosPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string; moneda?: string }>;
}) {
  const [params, session, cotizacion] = await Promise.all([
    searchParams,
    auth(),
    getCotizacionParaFecha(new Date()),
  ]);
  const rows = await listarGastos({
    desde: params.desde,
    hasta: params.hasta,
  });

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

  const contabilizados = rows.filter((r) => r.estado === "CONTABILIZADO").length;
  const borradores = rows.filter((r) => r.estado === "BORRADOR").length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[15px] font-semibold tracking-tight">Gastos locales</h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} gasto{rows.length === 1 ? "" : "s"}
            {rows.length > 0 && (
              <span>
                {" "}
                · {contabilizados} contabilizado
                {contabilizados === 1 ? "" : "s"} · {borradores} borrador
                {borradores === 1 ? "" : "es"}
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MonedaToggle current={moneda} tcInfo={tcInfo} />
          <DateRangeFilter initialDesde={params.desde ?? ""} initialHasta={params.hasta ?? ""} />
          <Link href="/gastos/nuevo" className={buttonVariants({ variant: "default" })}>
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
            Nuevo gasto
          </Link>
        </div>
      </div>

      <Card className="py-0">
        <GastosTable data={rows} moneda={moneda} tc={tc} />
      </Card>
    </div>
  );
}
