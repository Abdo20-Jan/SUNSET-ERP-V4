import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon } from "@hugeicons/core-free-icons";

import { auth } from "@/lib/auth";
import { listarCompras } from "@/lib/actions/compras";
import { getCotizacionParaFecha } from "@/lib/services/cotizacion";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Pagination } from "@/components/ui/pagination";
import { parsePaginationParams } from "@/components/ui/pagination-params";

import { MonedaToggle, type Moneda } from "../reportes/_components/moneda-toggle";

import { ComprasTable } from "./_components/compras-table";

type SearchParams = Promise<{ page?: string; perPage?: string; moneda?: string }>;

export const dynamic = "force-dynamic";

export default async function ComprasPage({ searchParams }: { searchParams: SearchParams }) {
  const [params, session, cotizacion] = await Promise.all([
    searchParams,
    auth(),
    getCotizacionParaFecha(new Date()),
  ]);
  const { page, perPage } = parsePaginationParams(params);

  const monedaPreferida: Moneda = session?.user.monedaPreferida === "ARS" ? "ARS" : "USD";
  const moneda: Moneda =
    params.moneda === "ARS" ? "ARS" : params.moneda === "USD" ? "USD" : monedaPreferida;
  // El TC se pasa SIEMPRE que haya cotización (no gated en USD): las facturas
  // USD nativas se preservan 1 a 1 y las ARS se convierten; `convertirMonto`
  // decide por moneda nativa↔presentación.
  const tc = cotizacion ? cotizacion.valor.toString() : null;
  const tcInfo = cotizacion
    ? {
        valor: cotizacion.valor.toString(),
        fecha: cotizacion.fecha.toISOString().slice(0, 10),
        fuente: cotizacion.fuente,
      }
    : null;

  const { rows, total, emitidas, borradores } = await listarCompras({
    page,
    perPage,
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[15px] font-semibold tracking-tight">Compras</h1>
          <p className="text-sm text-muted-foreground">
            {total} compra{total === 1 ? "" : "s"}
            {total > 0 && (
              <span>
                {" "}
                · {emitidas} emitida{emitidas === 1 ? "" : "s"} · {borradores} borrador
                {borradores === 1 ? "" : "es"}
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <MonedaToggle current={moneda} tcInfo={tcInfo} />
          <Link href="/compras/pedidos" className={buttonVariants({ variant: "outline" })}>
            Pedidos (OC)
          </Link>
          <Link href="/compras/nueva" className={buttonVariants({ variant: "default" })}>
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
            Nueva compra
          </Link>
        </div>
      </div>

      <Card className="py-0">
        <ComprasTable data={rows} moneda={moneda} tc={tc} />
        <Pagination page={page} perPage={perPage} total={total} className="border-t" />
      </Card>
    </div>
  );
}
