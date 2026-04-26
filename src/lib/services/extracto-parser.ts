import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

export const SONNET_MODEL = "claude-sonnet-4-6";

const LineaParseadaSchema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  descripcion: z.string().min(1),
  comprobante: z.string().nullable(),
  monto: z.number(),
  saldoExtracto: z.number().nullable(),
  categoria: z.string(),
  codigoCuentaSugerida: z.string().nullable(),
  descripcionAsiento: z.string().nullable(),
  confianza: z.enum(["ALTA", "MEDIA", "BAJA"]),
  razon: z.string().nullable(),
  cuitDetectado: z.string().nullable(),
  tipoEntidad: z.enum(["CLIENTE", "PROVEEDOR", "NINGUNO"]).nullable(),
});

const ExtractoParseadoSchema = z.object({
  banco: z.string(),
  cbu: z.string().nullable(),
  numeroCuenta: z.string().nullable(),
  saldoInicial: z.number(),
  saldoFinal: z.number(),
  lineas: z.array(LineaParseadaSchema),
});

export type LineaParseada = z.infer<typeof LineaParseadaSchema>;
export type ExtractoParseado = z.infer<typeof ExtractoParseadoSchema>;

const SYSTEM_PROMPT = `Sos un parser experto de extractos bancarios argentinos (Galicia, Santander, BBVA, Macro, Provincia, Credicoop, etc.).

Recibes un PDF de extracto y devolvés JSON estructurado con cada movimiento y la cuenta contable contrapartida sugerida.

CONVENCIONES:
- Cada línea tiene UN monto signed. Positivo = crédito (entra plata). Negativo = débito (sale plata).
- Si el PDF separa columnas Débito/Crédito: Débito $X → monto = -X. Crédito $X → monto = +X.
- Anulaciones ("Anul ..."): generá línea con el signo invertido al original. razon = "Anulación de <descripcion original>".
- Saldo inicial / saldo final: extraerlos del header del PDF.
- Solo parsear movimientos de la moneda solicitada (te indico cuál abajo). Ignorá movimientos de otras monedas.
- NO inventes líneas. NO incluyas totales, encabezados, textos legales, ni filas vacías.

PLAN DE CUENTAS — REGLAS DE CLASIFICACIÓN (descripción → codigoCuentaSugerida):

A. IMPUESTOS / RETENCIONES BANCARIAS:
- "IMP. DEB. LEY 25413" / "Impuesto ley 25.413" / "IDCB" → "5.8.1.06" (IMPUESTO LEY 25413)
- "IMPUESTO DE SELLOS" / "Imp. Sellos" → "5.8.1.04"
- "IMP. ING. BRUTOS" / "Regimen recaudacion sircreb" / "Percepcion ingresos brutos" → "1.1.4.10" (PERCEPCIÓN IIBB SIRCREB)
- "PERCEP. IVA" / "Iva percepcion rg 2408" → "1.1.4.02" (PERCEPCIÓN IVA RG 2408)
- "IVA" sobre comisiones bancarias (ej "Iva 21% reg transfsc ley27743") → "1.1.4.01" (IVA CRÉDITO FISCAL)

B. COSTOS FINANCIEROS:
- "COMISION SERVICIO" / "Comision compensacion cheques" / "Comision por servicio" / "Comision echeq rechazado" / "COM. GESTION TRANSF" → "5.8.1.01" (COMISIONES BANCARIAS)
- "INTERESES SOBRE SALDOS DEUDORES" → "5.8.2.02" (INTERESES PAGADOS)

C. INVERSIONES (FCI / fondos comunes):
- "SUSCRIPCION FIMA" / "Suscripción FCI" → "1.1.6.01" (sale del banco, entra al FCI). monto negativo.
- "RESCATE FIMA" / "Rescate FCI" → "1.1.6.01" (vuelve del FCI al banco). monto positivo.

D. TRANSFERENCIAS / PAGOS:
- "TRF INMED PROVEED" + CUIT del beneficiario → tipoEntidad="PROVEEDOR", cuitDetectado=<cuit sin guiones>, codigoCuentaSugerida=null (lo resuelve el sistema). razon="Pago a proveedor — match por CUIT".
- "Credito transf online banking emp" / "Transferencia recibida" + CUIT del emisor → tipoEntidad="CLIENTE", cuitDetectado=<cuit>, codigoCuentaSugerida=null.
- "Transferencia realizada" + CUIT/persona → tipoEntidad="PROVEEDOR" si hay CUIT empresa, sino "NINGUNO" + razon="Identificar contrapartida al aprobar".
- "Debito automatico" → confianza="BAJA", codigoCuentaSugerida=null, razon="Débito automático — identificar servicio al aprobar".

E. CHEQUES (echeqs y físicos):
- "Deposito echeq otro banco 48hs" / "Deposito e-cheq" / "Deposito cheq" / "Valor al cobro" / "Cfu depecheq val cobro" → tipoEntidad="CLIENTE" si hay nombre, sino "NINGUNO". razon="Depósito de cheque — identificar cliente". confianza="MEDIA".
- "Rechazo dep echeq" / "Echeq canje rechazado" → tipoEntidad="CLIENTE" si identificable. razon="Cheque rechazado — reverso de depósito original".
- "Echeq canje interno recibido" → tipoEntidad="NINGUNO" cuando no hay info adicional. razon="ECheq canje interno — confirmar contrapartida".

F. PAGO DE IMPUESTOS A AFIP / RENTAS:
- "Pago de servicios IMP.AFIP" / "Pago AFIP" → codigoCuentaSugerida=null, confianza="BAJA". razon="Pago AFIP — identificar impuesto (IVA/Ganancias/IIBB) al aprobar".

G. INDEFINIDO:
- Si no podés clasificar: codigoCuentaSugerida=null, confianza="BAJA", razon explicando qué falta.

CONFIANZA:
- ALTA: descripción matchea exactamente una regla (impuestos, comisiones, intereses, FCI).
- MEDIA: cuit detectado pero falta confirmar entidad, o cheque sin info de cliente clara.
- BAJA: requiere input humano (pago AFIP, débito automático, descripción ambigua).

DATOS DEL HEADER (extraerlos del PDF):
- banco: nombre del banco (ej "Galicia", "Santander", "BBVA")
- cbu: CBU de la cuenta (22 dígitos, sin guiones), o null si no aparece
- numeroCuenta: número de cuenta tal como aparece (ej "0007248-5 133-4" o "760-018446/5"), o null

OUTPUT: SOLO el objeto JSON dentro de un bloque \`\`\`json ... \`\`\`. Nada más antes ni después.`;

