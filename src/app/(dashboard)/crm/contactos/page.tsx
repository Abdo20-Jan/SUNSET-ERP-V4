import { db } from "@/lib/db";
import { isCrmEnabled } from "@/lib/features";
import { Pagination } from "@/components/ui/pagination";
import { parsePaginationParams } from "@/components/ui/pagination-params";

import { ContactosTable } from "./_components/contactos-table";

export const dynamic = "force-dynamic";

export default async function ContactosPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; perPage?: string }>;
}) {
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

  const params = await searchParams;
  const { page, perPage } = parsePaginationParams(params);

  const [contactos, total] = await Promise.all([
    db.contacto.findMany({
      orderBy: [{ esPrincipal: "desc" }, { nombre: "asc" }],
      include: {
        lead: { select: { id: true, nombre: true, empresa: true } },
        cliente: { select: { id: true, nombre: true } },
      },
      take: perPage,
      skip: (page - 1) * perPage,
    }),
    db.contacto.count(),
  ]);

  return (
    <main className="container mx-auto space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Contactos</h1>
        <p className="text-sm text-muted-foreground">{total} contacto(s)</p>
      </header>

      {total === 0 ? (
        <p className="text-muted-foreground">Sin contactos. Agregar desde un lead o cliente.</p>
      ) : (
        <ContactosTable contactos={contactos} />
      )}

      <Pagination page={page} perPage={perPage} total={total} />
    </main>
  );
}
