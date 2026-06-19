import { fmtMontoPres } from "@/lib/format";
import type { listarOportunidades } from "@/lib/actions/oportunidades";
import type { Moneda } from "@/generated/prisma/client";

type OpResumen = Awaited<ReturnType<typeof listarOportunidades>>[number];

export type KanbanCard = {
  id: string;
  numero: string;
  titulo: string;
  montoLabel: string;
  stageId: string;
  leadOClienteHref: string | null;
  leadOClienteNombre: string;
};

/**
 * Etiqueta del monto del kanban en la moneda de PRESENTACIÓN. El monto viene en
 * su moneda nativa (`Oportunidad.moneda`, sin TC propio); se convierte al TC de
 * cierre vía `fmtMontoPres` y se le anexa el sufijo de la moneda elegida.
 */
export function buildMontoLabel(
  monto: string,
  monedaNativa: Moneda,
  pres: Moneda,
  tc: string | null,
): string {
  return `${fmtMontoPres(monto, monedaNativa, pres, tc)} ${pres}`;
}

export function buildHref(o: OpResumen): string | null {
  if (o.clienteId) return `/maestros/clientes/${o.clienteId}`;
  if (o.leadId) return `/crm/leads/${o.leadId}`;
  return null;
}

export function buildNombre(o: OpResumen): string {
  return o.clienteNombre ?? o.leadEmpresa ?? o.leadNombre ?? "—";
}

export function buildKanbanCards(ops: OpResumen[], pres: Moneda, tc: string | null): KanbanCard[] {
  return ops.map((o) => ({
    id: o.id,
    numero: o.numero,
    titulo: o.titulo,
    montoLabel: buildMontoLabel(o.monto, o.moneda, pres, tc),
    stageId: o.stageId,
    leadOClienteHref: buildHref(o),
    leadOClienteNombre: buildNombre(o),
  }));
}
