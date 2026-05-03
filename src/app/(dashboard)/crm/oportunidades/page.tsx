import Link from "next/link";

import { listarOportunidades } from "@/lib/actions/oportunidades";
import { isCrmEnabled } from "@/lib/features";
import { OportunidadEstado } from "@/generated/prisma/client";

import { OportunidadesTable } from "./_components/oportunidades-table";

type SearchParams = Promise<{ estado?: string }>;

function parseEstado(v: string | undefined): OportunidadEstado | undefined {
  if (!v) return undefined;
  return (Object.values(OportunidadEstado) as string[]).includes(v)
    ? (v as OportunidadEstado)
    : undefined;
}

export default async function OportunidadesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  if (!isCrmEnabled()) {
    return (
      <main className="container mx-auto p-6">
        <h1 className="text-2xl font-semibold">Oportunidades</h1>
        <p className="mt-4 text-muted-foreground">
          CRM no habilitado. Setear <code>CRM_ENABLED=true</code>.
        </p>
      </main>
    );
  }

  const { estado } = await searchParams;
  const ops = await listarOportunidades({ estado: parseEstado(estado) });

  return (
    <main className="container mx-auto space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Oportunidades</h1>
          <p className="text-sm text-muted-foreground">{ops.length} oportunidad(es)</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/crm/oportunidades/pipeline"
            className="rounded-md border px-3 py-1.5 hover:bg-muted"
          >
            Ver pipeline
          </Link>
          <Link
            href="/crm/oportunidades/nueva"
            className="rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90"
          >
            Nueva oportunidad
          </Link>
        </div>
      </header>

      <form className="flex flex-wrap items-end gap-3" method="get">
        <label className="flex flex-col text-sm">
          <span className="text-muted-foreground">Estado</span>
          <select
            name="estado"
            defaultValue={estado ?? ""}
            className="rounded-md border px-3 py-1.5"
          >
            <option value="">Todos</option>
            {Object.values(OportunidadEstado).map((e) => (
              <option key={e} value={e}>{e}</option>
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

      {ops.length === 0 ? (
        <p className="text-muted-foreground">Sin oportunidades.</p>
      ) : (
        <OportunidadesTable ops={ops} />
      )}
    </main>
  );
}
