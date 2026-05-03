import Link from "next/link";

import { listarTemplates } from "@/lib/actions/templates";
import { isCrmEnabled } from "@/lib/features";
import { fmtDate } from "@/lib/format";

export default async function TemplatesPage() {
  if (!isCrmEnabled()) {
    return (
      <main className="container mx-auto p-6">
        <h1 className="text-2xl font-semibold">Templates de email</h1>
        <p className="mt-4 text-muted-foreground">
          CRM no habilitado. Setear <code>CRM_ENABLED=true</code>.
        </p>
      </main>
    );
  }

  const templates = await listarTemplates();

  return (
    <main className="container mx-auto space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Templates de email</h1>
          <p className="text-sm text-muted-foreground">
            {templates.length} template(s) · uso manual (envío outbound queda para W5)
          </p>
        </div>
        <Link
          href="/crm/configuracion/templates/nuevo"
          className="rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90"
        >
          Nuevo template
        </Link>
      </header>

      {templates.length === 0 ? (
        <p className="text-muted-foreground">Sin templates.</p>
      ) : (
        <ul className="space-y-2">
          {templates.map((t) => (
            <li key={t.id} className="rounded-md border p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="font-medium">
                    {t.nombre}
                    {!t.activo && (
                      <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs">
                        inactivo
                      </span>
                    )}
                  </div>
                  <div className="text-muted-foreground">{t.asunto}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Actualizado {fmtDate(t.updatedAt)}
                  </div>
                </div>
                <Link
                  href={`/crm/configuracion/templates/${t.id}`}
                  className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted"
                >
                  Editar
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
