import { db } from "@/lib/db";
import { isCrmEnabled } from "@/lib/features";
import { listarStages } from "@/lib/actions/pipeline";
import { OportunidadEstado } from "@/generated/prisma/client";

import { OportunidadForm } from "../_components/oportunidad-form";

export default async function NuevaOportunidadPage() {
  if (!isCrmEnabled()) {
    return (
      <main className="container mx-auto p-6">
        <h1 className="text-2xl font-semibold">Nueva oportunidad</h1>
        <p className="mt-4 text-muted-foreground">
          CRM no habilitado. Setear <code>CRM_ENABLED=true</code>.
        </p>
      </main>
    );
  }

  const [stages, leads, clientes] = await Promise.all([
    listarStages(),
    db.lead.findMany({
      where: { clienteId: null },
      select: { id: true, nombre: true, empresa: true },
      orderBy: { nombre: "asc" },
    }),
    db.cliente.findMany({
      where: { estado: "activo" },
      select: { id: true, nombre: true },
      orderBy: { nombre: "asc" },
    }),
  ]);

  void OportunidadEstado;

  return (
    <main className="container mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Nueva oportunidad</h1>
      <OportunidadForm
        mode="create"
        stages={stages}
        leads={leads}
        clientes={clientes}
      />
    </main>
  );
}
