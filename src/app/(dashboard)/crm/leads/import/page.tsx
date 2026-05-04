import Link from "next/link";

import { isCrmEnabled } from "@/lib/features";

import { ImportForm } from "./_components/import-form";

export default function ImportLeadsPage() {
  if (!isCrmEnabled()) {
    return (
      <main className="container mx-auto p-6">
        <h1 className="text-2xl font-semibold">Importar leads</h1>
        <p className="mt-4 text-muted-foreground">
          CRM no habilitado. Setear <code>CRM_ENABLED=true</code>.
        </p>
      </main>
    );
  }

  return (
    <main className="container mx-auto max-w-3xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Importar leads desde CSV</h1>
        <p className="text-sm text-muted-foreground">
          Subí un archivo CSV con cabecera. <code>nombre</code> es obligatorio. Otras columnas
          válidas: <code>empresa</code>, <code>cuit</code>, <code>email</code>,{" "}
          <code>telefono</code>, <code>fuente</code>, <code>estado</code>, <code>notas</code>.
          Límite 5000 filas.
        </p>
      </header>

      <ImportForm />

      <div>
        <Link href="/crm/leads" className="text-sm text-muted-foreground hover:underline">
          ← Volver a leads
        </Link>
      </div>
    </main>
  );
}
