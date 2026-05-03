import { notFound } from "next/navigation";

import { getTemplate } from "@/lib/actions/templates";
import { isCrmEnabled } from "@/lib/features";

import { TemplateForm } from "../_components/template-form";

export default async function EditarTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!isCrmEnabled()) {
    return (
      <main className="container mx-auto p-6">
        <h1 className="text-2xl font-semibold">Editar template</h1>
        <p className="mt-4 text-muted-foreground">
          CRM no habilitado. Setear <code>CRM_ENABLED=true</code>.
        </p>
      </main>
    );
  }

  const { id } = await params;
  const tpl = await getTemplate(id);
  if (!tpl) notFound();

  return (
    <main className="container mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Editar template</h1>
      <TemplateForm
        mode="edit"
        templateId={tpl.id}
        initial={{
          nombre: tpl.nombre,
          asunto: tpl.asunto,
          cuerpo: tpl.cuerpo,
          activo: tpl.activo,
        }}
      />
    </main>
  );
}
