import type {
  ActividadTipo,
  LeadEstado,
  LeadFuente,
  Moneda,
  OportunidadEstado,
} from "@/generated/prisma/client";

export const LEAD_ESTADOS: readonly LeadEstado[] = [
  "NUEVO",
  "CONTACTADO",
  "CALIFICADO",
  "DESCALIFICADO",
  "CONVERTIDO",
];

export const LEAD_FUENTES: readonly LeadFuente[] = [
  "ORGANICO",
  "REFERIDO",
  "EVENTO",
  "ANUNCIO",
  "LINKEDIN",
  "MERCADOLIBRE",
  "FERIA",
  "OTRO",
];

export const MONEDAS: readonly Moneda[] = ["ARS", "USD"];

export const OPORTUNIDAD_ESTADOS: readonly OportunidadEstado[] = [
  "ABIERTA",
  "GANADA",
  "PERDIDA",
  "EN_PAUSA",
];

export const ACTIVIDAD_TIPOS: readonly ActividadTipo[] = [
  "LLAMADA",
  "EMAIL",
  "REUNION",
  "NOTA",
  "TAREA",
  "WHATSAPP",
];
