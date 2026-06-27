import { listarEmbarques } from "@/lib/actions/embarques";
import { hasPermission, PERMISOS } from "@/lib/permisos";
import { getCotizacionParaFecha } from "@/lib/services/cotizacion";
import { parseVista, VISTAS } from "@/lib/services/comex-worklist-derivaciones";
import type { Moneda } from "@/generated/prisma/client";
import { Card } from "@/components/ui/card";

import { EmbarquesViewsBar } from "./_components/embarques-views-bar";
import { EmbarquesWorklist } from "./_components/embarques-worklist";

type SearchParams = Promise<{ vista?: string; moneda?: string }>;

function parseMoneda(v: string | undefined): Moneda | undefined {
  if (v === "ARS") return "ARS";
  if (v === "USD") return "USD";
  return undefined;
}

export const dynamic = "force-dynamic";

export default async function EmbarquesPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const vista = parseVista(params.vista);
  const moneda = parseMoneda(params.moneda);

  // Gate de costo server-side: `verCosto` decide si `costoTotal` viaja al cliente.
  // `tc` (cierre) sólo para el resumen de selección (suma FOB ARS/USD).
  const [verCosto, cotizacion] = await Promise.all([
    hasPermission(PERMISOS.VER_COSTO_LANDED),
    getCotizacionParaFecha(new Date()),
  ]);
  const tc = cotizacion ? cotizacion.valor.toString() : null;

  const { rows, total } = await listarEmbarques({ vista, moneda, verCosto });
  const vistaLabel = VISTAS.find((v) => v.id === vista)?.label ?? "Todos";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="text-[15px] font-semibold tracking-tight">Embarques</h1>
        <p className="text-sm text-muted-foreground">
          {total} proceso{total === 1 ? "" : "s"} · {vistaLabel}
          {moneda ? ` · moneda ${moneda}` : ""}
        </p>
      </div>

      <Card className="py-0">
        <EmbarquesViewsBar />
        <EmbarquesWorklist rows={rows} tc={tc} verCosto={verCosto} />
      </Card>
    </div>
  );
}
