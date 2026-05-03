import Link from "next/link";

import { listarLeads } from "@/lib/actions/leads";
import { isCrmEnabled } from "@/lib/features";
import { fmtDate } from "@/lib/format";
import { LeadEstado, LeadFuente } from "@/generated/prisma/client";

type SearchParams = Promise<{
  estado?: string;
  fuente?: string;
  q?: string;
}>;

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  if (!isCrmEnabled()) {
    return (
      <main className="container mx-auto p-6">
        <h1 className="text-2xl font-semibold">Leads</h1>
        <p className="mt-4 text-muted-foreground">
          CRM no habilitado. Setear <code>CRM_ENABLED=true</code>.
        </p>
      </main>
    );
  }

  const { estado, fuente, q } = await searchParams;
  const estadoFilter = parseEstado(estado);
  const fuenteFilter = parseFuente(fuente);

  const leads = await listarLeads({
    estado: estadoFilter,
    fuente: fuenteFilter,
    search: q,
  });

  return (
    <main className="container mx-auto space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Leads</h1>
          <p className="text-sm text-muted-foreground">{leads.length} lead(s)</p>
        </div>
        <Link
          href="/crm/leads/nuevo"
          className="rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90"
        >
          Nuevo lead
        </Link>
      </header>

      <form className="flex flex-wrap items-end gap-3" method="get">
        <label className="flex flex-col text-sm">
          <span className="text-muted-foreground">Buscar</span>
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder="Nombre, empresa, CUIT, email"
            className="rounded-md border px-3 py-1.5"
          />
        </label>
        <label className="flex flex-col text-sm">
          <span className="text-muted-foreground">Estado</span>
          <select name="estado" defaultValue={estado ?? ""} className="rounded-md border px-3 py-1.5">
            <option value="">Todos</option>
            {Object.values(LeadEstado).map((e) => (
              <option key={e} value={e}>{e}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-sm">
          <span className="text-muted-foreground">Fuente</span>
          <select name="fuente" defaultValue={fuente ?? ""} className="rounded-md border px-3 py-1.5">
            <option value="">Todas</option>
            {Object.values(LeadFuente).map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="rounded-md border px-3 py-1.5 hover:bg-muted"
        >
          Filtrar
        </button>
      </form>

      {leads.length === 0 ? (
        <p className="text-muted-foreground">No hay leads.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left">
              <tr>
                <th className="px-3 py-2">Nombre</th>
                <th className="px-3 py-2">Empresa</th>
                <th className="px-3 py-2">CUIT</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Fuente</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2 text-right">Score</th>
                <th className="px-3 py-2">Owner</th>
                <th className="px-3 py-2">Cliente</th>
                <th className="px-3 py-2">Creado</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id} className="border-t hover:bg-muted/50">
                  <td className="px-3 py-2">
                    <Link href={`/crm/leads/${l.id}`} className="text-primary hover:underline">
                      {l.nombre}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{l.empresa ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs">{l.cuit ?? "—"}</td>
                  <td className="px-3 py-2">{l.email ?? "—"}</td>
                  <td className="px-3 py-2">{l.fuente}</td>
                  <td className="px-3 py-2">
                    <span className={estadoCls(l.estado)}>{l.estado}</span>
                  </td>
                  <td className="px-3 py-2 text-right">{l.score}</td>
                  <td className="px-3 py-2">{l.ownerNombre}</td>
                  <td className="px-3 py-2">
                    {l.clienteId ? (
                      <Link
                        href={`/maestros/clientes/${l.clienteId}`}
                        className="text-primary hover:underline"
                      >
                        {l.clienteNombre}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {fmtDate(l.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

function estadoCls(estado: LeadEstado): string {
  if (estado === LeadEstado.CONVERTIDO) return "font-medium text-green-700";
  if (estado === LeadEstado.DESCALIFICADO) return "text-red-700";
  if (estado === LeadEstado.CALIFICADO) return "font-medium text-blue-700";
  return "";
}

function parseEstado(v: string | undefined): LeadEstado | undefined {
  if (!v) return undefined;
  return (Object.values(LeadEstado) as string[]).includes(v)
    ? (v as LeadEstado)
    : undefined;
}

function parseFuente(v: string | undefined): LeadFuente | undefined {
  if (!v) return undefined;
  return (Object.values(LeadFuente) as string[]).includes(v)
    ? (v as LeadFuente)
    : undefined;
}
