import Link from "next/link";

import { auth } from "@/lib/auth";
import { listarComercialDocumentos } from "@/lib/actions/comercial-documentos";
import { getCotizacionParaFecha } from "@/lib/services/cotizacion";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

import { MonedaToggle, type Moneda } from "../../reportes/_components/moneda-toggle";

import { ComercialDocumentosTable } from "./_components/comercial-documentos-table";

type SearchParams = Promise<{ moneda?: string; incluirCanceladas?: string }>;

export const dynamic = "force-dynamic";

export default async function ComercialDocumentosPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const [params, session, cotizacion] = await Promise.all([
    searchParams,
    auth(),
    getCotizacionParaFecha(new Date()),
  ]);

  const incluirCanceladas = params.incluirCanceladas === "1";
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

  const documentos = await listarComercialDocumentos({ incluirCanceladas });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[15px] font-semibold tracking-tight">Documentos comerciales</h1>
          <p className="text-sm text-muted-foreground">
            {documentos.length} documento{documentos.length === 1 ? "" : "s"} · Pedidos y Ventas en
            una vista unificada.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <MonedaToggle current={moneda} tcInfo={tcInfo} />
          <Link
            href={
              incluirCanceladas ? "/ventas/documentos" : "/ventas/documentos?incluirCanceladas=1"
            }
            className={buttonVariants({ variant: "outline" })}
          >
            {incluirCanceladas ? "Ocultar cancelados" : "Mostrar cancelados"}
          </Link>
        </div>
      </div>

      <Card className="py-0">
        <ComercialDocumentosTable documentos={documentos} moneda={moneda} tc={tc} />
      </Card>
    </div>
  );
}
