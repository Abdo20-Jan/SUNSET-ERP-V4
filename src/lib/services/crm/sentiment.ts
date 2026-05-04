import "server-only";

// nosemgrep: ai.typescript.detect-anthropic.detect-anthropic
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";

const SentimentSchema = z.object({
  sentimiento: z.number().min(-1).max(1),
  etiqueta: z.enum(["POSITIVO", "NEUTRAL", "NEGATIVO"]),
});

export type Sentiment = z.infer<typeof SentimentSchema>;

const SYSTEM_PROMPT = `Sos un analizador de sentimiento de notas comerciales en español rioplatense (Argentina).

Recibís el texto de una nota interna sobre un cliente o prospecto. Devolvés un objeto JSON con:

- sentimiento: número entre -1 (muy negativo) y 1 (muy positivo). 0 = neutral.
- etiqueta: una de "POSITIVO", "NEUTRAL", "NEGATIVO".

OUTPUT: SOLO un objeto JSON dentro de un bloque \`\`\`json ... \`\`\`. Sin explicaciones extra.

CRITERIOS:
- POSITIVO (sentimiento > 0.3): cliente satisfecho, oportunidad concreta, palabras como "interesado", "quiere", "feliz", "contento", "compró", "renovó".
- NEGATIVO (sentimiento < -0.3): cliente molesto, queja, deuda impaga, palabras como "furioso", "no paga", "rechazó", "perdimos", "se fue".
- NEUTRAL (-0.3 ≤ sentimiento ≤ 0.3): información factual sin carga emocional, agenda, pendientes administrativos.`;

export async function analizarSentimiento(texto: string): Promise<Sentiment> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY no configurada.");
  }
  if (!texto.trim()) {
    return { sentimiento: 0, etiqueta: "NEUTRAL" };
  }

  // nosemgrep: ai.typescript.detect-anthropic.detect-anthropic
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 200,
    system: SYSTEM_PROMPT,
    messages: [
      { role: "user", content: `Analizá el sentimiento de esta nota:\n\n${texto}` },
    ],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const fenced = text.match(/```json\s*([\s\S]+?)\s*```/);
  const payload = fenced ? fenced[1] : (text.match(/\{[\s\S]+\}/)?.[0] ?? "{}");
  return SentimentSchema.parse(JSON.parse(payload));
}
