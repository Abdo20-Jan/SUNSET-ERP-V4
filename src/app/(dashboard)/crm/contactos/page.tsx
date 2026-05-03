import Link from "next/link";

import { db } from "@/lib/db";
import { isCrmEnabled } from "@/lib/features";

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
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left">
              <tr>
                <th className="px-3 py-2">Nombre</th>
                <th className="px-3 py-2">Cargo</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Teléfono</th>
                <th className="px-3 py-2">Vinculado a</th>
                <th className="px-3 py-2">Principal</th>
              </tr>
            </thead>
            <tbody>
              {contactos.map((c) => (
                <tr key={c.id} className="border-t hover:bg-muted/50">
                  <td className="px-3 py-2 font-medium">{c.nombre}</td>
                  <td className="px-3 py-2">{c.cargo ?? "—"}</td>
                  <td className="px-3 py-2">{c.email ?? "—"}</td>
                  <td className="px-3 py-2">{c.telefono ?? "—"}</td>
                  <td className="px-3 py-2">
                    {c.lead ? (
                      <Link
                        href={`/crm/leads/${c.lead.id}`}
                        className="text-primary hover:underline"
                      >
                        Lead: {c.lead.empresa ?? c.lead.nombre}
                      </Link>
                    ) : c.cliente ? (
                      <Link
                        href={`/maestros/clientes/${c.cliente.id}`}
                        className="text-primary hover:underline"
                      >
                        Cliente: {c.cliente.nombre}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2">{c.esPrincipal ? "✓" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
