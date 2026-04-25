import { db } from "@/lib/db";
import { AsientoEstado } from "@/generated/prisma/client";
import { Card } from "@/components/ui/card";

import { PeriodosTable, type PeriodoRow } from "./periodos-table";

export default async function PeriodosPage() {
  const periodos = await db.periodoContable.findMany({
    orderBy: { codigo: "asc" },
    select: {
      id: true,
      codigo: true,
      nombre: true,
      fechaInicio: true,
      fechaFin: true,
      estado: true,
      _count: {
        select: {
          asientos: { where: { estado: AsientoEstado.BORRADOR } },
        },
      },
    },
  });

  const rows: PeriodoRow[] = periodos.map((p) => ({
    id: p.id,
    codigo: p.codigo,
    nombre: p.nombre,
    fechaInicio: p.fechaInicio,
    fechaFin: p.fechaFin,
    estado: p.estado,
    borradorCount: p._count.asientos,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Períodos Contables
        </h1>
        <p className="text-sm text-muted-foreground">
          {periodos.length} períodos
        </p>
      </div>
      <Card className="py-0">
        <PeriodosTable data={rows} />
      </Card>
    </div>
  );
}
