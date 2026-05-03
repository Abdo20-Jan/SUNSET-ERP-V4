import { db } from "@/lib/db";
import { isCrmEnabled } from "@/lib/features";

import { ContactosTable } from "./_components/contactos-table";

export default async function ContactosPage() {
  if (!isCrmEnabled()) {
    return (
      <main className="container mx-auto p-6">
        <h1 className="text-2xl font-semibold">Contactos</h1>
        <p className="mt-4 text-muted-foreground">
          CRM no habilitado. Setear <code>CRM_ENABLED=true</code>.
        </p>
      </main>
    );
  }

  const contactos = await db.contacto.findMany({
    orderBy: [{ esPrincipal: "desc" }, { nombre: "asc" }],
    include: {
      lead: { select: { id: true, nombre: true, empresa: true } },
      cliente: { select: { id: true, nombre: true } },
    },
  });

  return (
    <main className="container mx-auto space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Contactos</h1>
        <p className="text-sm text-muted-foreground">{contactos.length} contacto(s)</p>
      </header>

      {contactos.length === 0 ? (
        <p className="text-muted-foreground">Sin contactos. Agregar desde un lead o cliente.</p>
      ) : (
        <ContactosTable contactos={contactos} />
      )}
    </main>
  );
}
