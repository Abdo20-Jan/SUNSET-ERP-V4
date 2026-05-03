import Link from "next/link";
import { notFound } from "next/navigation";

import { getOportunidad } from "@/lib/actions/oportunidades";
import { listarStages } from "@/lib/actions/pipeline";
import { isCrmEnabled } from "@/lib/features";
import { fmtDate, fmtMoney } from "@/lib/format";
import { OportunidadEstado } from "@/generated/prisma/client";

import { CerrarButtons } from "./_components/cerrar-buttons";
import { MoverStageSelect } from "./_components/mover-stage-select";

export default async function OportunidadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
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
  const op = await getOportunidad(id);
  if (!op) notFound();

  const stages = await listarStages();

  return (
    <main className="container mx-auto space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{op.titulo}</h1>
          <p className="text-sm text-muted-foreground">
            {op.numero} · {op.moneda} {fmtMoney(op.monto.toString())} · {op.estado}
          </p>
        </div>
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
              <Link
                href={`/crm/leads/${op.lead.id}`}
                className="text-primary hover:underline"
              >
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
