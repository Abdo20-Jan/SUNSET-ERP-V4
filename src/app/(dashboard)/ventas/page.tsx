import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon } from "@hugeicons/core-free-icons";

import { auth } from "@/lib/auth";
import { listarVentas } from "@/lib/actions/ventas";
import { getCotizacionParaFecha } from "@/lib/services/cotizacion";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Pagination } from "@/components/ui/pagination";
import { parsePaginationParams } from "@/components/ui/pagination-params";

import { MonedaToggle, type Moneda } from "../reportes/_components/moneda-toggle";

import { VentasTable } from "./_components/ventas-table";

type SearchParams = Promise<{
  page?: string;
  perPage?: string;
  incluirCanceladas?: string;
  moneda?: string;
}>;

export const dynamic = "force-dynamic";

export default async function VentasPage({ searchParams }: { searchParams: SearchParams }) {
  const [params, session, cotizacion] = await Promise.all([
    searchParams,
    auth(),
    getCotizacionParaFecha(new Date()),
  ]);
  const { page, perPage } = parsePaginationParams(params);
  const incluirCanceladas = params.incluirCanceladas === "1";

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

  const { rows, total, emitidas, borradores, canceladas } = await listarVentas({
    page,
    perPage,
    incluirCanceladas,
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[15px] font-semibold tracking-tight">Ventas</h1>
          <p className="text-sm text-muted-foreground">
            {total} venta{total === 1 ? "" : "s"}
            {total > 0 && (
              <span>
                {" "}
                · {emitidas} emitida{emitidas === 1 ? "" : "s"} · {borradores} borrador
                {borradores === 1 ? "" : "es"}
                {incluirCanceladas && canceladas > 0 && (
                  <>
                    {" "}
                    · {canceladas} cancelada{canceladas === 1 ? "" : "s"}
                  </>
                )}
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <MonedaToggle current={moneda} tcInfo={tcInfo} />
          {canceladas > 0 && (
            <Link
              href={incluirCanceladas ? "/ventas" : "/ventas?incluirCanceladas=1"}
              className={buttonVariants({ variant: "outline" })}
            >
              {incluirCanceladas ? "Ocultar canceladas" : `Mostrar canceladas (${canceladas})`}
            </Link>
          )}
          <Link href="/ventas/pedidos" className={buttonVariants({ variant: "outline" })}>
            Pedidos (OV)
          </Link>
          <Link href="/ventas/nueva" className={buttonVariants({ variant: "default" })}>
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
            Nueva venta
          </Link>
        </div>
      </div>

      <Card className="py-0">
        <VentasTable data={rows} moneda={moneda} tc={tc} />
        <Pagination page={page} perPage={perPage} total={total} className="border-t" />
      </Card>
    </div>
  );
}
