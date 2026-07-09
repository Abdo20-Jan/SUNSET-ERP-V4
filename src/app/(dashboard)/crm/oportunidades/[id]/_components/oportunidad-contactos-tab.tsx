import { RecordSection } from "@/components/record/record-section";
import type { listarContactosDeCliente } from "@/lib/actions/contactos";

/*
 * Pestaña Contactos del record de oportunidad (CRM-01 · PR-030). READ-ONLY:
 * `Contacto` NO tiene oportunidadId — se muestran los contactos del VÍNCULO
 * (cliente con precedencia sobre lead), rotulados con la leyenda que arma la
 * page. Sin CTAs de escritura (el ABM de contactos vive en /crm/contactos y
 * en las fichas de lead/cliente) y sin datos fabricados: vacío honesto.
 */

type ContactoRow = Awaited<ReturnType<typeof listarContactosDeCliente>>[number];

function PrincipalCell({ esPrincipal }: { esPrincipal: boolean }) {
  if (!esPrincipal) return <span className="text-xs text-muted-foreground">—</span>;
  return <span className="text-xs font-medium">Principal</span>;
}

export function OportunidadContactosTab({
  contactos,
  legenda,
}: {
  contactos: ContactoRow[];
  legenda: string;
}) {
  return (
    <RecordSection title="Contactos" description={legenda}>
      {contactos.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Sin contactos registrados en el vínculo de esta oportunidad.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left">
              <tr>
                <th className="px-3 py-2">Nombre</th>
                <th className="px-3 py-2">Cargo</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Teléfono</th>
                <th className="px-3 py-2">Principal</th>
              </tr>
            </thead>
            <tbody>
              {contactos.map((c) => (
                <tr key={c.id} className="border-t hover:bg-muted/50">
                  <td className="px-3 py-2">{c.nombre}</td>
                  <td className="px-3 py-2">{c.cargo ?? "—"}</td>
                  <td className="px-3 py-2">{c.email ?? "—"}</td>
                  <td className="px-3 py-2">{c.telefono ?? "—"}</td>
                  <td className="px-3 py-2">
                    <PrincipalCell esPrincipal={c.esPrincipal} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </RecordSection>
  );
}
