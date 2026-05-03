import { isCrmEnabled } from "@/lib/features";

import { TemplateForm } from "../_components/template-form";

export default function NuevoTemplatePage() {
  if (!isCrmEnabled()) {
    return (
      <main className="container mx-auto p-6">
        <h1 className="text-2xl font-semibold">Nuevo template</h1>
        <p className="mt-4 text-muted-foreground">
          CRM no habilitado. Setear <code>CRM_ENABLED=true</code>.
        </p>
      </main>
    );
  }

  return (
    <main className="container mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Nuevo template</h1>
      <TemplateForm mode="create" />
    </main>
  );
}
