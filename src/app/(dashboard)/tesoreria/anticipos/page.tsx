import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon } from "@hugeicons/core-free-icons";

import { listarAnticiposProveedor } from "@/lib/actions/anticipos-proveedor";
import { auth } from "@/lib/auth";
import { getCotizacionParaFecha } from "@/lib/services/cotizacion";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

import { MonedaToggle, type Moneda } from "../../reportes/_components/moneda-toggle";
import { AnticiposTable } from "./anticipos-table";

type SearchParams = Promise<{ anticipoId?: string; moneda?: string }>;

export const dynamic = "force-dynamic";

export default async function AnticiposPage({ searchParams }: { searchParams: SearchParams }) {
  const [params, session, cotizacion] = await Promise.all([
    searchParams,
    auth(),
    getCotizacionParaFecha(new Date()),
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

  const rows = await listarAnticiposProveedor();

  const anticipoIdParam =
    params.anticipoId && /^[0-9a-f-]{36}$/i.test(params.anticipoId) ? params.anticipoId : null;
  const anticipoInicial = anticipoIdParam
    ? (rows.find((r) => r.id === anticipoIdParam) ?? null)
    : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[15px] font-semibold tracking-tight">Anticipos a proveedor</h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} anticipo{rows.length === 1 ? "" : "s"} · adelantos a proveedores locales
            (bienes 1.1.7.10 / servicios 1.1.6.10)
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <MonedaToggle current={moneda} tcInfo={tcInfo} />
          <Link
            href="/tesoreria/anticipos/nuevo"
            className={buttonVariants({ variant: "default" })}
          >
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
            Nuevo anticipo
          </Link>
        </div>
      </div>

      <Card className="py-0">
        <AnticiposTable data={rows} anticipoInicial={anticipoInicial} moneda={moneda} tc={tc} />
      </Card>
    </div>
  );
}
