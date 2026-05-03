import Link from "next/link";
import { notFound } from "next/navigation";

import { getLead } from "@/lib/actions/leads";
import { isCrmEnabled } from "@/lib/features";
import { fmtDate } from "@/lib/format";

import { AiSection } from "./_components/ai-section";
import { ConvertirClienteButton } from "./_components/convertir-cliente-button";
import { EliminarLeadButton } from "./_components/eliminar-lead-button";

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!isCrmEnabled()) {
    return (
      <main className="container mx-auto p-6">
        <h1 className="text-2xl font-semibold">Lead</h1>
        <p className="mt-4 text-muted-foreground">
          CRM no habilitado. Setear <code>CRM_ENABLED=true</code>.
        </p>
      </main>
    );
  }

  const { id } = await params;
  const lead = await getLead(id);
  if (!lead) notFound();

  return (
    <main className="container mx-auto space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{lead.nombre}</h1>
          <p className="text-sm text-muted-foreground">
            {lead.empresa ?? "Sin empresa"} · {lead.estado} · score {lead.score}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/crm/leads/${lead.id}/editar`}
            className="rounded-md border px-3 py-1.5 hover:bg-muted"
          >
            Editar
          </Link>
          {!lead.clienteId && <ConvertirClienteButton leadId={lead.id} />}
          <EliminarLeadButton leadId={lead.id} />
        </div>
      </header>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Info label="CUIT" value={lead.cuit} />
        <Info label="Email" value={lead.email} />
        <Info label="Teléfono" value={lead.telefono} />
        <Info label="Fuente" value={lead.fuente} />
        <Info label="Owner" value={lead.owner.nombre} />
        <Info
          label="Cliente vinculado"
          value={
            lead.cliente ? (
              <Link
                href={`/maestros/clientes/${lead.cliente.id}`}
                className="text-primary hover:underline"
              >
                {lead.cliente.nombre}
              </Link>
            ) : (
              "—"
            )
          }
        />
        <Info label="Creado" value={fmtDate(lead.createdAt)} />
        <Info label="Actualizado" value={fmtDate(lead.updatedAt)} />
      </section>

      {lead.notas && (
        <section className="rounded-md border p-4">
          <h2 className="mb-2 font-medium">Notas</h2>
          <p className="whitespace-pre-wrap text-sm">{lead.notas}</p>
        </section>
      )}

      <AiSection leadId={lead.id} />

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Contactos ({lead.contactos.length})</h2>
        {lead.contactos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin contactos.</p>
        ) : (
          <ul className="space-y-2">
            {lead.contactos.map((c) => (
              <li key={c.id} className="rounded-md border p-3 text-sm">
                <div className="font-medium">
                  {c.nombre}
                  {c.esPrincipal && (
                    <span className="ml-2 rounded bg-primary px-1.5 py-0.5 text-xs text-primary-foreground">
                      Principal
                    </span>
                  )}
                </div>
                {c.cargo && <div className="text-muted-foreground">{c.cargo}</div>}
                <div className="text-muted-foreground">
                  {[c.email, c.telefono].filter(Boolean).join(" · ") || "—"}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Oportunidades ({lead.oportunidades.length})</h2>
        {lead.oportunidades.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin oportunidades.</p>
        ) : (
          <ul className="space-y-2">
            {lead.oportunidades.map((o) => (
              <li key={o.id} className="rounded-md border p-3 text-sm">
                <Link
                  href={`/crm/oportunidades/${o.id}`}
                  className="font-medium text-primary hover:underline"
                >
                  {o.numero} · {o.titulo}
                </Link>
                <div className="text-muted-foreground">
                  {o.moneda} {o.monto.toString()} · stage {o.stage.nombre} · {o.estado}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Actividades ({lead.actividades.length})</h2>
        {lead.actividades.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin actividades.</p>
        ) : (
          <ul className="space-y-2">
            {lead.actividades.map((a) => (
              <li key={a.id} className="rounded-md border p-3 text-sm">
                <div>
                  <span className="font-mono text-xs">{a.tipo}</span> ·{" "}
                  <span className={a.completada ? "text-muted-foreground line-through" : ""}>
                    {a.contenido}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {a.owner.nombre} · {a.fechaProgramada ? fmtDate(a.fechaProgramada) : "sin fecha"}
                  {a.completada && a.fechaCompletada
                    ? ` · ✓ ${fmtDate(a.fechaCompletada)}`
                    : ""}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function Info({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="text-sm">
      <div className="text-muted-foreground">{label}</div>
      <div>{value ?? "—"}</div>
    </div>
  );
}
