import Link from "next/link";

type ContactoRow = {
  id: string;
  nombre: string;
  cargo: string | null;
  email: string | null;
  telefono: string | null;
  esPrincipal: boolean;
  lead: { id: string; nombre: string; empresa: string | null } | null;
  cliente: { id: string; nombre: string } | null;
};

function VinculoCell({ row }: { row: ContactoRow }) {
  if (row.lead) {
    return (
      <Link href={`/crm/leads/${row.lead.id}`} className="text-primary hover:underline">
        Lead: {row.lead.empresa ?? row.lead.nombre}
      </Link>
    );
  }
  if (row.cliente) {
    return (
      <Link
        href={`/maestros/clientes/${row.cliente.id}`}
        className="text-primary hover:underline"
      >
        Cliente: {row.cliente.nombre}
      </Link>
    );
  }
  return <>—</>;
}

export function ContactosTable({ contactos }: { contactos: ContactoRow[] }) {
  return (
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
                <VinculoCell row={c} />
              </td>
              <td className="px-3 py-2">{c.esPrincipal ? "✓" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
