"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/lib/db";
import { requireCrmAuth } from "@/lib/actions/_crm-helpers";
import { parseCsv, type CsvRow } from "@/lib/services/crm/csv-parser";
import { LeadEstado, LeadFuente, Prisma } from "@/generated/prisma/client";

type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

const HEADERS_VALIDOS = [
  "nombre",
  "empresa",
  "cuit",
  "email",
  "telefono",
  "fuente",
  "estado",
  "notas",
] as const;

const HEADERS_OBRIGATORIOS = ["nombre"] as const;

const importOptsSchema = z.object({
  dryRun: z.boolean().default(false),
  dedupBy: z.enum(["cuit", "email", "ninguno"]).default("ninguno"),
});

export type ImportarLeadsCsvOpts = z.input<typeof importOptsSchema>;

export type ImportLeadError = { linha: number; mensaje: string };

export type ImportLeadResult = {
  total: number;
  insertados: number;
  ignorados: number;
  errores: ImportLeadError[];
};

const nullableStr = z
  .string()
  .optional()
  .transform((v) => (v && v.trim().length > 0 ? v.trim() : null));

const csvLeadSchema = z.object({
  nombre: z.string().trim().min(1, "El nombre es obligatorio."),
  empresa: nullableStr,
  cuit: nullableStr,
  email: nullableStr.refine(
    (v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
    "Email inválido.",
  ),
  telefono: nullableStr,
  fuente: z.nativeEnum(LeadFuente).default(LeadFuente.ORGANICO),
  estado: z.nativeEnum(LeadEstado).default(LeadEstado.NUEVO),
  notas: nullableStr,
});

type CsvLeadInput = z.input<typeof csvLeadSchema>;
type CsvLeadOutput = z.output<typeof csvLeadSchema>;

function rowToInput(row: CsvRow): CsvLeadInput {
  return {
    nombre: row.nombre ?? "",
    empresa: row.empresa,
    cuit: row.cuit,
    email: row.email,
    telefono: row.telefono,
    fuente: (row.fuente?.length ?? 0) > 0 ? (row.fuente as LeadFuente) : undefined,
    estado: (row.estado?.length ?? 0) > 0 ? (row.estado as LeadEstado) : undefined,
    notas: row.notas,
  };
}

type ValidatedRow = { linha: number; data: CsvLeadOutput };

function validarRows(rows: CsvRow[]): {
  validas: ValidatedRow[];
  errores: ImportLeadError[];
} {
  const validas: ValidatedRow[] = [];
  const errores: ImportLeadError[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const linha = i + 2; // +1 (header) +1 (1-indexed)
    const row = rows[i];
    if (row === undefined) continue;
    const parsed = csvLeadSchema.safeParse(rowToInput(row));
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      errores.push({ linha, mensaje: first?.message ?? "Datos inválidos." });
      continue;
    }
    validas.push({ linha, data: parsed.data });
  }
  return { validas, errores };
}

async function buscarValoresExistentes(
  dedupBy: "cuit" | "email",
  valores: string[],
): Promise<Set<string>> {
  if (dedupBy === "cuit") {
    const rows = await db.lead.findMany({
      where: { cuit: { in: valores } },
      select: { cuit: true },
    });
    return new Set(rows.map((r) => r.cuit).filter((v): v is string => v !== null));
  }
  const rows = await db.lead.findMany({
    where: { email: { in: valores } },
    select: { email: true },
  });
  return new Set(rows.map((r) => r.email).filter((v): v is string => v !== null));
}

async function aplicarDedup(
  validas: ValidatedRow[],
  dedupBy: "cuit" | "email" | "ninguno",
): Promise<{ insertaveis: ValidatedRow[]; ignoradas: ImportLeadError[] }> {
  if (dedupBy === "ninguno") {
    return { insertaveis: validas, ignoradas: [] };
  }
  const valoresAVerificar = validas
    .map((v) => v.data[dedupBy])
    .filter((v): v is string => v !== null && v.length > 0);
  if (valoresAVerificar.length === 0) {
    return { insertaveis: validas, ignoradas: [] };
  }
  const setExistentes = await buscarValoresExistentes(dedupBy, valoresAVerificar);
  const insertaveis: ValidatedRow[] = [];
  const ignoradas: ImportLeadError[] = [];
  for (const row of validas) {
    const valor = row.data[dedupBy];
    if (valor && setExistentes.has(valor)) {
      ignoradas.push({
        linha: row.linha,
        mensaje: `Ya existe lead con ${dedupBy}=${valor}.`,
      });
    } else {
      insertaveis.push(row);
    }
  }
  return { insertaveis, ignoradas };
}

