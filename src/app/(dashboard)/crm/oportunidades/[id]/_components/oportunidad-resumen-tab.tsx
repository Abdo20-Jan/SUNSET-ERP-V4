import { EntityLink } from "@/components/data-grid/entity-link";
import { RecordField, RecordFieldGrid, RecordSection } from "@/components/record/record-section";
import { fmtDate, fmtMontoPres } from "@/lib/format";
import type { getOportunidad } from "@/lib/actions/oportunidades";

import {
  calcularValorPonderado,
  derivarProximaAccionDeActividades,
  derivarUltimoContacto,
  type ProximaAccion,
} from "../../_components/oportunidades-presentacion";
import type { Moneda } from "../../../../reportes/_components/moneda-toggle";

/*
 * Pestaña Resumen del record de oportunidad (CRM-01 · PR-030). Server-safe y
 * READ-ONLY: proyecta lo que `getOportunidad` ya trae. El valor ponderado
 * (monto × probabilidad/100) es DISPLAY-ONLY (`calcularValorPonderado`,
 * decimal exacto) y Próxima acción / Último contacto se DERIVAN de las
 * actividades — nada fabricado ni persistido.
 */

type OportunidadDetalle = NonNullable<Awaited<ReturnType<typeof getOportunidad>>>;

function VinculoLead({ op }: { op: OportunidadDetalle }) {
  if (!op.lead) return <>—</>;
  return <EntityLink label={op.lead.empresa ?? op.lead.nombre} href={`/crm/leads/${op.lead.id}`} />;
}

function VinculoCliente({ op }: { op: OportunidadDetalle }) {
  if (!op.cliente) return <>—</>;
  return <EntityLink label={op.cliente.nombre} href={`/maestros/clientes/${op.cliente.id}`} />;
}

// Línea de seguimiento derivada: "DD/MM/YYYY · TIPO — contenido" (o sin fecha).
function SeguimientoValor({ item }: { item: ProximaAccion | null }) {
  if (!item) return <span className="text-muted-foreground">—</span>;
  const fecha = item.fecha ? fmtDate(item.fecha) : "Sin fecha";
  return (
    <span>
      <span className="tabular-nums">{fecha}</span>
      <span className="ml-1 font-mono text-[10px] uppercase text-muted-foreground">
        {item.tipo}
      </span>
      <span className="ml-2 text-muted-foreground">{item.contenido}</span>
    </span>
  );
}

export function OportunidadResumenTab({
  op,
  moneda,
  tc,
}: {
  op: OportunidadDetalle;
  moneda: Moneda;
  tc: string | null;
}) {
  const montoNativo = op.monto.toString();
  const ponderado = calcularValorPonderado(montoNativo, op.probabilidad);
  const proxima = derivarProximaAccionDeActividades(op.actividades);
  const ultimo = derivarUltimoContacto(op.actividades);

  return (
    <>
      <RecordSection title="Datos de la oportunidad">
        <RecordFieldGrid>
          <RecordField label="Stage">{op.stage.nombre}</RecordField>
          <RecordField label="Probabilidad">{op.probabilidad}%</RecordField>
          <RecordField label="Valor ponderado">
            <span className="font-mono tabular-nums">
              {fmtMontoPres(ponderado, op.moneda, moneda, tc)} {moneda}
            </span>
          </RecordField>
          <RecordField label="Cierre estimado">
            {op.cierreEstimado ? fmtDate(op.cierreEstimado) : "—"}
          </RecordField>
          <RecordField label="Owner">{op.owner.nombre}</RecordField>
          <RecordField label="Lead">
            <VinculoLead op={op} />
          </RecordField>
          <RecordField label="Cliente">
            <VinculoCliente op={op} />
          </RecordField>
          <RecordField label="Creada">{fmtDate(op.createdAt)}</RecordField>
          <RecordField label="Actualizada">{fmtDate(op.updatedAt)}</RecordField>
        </RecordFieldGrid>
      </RecordSection>

      <RecordSection
        title="Seguimiento"
        description="Derivado de las actividades (pendiente más próxima · completada más reciente)."
      >
        <RecordFieldGrid className="sm:grid-cols-2 lg:grid-cols-2">
          <RecordField label="Próxima acción">
            <SeguimientoValor item={proxima} />
          </RecordField>
          <RecordField label="Último contacto">
            <SeguimientoValor item={ultimo} />
          </RecordField>
        </RecordFieldGrid>
      </RecordSection>

      {op.notas && (
        <RecordSection title="Notas">
          <p className="whitespace-pre-wrap text-sm">{op.notas}</p>
        </RecordSection>
      )}
    </>
  );
}