function buildUserPrompt(banco: string | null, moneda: "ARS" | "USD"): string {
  const hint = banco
    ? `Banco esperado: ${banco}.`
    : `Detectá el banco a partir del header del PDF.`;
  return `${hint} Moneda a parsear: ${moneda}.

Devolvé el JSON con todas las líneas del extracto en orden cronológico, con las claves: banco, cbu, numeroCuenta, saldoInicial, saldoFinal, lineas[]. Cada línea: fecha (YYYY-MM-DD), descripcion (string), comprobante (string|null), monto (number signed), saldoExtracto (number|null), categoria (tag corto tipo "IMPUESTO_CHEQUE", "COMISION_BANCARIA", "TRANSFERENCIA_EMITIDA", etc), codigoCuentaSugerida (string|null), descripcionAsiento (string|null), confianza (ALTA|MEDIA|BAJA), razon (string|null), cuitDetectado (string sin guiones | null), tipoEntidad (CLIENTE|PROVEEDOR|NINGUNO|null).`;
}

function extractJsonBlock(text: string): string {
  const fenced = text.match(/```json\s*([\s\S]+?)\s*```/);
  if (fenced) return fenced[1];
  const fencedAny = text.match(/```\s*([\s\S]+?)\s*```/);
  if (fencedAny) return fencedAny[1];
  const obj = text.match(/(\{[\s\S]+\})/);
  if (obj) return obj[1];
  throw new Error("No se encontró bloque JSON en la respuesta del modelo.");
}

export async function parsearExtractoPDF(opts: {
  pdfBase64: string;
  banco: string | null;
  moneda: "ARS" | "USD";
}): Promise<ExtractoParseado> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY no configurada. Agregar la variable en .env (local) y en Vercel (producción).",
    );
  }

  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: SONNET_MODEL,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: opts.pdfBase64,
            },
          },
          {
            type: "text",
            text: buildUserPrompt(opts.banco, opts.moneda),
          },
        ],
      },
    ],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  if (!text.trim()) {
    throw new Error("El modelo no devolvió contenido de texto.");
  }

  const json = extractJsonBlock(text);
  const parsed = JSON.parse(json);
  return ExtractoParseadoSchema.parse(parsed);
}
