import "server-only";

import { db } from "@/lib/db";

type LeadFields = {
  id: string;
  empresa: string | null;
  cuit: string | null;
  email: string | null;
  telefono: string | null;
  fuente: string;
  estado: string;
  notas: string | null;
};

function getCampo(lead: LeadFields, campo: string): string | null {
  switch (campo) {
    case "empresa":
      return lead.empresa;
    case "cuit":
      return lead.cuit;
    case "email":
      return lead.email;
    case "telefono":
      return lead.telefono;
    case "fuente":
      return lead.fuente;
    case "estado":
      return lead.estado;
    case "notas":
      return lead.notas;
    default:
      return null;
  }
}

function evaluarRegla(
  valorCampo: string | null,
  operador: string,
  valorRegla: string,
): boolean {
  switch (operador) {
    case "exists":
      return valorCampo !== null && valorCampo.trim().length > 0;
    case "not-exists":
      return valorCampo === null || valorCampo.trim().length === 0;
    case "equals":
      return valorCampo === valorRegla;
    case "not-equals":
      return valorCampo !== valorRegla;
    case "contains":
      return (
        valorCampo !== null &&
        valorCampo.toLowerCase().includes(valorRegla.toLowerCase())
      );
    case "starts-with":
      return (
        valorCampo !== null &&
        valorCampo.toLowerCase().startsWith(valorRegla.toLowerCase())
      );
    default:
      return false;
  }
}

export async function calcularScoreLead(leadId: string): Promise<number> {
  const [lead, reglas] = await Promise.all([
    db.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        empresa: true,
        cuit: true,
        email: true,
        telefono: true,
        fuente: true,
        estado: true,
        notas: true,
      },
    }),
    db.scoringRule.findMany({ where: { activa: true } }),
  ]);

  if (!lead) return 0;

  let score = 0;
  for (const regla of reglas) {
    const valor = getCampo(lead, regla.campo);
    if (evaluarRegla(valor, regla.operador, regla.valor)) {
      score += regla.puntos;
    }
  }
  return score;
}

export async function recalcularScoreLead(leadId: string): Promise<number> {
  const score = await calcularScoreLead(leadId);
  await db.lead.update({
    where: { id: leadId },
    data: { score },
  });
  return score;
}
