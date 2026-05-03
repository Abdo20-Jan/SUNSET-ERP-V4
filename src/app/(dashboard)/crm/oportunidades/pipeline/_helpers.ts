import { fmtMoney } from "@/lib/format";
import type { listarOportunidades } from "@/lib/actions/oportunidades";

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

export function buildHref(o: OpResumen): string | null {
  if (o.clienteId) return `/maestros/clientes/${o.clienteId}`;
  if (o.leadId) return `/crm/leads/${o.leadId}`;
  return null;
}

export function buildNombre(o: OpResumen): string {
  return o.clienteNombre ?? o.leadEmpresa ?? o.leadNombre ?? "—";
}

export function buildKanbanCards(ops: OpResumen[]): KanbanCard[] {
  return ops.map((o) => ({
    id: o.id,
    numero: o.numero,
    titulo: o.titulo,
    montoLabel: `${o.moneda} ${fmtMoney(o.monto)}`,
    stageId: o.stageId,
    leadOClienteHref: buildHref(o),
    leadOClienteNombre: buildNombre(o),
  }));
}
