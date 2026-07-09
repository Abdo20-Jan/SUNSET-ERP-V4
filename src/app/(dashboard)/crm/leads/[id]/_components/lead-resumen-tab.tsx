/**
 * Pestaña Resumen del record de lead (CRM-01 · PR-030). Server-safe: proyecta
 * lo que `getLead` YA devuelve en RecordSections (Datos / Notas / IA /
 * Oportunidades). La sección de IA reutiliza `AiSection` VERBATIM (acciones
 * `crm-ai` intactas).
 */

import { EntityLink } from "@/components/data-grid/entity-link";
import { RecordField, RecordFieldGrid, RecordSection } from "@/components/record/record-section";
import { StatusBadge } from "@/components/ui/status-badge";
import type { getLead } from "@/lib/actions/leads";
import { fmtDate } from "@/lib/format";

import { AiSection } from "./ai-section";

export type LeadDetalle = NonNullable<Awaited<ReturnType<typeof getLead>>>;

function ClienteVinculado({ cliente }: { cliente: LeadDetalle["cliente"] }) {
  if (!cliente) return <>—</>;
  return (
    <EntityLink
      label={cliente.nombre}
      href={`/maestros/clientes/${cliente.id}`}
      tabLabel={cliente.nombre}
    />
  );
}

function OportunidadItem({ o }: { o: LeadDetalle["oportunidades"][number] }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
      <div className="min-w-0">
        <EntityLink
          label={`${o.numero} · ${o.titulo}`}
          href={`/crm/oportunidades/${o.id}`}
          tabLabel={o.numero}
        />
        <div className="text-xs text-muted-foreground">
          {o.moneda} {o.monto.toString()} · stage {o.stage.nombre}
        </div>
      </div>
      <StatusBadge estado={o.estado} />
    </li>
  );
}

function OportunidadesSection({ oportunidades }: { oportunidades: LeadDetalle["oportunidades"] }) {
  if (oportunidades.length === 0) {
    return <p className="text-sm text-muted-foreground">Sin oportunidades.</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {oportunidades.map((o) => (
        <OportunidadItem key={o.id} o={o} />
      ))}
    </ul>
  );
}

export function LeadResumenTab({ lead }: { lead: LeadDetalle }) {
  return (
    <>
      <RecordSection title="Datos">
        <RecordFieldGrid>
          <RecordField label="CUIT">{lead.cuit ?? "—"}</RecordField>
          <RecordField label="Email">{lead.email ?? "—"}</RecordField>
          <RecordField label="Teléfono">{lead.telefono ?? "—"}</RecordField>
          <RecordField label="Fuente">{lead.fuente}</RecordField>
          <RecordField label="Owner">{lead.owner.nombre}</RecordField>
          <RecordField label="Cliente vinculado">
            <ClienteVinculado cliente={lead.cliente} />
          </RecordField>
          <RecordField label="Creado">{fmtDate(lead.createdAt)}</RecordField>
          <RecordField label="Actualizado">{fmtDate(lead.updatedAt)}</RecordField>
        </RecordFieldGrid>
      </RecordSection>

      {lead.notas && (
        <RecordSection title="Notas">
          <p className="whitespace-pre-wrap text-sm">{lead.notas}</p>
        </RecordSection>
      )}

      <AiSection leadId={lead.id} />

      <RecordSection title="Oportunidades">
        <OportunidadesSection oportunidades={lead.oportunidades} />
      </RecordSection>
    </>
  );
}
