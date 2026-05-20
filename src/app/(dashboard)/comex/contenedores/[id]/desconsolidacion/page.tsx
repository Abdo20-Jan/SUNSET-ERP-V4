import Link from "next/link";
import { notFound } from "next/navigation";

import { isContenedorDesconsolidacionEnabled } from "@/lib/features";
import { obtenerContenedorParaDesconsolidacion } from "@/lib/services/contenedor";
import { getDefaultFecha } from "@/lib/server/fecha-default";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";

import { DesconsolidacionForm } from "./_components/desconsolidacion-form";

type PageParams = Promise<{ id: string }>;

export const dynamic = "force-dynamic";

export default async function DesconsolidacionPage({ params }: { params: PageParams }) {
  // Gate de flag: si está apagada, la ruta no existe (no la exponemos).
  if (!isContenedorDesconsolidacionEnabled()) notFound();

  const { id } = await params;

  const [contenedor, defaultFecha] = await Promise.all([
    obtenerContenedorParaDesconsolidacion(id),
    getDefaultFecha(),
  ]);

  if (!contenedor) notFound();

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title={`Desconsolidación — ${contenedor.numeroContenedor}`}
        description={`Embarque ${contenedor.embarqueCodigo} · conferí el físico por SKU y confirmá la desconsolidación.`}
        actions={
          <Link href={`/comex/embarques/${contenedor.embarqueId}`}>
            <Button variant="outline" size="sm">
              ← Volver al embarque
            </Button>
          </Link>
        }
      />

      <DesconsolidacionForm contenedor={contenedor} defaultFecha={defaultFecha} />
    </div>
  );
}
