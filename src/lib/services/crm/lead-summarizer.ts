import "server-only";

// nosemgrep: ai.typescript.detect-anthropic.detect-anthropic
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import { db } from "@/lib/db";

const SONNET_MODEL = "claude-sonnet-4-6";

const ResumenSchema = z.object({
  resumen: z.string().min(1),
  proximaAccion: z.string().min(1),
});

export type ResumenLead = z.infer<typeof ResumenSchema>;

// nosemgrep: javascript.lang.correctness.missing-template-string-indicator.missing-template-string-indicator
const SYSTEM_PROMPT = `Sos un asistente comercial experto en ventas B2B en Argentina (mercado de neumáticos para vehículos).

Recibís información estructurada de un Lead (prospecto comercial) y devolvés un análisis breve en español rioplatense.

OUTPUT: SOLO un objeto JSON dentro de un bloque \`\`\`json ... \`\`\`. Estructura:

{
  "resumen": "<3 frases describiendo al lead, su empresa, su estado en el embudo y nivel de actividad reciente>",
  "proximaAccion": "<1 frase concreta y accionable: a quién contactar, cuándo, con qué motivo>"
}

REGLAS:
- Tono profesional, conciso, en es-AR (no usar voseo informal en exceso, pero sí 'vos').
- No inventar datos que no estén en el input.
- Si faltan datos clave (ej: sin contactos, sin actividades), señalalo en proximaAccion.
- Si el lead ya está CONVERTIDO, proximaAccion debe ser "Lead ya convertido — sin acción pendiente".
- Si está DESCALIFICADO, proximaAccion debe ser "Lead descalificado — archivar".`;

export async function resumirLead(leadId: string): Promise<ResumenLead> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY no configurada. Agregar la variable en .env (local) y en Vercel (producción).",
    );
  }

  const lead = await db.lead.findUnique({
    where: { id: leadId },
    include: {
      contactos: { orderBy: [{ esPrincipal: "desc" }, { nombre: "asc" }] },
      actividades: {
        orderBy: { createdAt: "desc" },
        take: 20,
      },
      oportunidades: {
        include: { stage: { select: { nombre: true } } },
        orderBy: { createdAt: "desc" },
        take: 10,
      },
    },
  });
  if (!lead) throw new Error("Lead no encontrado.");

  const contexto = JSON.stringify(
    {
      nombre: lead.nombre,
      empresa: lead.empresa,
      cuit: lead.cuit,
      email: lead.email,
      telefono: lead.telefono,
      fuente: lead.fuente,
      estado: lead.estado,
      score: lead.score,
      notas: lead.notas,
      contactos: lead.contactos.map((c) => ({
        nombre: c.nombre,
        cargo: c.cargo,
        esPrincipal: c.esPrincipal,
      })),
      actividadesRecientes: lead.actividades.map((a) => ({
        tipo: a.tipo,
        contenido: a.contenido.slice(0, 200),
        completada: a.completada,
        fecha: a.fechaProgramada ?? a.createdAt,
      })),
      oportunidades: lead.oportunidades.map((o) => ({
        numero: o.numero,
        titulo: o.titulo,
        monto: o.monto.toString(),
        moneda: o.moneda,
        stage: o.stage.nombre,
        estado: o.estado,
      })),
    },
    null,
    2,
  );

  // nosemgrep: ai.typescript.detect-anthropic.detect-anthropic
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: SONNET_MODEL,
    max_tokens: 800,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Analizá este lead y devolvé el JSON con resumen y próxima acción:\n\n${contexto}`,
      },
    ],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const fenced = text.match(/```json\s*([\s\S]+?)\s*```/);
  // nosemgrep: javascript.lang.correctness.no-stringify-keys.no-stringify-keys
  const payload = fenced ? fenced[1] : (text.match(/\{[\s\S]+\}/)?.[0] ?? "{}");
  return ResumenSchema.parse(JSON.parse(payload));
}
