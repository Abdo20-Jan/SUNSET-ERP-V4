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

const CAMPOS_VALIDOS: Record<string, keyof LeadFields> = {
  empresa: "empresa",
  cuit: "cuit",
  email: "email",
  telefono: "telefono",
  fuente: "fuente",
  estado: "estado",
  notas: "notas",
};

function getCampo(lead: LeadFields, campo: string): string | null {
  const key = CAMPOS_VALIDOS[campo];
  if (!key) return null;
  const value = lead[key];
  return typeof value === "string" ? value : null;
}

const OPERADORES: Record<
  string,
  (valor: string | null, regla: string) => boolean
> = {
  exists: (v) => v !== null && v.trim().length > 0,
  "not-exists": (v) => v === null || v.trim().length === 0,
  equals: (v, r) => v === r,
  "not-equals": (v, r) => v !== r,
  contains: (v, r) =>
    v !== null && v.toLowerCase().includes(r.toLowerCase()),
  "starts-with": (v, r) =>
    v !== null && v.toLowerCase().startsWith(r.toLowerCase()),
};

function evaluarRegla(
  valorCampo: string | null,
  operador: string,
  valorRegla: string,
): boolean {
  // nosemgrep: javascript.lang.security.audit.unsafe-dynamic-method.unsafe-dynamic-method
  const fn = OPERADORES[operador];
  return fn ? fn(valorCampo, valorRegla) : false;
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
