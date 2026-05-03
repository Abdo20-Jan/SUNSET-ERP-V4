import Link from "next/link";

import { auth } from "@/lib/auth";
import { listarActividadesPendientes } from "@/lib/actions/actividades";
import { isCrmEnabled } from "@/lib/features";
import { fmtDate } from "@/lib/format";

import { CompletarButton } from "./_components/completar-button";

export default async function ActividadesPage() {
  if (!isCrmEnabled()) {
    return (
      <main className="container mx-auto p-6">
        <h1 className="text-2xl font-semibold">Actividades</h1>
        <p className="mt-4 text-muted-foreground">
          CRM no habilitado. Setear <code>CRM_ENABLED=true</code>.
        </p>
      </main>
    );
  }

  const session = await auth();
  if (!session?.user.id) {
    return (
      <main className="container mx-auto p-6">
        <p>No autorizado.</p>
      </main>
    );
  }

  const actividades = await listarActividadesPendientes(session.user.id);
  const ahora = Date.now();

  return (
    <main className="container mx-auto space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Mis actividades pendientes</h1>
        <p className="text-sm text-muted-foreground">{actividades.length} pendiente(s)</p>
      </header>

      {actividades.length === 0 ? (
        <p className="text-muted-foreground">Sin actividades pendientes.</p>
      ) : (
        <ul className="space-y-2">
          {actividades.map((a) => {
            const atrasada =
              a.fechaProgramada && a.fechaProgramada.getTime() < ahora;
            return (
              <li key={a.id} className="rounded-md border p-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div>
                      <span className="font-mono text-xs">{a.tipo}</span> · {a.contenido}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {a.fechaProgramada ? (
                        <span className={atrasada ? "text-red-700" : ""}>
                          {fmtDate(a.fechaProgramada)}
                          {atrasada ? " · ATRASADA" : ""}
                        </span>
                      ) : (
                        "Sin fecha programada"
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      {a.lead && (
                        <Link
                          href={`/crm/leads/${a.lead.id}`}
                          className="rounded bg-muted px-2 py-0.5 hover:bg-muted-foreground/10"
                        >
                          Lead: {a.lead.empresa ?? a.lead.nombre}
                        </Link>
                      )}
                      {a.cliente && (
                        <Link
                          href={`/maestros/clientes/${a.cliente.id}`}
                          className="rounded bg-muted px-2 py-0.5 hover:bg-muted-foreground/10"
                        >
                          Cliente: {a.cliente.nombre}
                        </Link>
                      )}
                      {a.oportunidad && (
                        <Link
                          href={`/crm/oportunidades/${a.oportunidad.id}`}
                          className="rounded bg-muted px-2 py-0.5 hover:bg-muted-foreground/10"
                        >
                          Op: {a.oportunidad.numero}
                        </Link>
                      )}
                    </div>
                  </div>
                  <CompletarButton actividadId={a.id} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
