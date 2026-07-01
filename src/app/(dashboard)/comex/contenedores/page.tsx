import { notFound } from "next/navigation";

import { isContenedorDesconsolidacionEnabled } from "@/lib/features";
import { hasPermission, PERMISOS } from "@/lib/permisos";
import { listarContenedores } from "@/lib/services/contenedor-worklist";
import { Card } from "@/components/ui/card";

import { ContenedoresWorklist } from "./_components/contenedores-worklist";

export const dynamic = "force-dynamic";

export default async function ContenedoresPage() {
  // Gate de flag PRIMERO: con la feature apagada la ruta no existe y NINGUNA
  // query de contenedores corre (inercia total — cero regresión).
  if (!isContenedorDesconsolidacionEnabled()) notFound();

  // Gate de costo server-side: `verCosto` decide si el costo FC viaja al cliente.
  const verCosto = await hasPermission(PERMISOS.VER_COSTO_LANDED);
  const { rows, total } = await listarContenedores({ verCosto });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="text-[15px] font-semibold tracking-tight">Contenedores</h1>
        <p className="text-sm text-muted-foreground">
          {total} contenedor{total === 1 ? "" : "es"} · todos los procesos
        </p>
      </div>

      <Card className="py-0">
        <ContenedoresWorklist rows={rows} verCosto={verCosto} />
      </Card>
    </div>
  );
}
