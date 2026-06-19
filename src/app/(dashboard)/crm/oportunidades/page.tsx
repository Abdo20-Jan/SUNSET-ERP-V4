import Link from "next/link";

import { auth } from "@/lib/auth";
import { listarOportunidades, listarUsuariosParaAsignar } from "@/lib/actions/oportunidades";
import { isCrmEnabled } from "@/lib/features";
import { getCotizacionParaFecha } from "@/lib/services/cotizacion";
import { OportunidadEstado } from "@/generated/prisma/client";

import { MonedaToggle, type Moneda } from "../../reportes/_components/moneda-toggle";

import { OportunidadesTableBulk } from "./_components/oportunidades-table-bulk";

type SearchParams = Promise<{ estado?: string; moneda?: string }>;

function parseEstado(v: string | undefined): OportunidadEstado | undefined {
  if (!v) return undefined;
  return (Object.values(OportunidadEstado) as string[]).includes(v)
    ? (v as OportunidadEstado)
    : undefined;
}

export const dynamic = "force-dynamic";

export default async function OportunidadesPage({ searchParams }: { searchParams: SearchParams }) {
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

  const { estado, moneda: monedaParam } = await searchParams;
  const [session, cotizacion, ops, usuarios] = await Promise.all([
    auth(),
    getCotizacionParaFecha(new Date()),
    listarOportunidades({ estado: parseEstado(estado) }),
    listarUsuariosParaAsignar(),
  ]);

  const monedaPreferida: Moneda = session?.user.monedaPreferida === "ARS" ? "ARS" : "USD";
  const moneda: Moneda =
    monedaParam === "ARS" ? "ARS" : monedaParam === "USD" ? "USD" : monedaPreferida;
  const tc = cotizacion ? cotizacion.valor.toString() : null;
  const tcInfo = cotizacion
    ? {
        valor: cotizacion.valor.toString(),
        fecha: cotizacion.fecha.toISOString().slice(0, 10),
        fuente: cotizacion.fuente,
      }
    : null;

  return (
    <main className="container mx-auto space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Oportunidades</h1>
          <p className="text-sm text-muted-foreground">{ops.length} oportunidad(es)</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MonedaToggle current={moneda} tcInfo={tcInfo} />
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
        {/* Preserva la moneda de presentación al filtrar por estado (form GET). */}
        <input type="hidden" name="moneda" value={moneda} />
        <label className="flex flex-col text-sm">
          <span className="text-muted-foreground">Estado</span>
          <select
            name="estado"
            defaultValue={estado ?? ""}
            className="rounded-md border px-3 py-1.5"
          >
            <option value="">Todos</option>
            {Object.values(OportunidadEstado).map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="rounded-md border px-3 py-1.5 hover:bg-muted">
          Filtrar
        </button>
      </form>

      {ops.length === 0 ? (
        <p className="text-muted-foreground">Sin oportunidades.</p>
      ) : (
        <OportunidadesTableBulk ops={ops} usuarios={usuarios} moneda={moneda} tc={tc} />
      )}
    </main>
  );
}