async function inserirEmChunks(rows: ValidatedRow[], ownerId: string): Promise<number> {
  const CHUNK_SIZE = 500;
  let total = 0;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const data: Prisma.LeadCreateManyInput[] = chunk.map((r) => ({
      ...r.data,
      ownerId,
    }));
    const created = await db.lead.createMany({ data });
    total += created.count;
  }
  return total;
}

function detectarHeadersInvalidos(headers: string[]): string[] {
  return headers.filter((h) => !HEADERS_VALIDOS.includes(h as (typeof HEADERS_VALIDOS)[number]));
}

function checarHeadersObrigatorios(headers: string[]): string | null {
  for (const obrigatorio of HEADERS_OBRIGATORIOS) {
    if (!headers.includes(obrigatorio)) {
      return `Cabecera CSV debe incluir "${obrigatorio}".`;
    }
  }
  return null;
}

type ParsedInputs = {
  csv: Extract<ReturnType<typeof parseCsv>, { ok: true }>;
  opts: z.output<typeof importOptsSchema>;
  aviso: ImportLeadError[];
};

function parseInputs(
  csvText: string,
  opts: ImportarLeadsCsvOpts,
): { ok: true; data: ParsedInputs } | { ok: false; error: string } {
  const parsedOpts = importOptsSchema.safeParse(opts);
  if (!parsedOpts.success) {
    const first = parsedOpts.error.issues[0];
    return { ok: false, error: first?.message ?? "Opciones inválidas." };
  }
  if (typeof csvText !== "string" || csvText.trim().length === 0) {
    return { ok: false, error: "CSV vacío." };
  }
  const csv = parseCsv(csvText);
  if (!csv.ok) return { ok: false, error: csv.error };
  const headerError = checarHeadersObrigatorios(csv.headers);
  if (headerError) return { ok: false, error: headerError };
  const headersInvalidos = detectarHeadersInvalidos(csv.headers);
  const aviso: ImportLeadError[] =
    headersInvalidos.length > 0
      ? [{ linha: 1, mensaje: `Cabeceras ignoradas: ${headersInvalidos.join(", ")}.` }]
      : [];
  return { ok: true, data: { csv, opts: parsedOpts.data, aviso } };
}

async function executarImport(inputs: ParsedInputs, ownerId: string): Promise<ImportLeadResult> {
  const { csv, opts, aviso } = inputs;
  const { validas, errores } = validarRows(csv.rows);
  const { insertaveis, ignoradas } = await aplicarDedup(validas, opts.dedupBy);
  const erroresFinal = [...aviso, ...errores, ...ignoradas];
  const baseResult = {
    total: csv.rows.length,
    ignorados: ignoradas.length,
    errores: erroresFinal,
  };
  if (opts.dryRun) {
    return { ...baseResult, insertados: insertaveis.length };
  }
  const insertados = await inserirEmChunks(insertaveis, ownerId);
  revalidatePath("/crm/leads");
  revalidatePath("/crm");
  return { ...baseResult, insertados };
}

export async function importarLeadsCsvAction(
  csvText: string,
  opts: ImportarLeadsCsvOpts,
): Promise<ActionResult<ImportLeadResult>> {
  const guard = await requireCrmAuth();
  if (!guard.ok) return guard;
  const inputs = parseInputs(csvText, opts);
  if (!inputs.ok) return inputs;
  try {
    const data = await executarImport(inputs.data, guard.userId);
    return { ok: true, data };
  } catch (err) {
    console.error("importarLeadsCsvAction failed", err);
    return { ok: false, error: "Error inesperado al importar leads." };
  }
}
