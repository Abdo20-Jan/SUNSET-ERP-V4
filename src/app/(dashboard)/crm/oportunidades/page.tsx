import Link from "next/link";

import { listarOportunidades } from "@/lib/actions/oportunidades";
import { isCrmEnabled } from "@/lib/features";
import { fmtDate, fmtMoney } from "@/lib/format";
import { OportunidadEstado } from "@/generated/prisma/client";

type SearchParams = Promise<{ estado?: string }>;

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
  const estadoFilter = parseEstado(estado);

  const ops = await listarOportunidades({ estado: estadoFilter });

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
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left">
              <tr>
                <th className="px-3 py-2">N°</th>
                <th className="px-3 py-2">Título</th>
                <th className="px-3 py-2 text-right">Monto</th>
                <th className="px-3 py-2">Stage</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2">Lead/Cliente</th>
                <th className="px-3 py-2">Owner</th>
                <th className="px-3 py-2">Cierre est.</th>
              </tr>
            </thead>
            <tbody>
              {ops.map((o) => (
                <tr key={o.id} className="border-t hover:bg-muted/50">
                  <td className="px-3 py-2 font-mono text-xs">
                    <Link href={`/crm/oportunidades/${o.id}`} className="text-primary hover:underline">
                      {o.numero}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{o.titulo}</td>
                  <td className="px-3 py-2 text-right font-medium">
                    {o.moneda} {fmtMoney(o.monto)}
                  </td>
                  <td className="px-3 py-2">{o.stageNombre}</td>
                  <td className="px-3 py-2">
                    <span className={estadoCls(o.estado)}>{o.estado}</span>
                  </td>
                  <td className="px-3 py-2">
                    {o.clienteNombre ? (
                      <Link
                        href={`/maestros/clientes/${o.clienteId}`}
                        className="text-primary hover:underline"
                      >
                        {o.clienteNombre}
                      </Link>
                    ) : o.leadId ? (
                      <Link
                        href={`/crm/leads/${o.leadId}`}
                        className="text-primary hover:underline"
                      >
                        {o.leadEmpresa ?? o.leadNombre}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2">{o.ownerNombre}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {o.cierreEstimado ? fmtDate(o.cierreEstimado) : "—"}
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

function estadoCls(estado: OportunidadEstado): string {
  if (estado === OportunidadEstado.GANADA) return "font-medium text-green-700";
  if (estado === OportunidadEstado.PERDIDA) return "text-red-700";
  if (estado === OportunidadEstado.EN_PAUSA) return "text-amber-700";
  return "";
}

function parseEstado(v: string | undefined): OportunidadEstado | undefined {
  if (!v) return undefined;
  return (Object.values(OportunidadEstado) as string[]).includes(v)
    ? (v as OportunidadEstado)
    : undefined;
}
