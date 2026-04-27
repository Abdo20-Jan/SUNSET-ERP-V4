import { Card } from "@/components/ui/card";

import { listarCotizaciones } from "@/lib/services/cotizacion";

import { CotizacionesTable } from "./cotizaciones-table";

export const dynamic = "force-dynamic";

export default async function CotizacionesPage() {
  const rows = await listarCotizaciones(120);

  const serialized = rows.map((r) => ({
    id: r.id,
    fecha: r.fecha.toISOString().slice(0, 10),
    valor: r.valor.toString(),
    fuente: r.fuente,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Cotizaciones USD
        </h1>
        <p className="text-sm text-muted-foreground">
          Tipo de cambio del día (1 USD = X ARS). Se usa para mostrar reportes
          en USD — el sistema toma la cotización vigente más reciente cuya
          fecha sea menor o igual a la fecha del reporte.
        </p>
      </div>

      <Card className="py-0">
        <CotizacionesTable rows={serialized} />
      </Card>
    </div>
  );
}
