import { notFound } from "next/navigation";

import { getLead } from "@/lib/actions/leads";
import { isCrmEnabled } from "@/lib/features";

import { LeadForm } from "../../_components/lead-form";

export default async function EditarLeadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!isCrmEnabled()) {
    return (
      <main className="container mx-auto p-6">
        <h1 className="text-2xl font-semibold">Editar lead</h1>
        <p className="mt-4 text-muted-foreground">
          CRM no habilitado. Setear <code>CRM_ENABLED=true</code>.
        </p>
      </main>
    );
  }

  const { id } = await params;
  const lead = await getLead(id);
  if (!lead) notFound();

  return (
    <main className="container mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Editar lead</h1>
      <LeadForm
        mode="edit"
        leadId={lead.id}
        initial={{
          nombre: lead.nombre,
          empresa: lead.empresa ?? undefined,
          cuit: lead.cuit ?? undefined,
          email: lead.email ?? undefined,
          telefono: lead.telefono ?? undefined,
          fuente: lead.fuente,
          estado: lead.estado,
          notas: lead.notas ?? undefined,
        }}
      />
    </main>
  );
}
