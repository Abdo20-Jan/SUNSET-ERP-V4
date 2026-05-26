import Link from "next/link";
import { notFound } from "next/navigation";

import { isContenedorDesconsolidacionEnabled } from "@/lib/features";
import { obtenerInvestigacionParaContenedor } from "@/lib/services/divergencia-investigacion";
import { getDefaultFecha } from "@/lib/server/fecha-default";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";

import { InvestigacionForm } from "./_components/investigacion-form";

type PageParams = Promise<{ id: string }>;

export const dynamic = "force-dynamic";

export default async function InvestigacionPage({ params }: { params: PageParams }) {
  // Gate de flag: si está apagada, la ruta no existe (no la exponemos).
  if (!isContenedorDesconsolidacionEnabled()) notFound();

  const { id } = await params;

  const [contenedor, defaultFecha] = await Promise.all([
    obtenerInvestigacionParaContenedor(id),
    getDefaultFecha(),
  ]);

  if (!contenedor) notFound();

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title={`Investigación de divergencia — ${contenedor.numeroContenedor}`}
        description={`Embarque ${contenedor.embarqueCodigo} · conferí el físico, diagnosticá la causa y concluí (ajuste contable) o archivá.`}
        actions={
          <Link href={`/comex/embarques/${contenedor.embarqueId}`}>
            <Button variant="outline" size="sm">
              ← Volver al embarque
            </Button>
          </Link>
        }
      />

      <InvestigacionForm contenedor={contenedor} defaultFecha={defaultFecha} />
    </div>
  );
}
