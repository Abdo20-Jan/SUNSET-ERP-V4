import Link from "next/link";
import { notFound } from "next/navigation";

import { auth } from "@/lib/auth";
import { getOportunidad } from "@/lib/actions/oportunidades";
import { listarStages } from "@/lib/actions/pipeline";
import { isCrmEnabled } from "@/lib/features";
import { getCotizacionParaFecha } from "@/lib/services/cotizacion";
import { fmtDate, fmtMontoPres } from "@/lib/format";
import { OportunidadEstado } from "@/generated/prisma/client";

import { MonedaToggle, type Moneda } from "../../../reportes/_components/moneda-toggle";

import { CerrarButtons } from "./_components/cerrar-buttons";
import { MoverStageSelect } from "./_components/mover-stage-select";

export const dynamic = "force-dynamic";

export default async function OportunidadDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ moneda?: string }>;
}) {
  if (!isCrmEnabled()) {
    return (
      <main className="container mx-auto p-6">
        <h1 className="text-2xl font-semibold">Oportunidad</h1>
        <p className="mt-4 text-muted-foreground">
          CRM no habilitado. Setear <code>CRM_ENABLED=true</code>.
        </p>
      </main>
    );
  }

  const { id } = await params;
  const [{ moneda: monedaParam }, session, cotizacion, op] = await Promise.all([
    searchParams,
    auth(),
    getCotizacionParaFecha(new Date()),
    getOportunidad(id),
  ]);
  if (!op) notFound();

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

  const stages = await listarStages();

  return (
    <main className="container mx-auto space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{op.titulo}</h1>
          <p className="text-sm text-muted-foreground">
            {op.numero} · {fmtMontoPres(op.monto.toString(), op.moneda as Moneda, moneda, tc)}{" "}
            {moneda} · {op.estado}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MonedaToggle current={moneda} tcInfo={tcInfo} />
          {op.estado === OportunidadEstado.ABIERTA && (
            <div className="flex flex-wrap gap-2">
              <MoverStageSelect
                opId={op.id}
                stageActual={op.stageId}
                stages={stages.map((s) => ({ id: s.id, nombre: s.nombre }))}
              />
              <CerrarButtons opId={op.id} />
            </div>
          )}
        </div>
      </header>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Info label="Stage" value={op.stage.nombre} />
        <Info label="Probabilidad" value={`${op.probabilidad}%`} />
        <Info
          label="Cierre estimado"
          value={op.cierreEstimado ? fmtDate(op.cierreEstimado) : "—"}
        />
        <Info label="Owner" value={op.owner.nombre} />
        <Info
          label="Lead"
          value={
            op.lead ? (
              <Link href={`/crm/leads/${op.lead.id}`} className="text-primary hover:underline">
                {op.lead.empresa ?? op.lead.nombre}
              </Link>
            ) : (
              "—"
            )
          }
        />
        <Info
          label="Cliente"
          value={
            op.cliente ? (
              <Link
                href={`/maestros/clientes/${op.cliente.id}`}
                className="text-primary hover:underline"
              >
                {op.cliente.nombre}
              </Link>
            ) : (
              "—"
            )
          }
        />
        <Info label="Creada" value={fmtDate(op.createdAt)} />
        <Info label="Actualizada" value={fmtDate(op.updatedAt)} />
      </section>

      {op.notas && (
        <section className="rounded-md border p-4">
          <h2 className="mb-2 font-medium">Notas</h2>
          <p className="whitespace-pre-wrap text-sm">{op.notas}</p>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Actividades ({op.actividades.length})</h2>
        {op.actividades.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin actividades.</p>
        ) : (
          <ul className="space-y-2">
            {op.actividades.map((a) => (
              <li key={a.id} className="rounded-md border p-3 text-sm">
                <div>
                  <span className="font-mono text-xs">{a.tipo}</span> ·{" "}
                  <span className={a.completada ? "text-muted-foreground line-through" : ""}>
                    {a.contenido}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {a.owner.nombre} · {a.fechaProgramada ? fmtDate(a.fechaProgramada) : "sin fecha"}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="text-sm">
      <div className="text-muted-foreground">{label}</div>
      <div>{value ?? "—"}</div>
    </div>
  );
}
