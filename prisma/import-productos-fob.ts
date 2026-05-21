import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { z } from "zod";
import { Prisma, PrismaClient } from "../src/generated/prisma/client";

/**
 * Importa la lista FOB de fábrica (prisma/data/productos-fob.json) al maestro
 * de Productos. Escopo: PCR/TBR/SUV/LTR/UHP (1.053 ítems).
 *
 * Estrategia (idempotente):
 *  1. Los 9 productos ya cargados (nomenclatura comercial) se ESTANDARIZAN al
 *     formato de la planilla: codigo→ID numérico, nombre/marca de la planilla,
 *     +categoria/peso/40hc. Se PRESERVAN precioVenta, stockActual, costoPromedio
 *     y todas las relaciones (ventas, embarques, movimientos) porque las FK
 *     apuntan al `id` (uuid), no al `codigo`.
 *  2. El resto se inserta con createMany({ skipDuplicates }); los IDs ya usados
 *     por los 9 estandarizados se saltan automáticamente.
 *
 * Uso:
 *   pnpm tsx prisma/import-productos-fob.ts --dry-run   # no escribe, solo reporta
 *   pnpm tsx prisma/import-productos-fob.ts             # aplica
 */

const DRY_RUN = process.argv.includes("--dry-run");
const DATA_PATH = resolve(__dirname, "data", "productos-fob.json");
const CHUNK_SIZE = 500;

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

// Mapa de estandarización validado con el usuario: codigo actual → ID planilla.
const MATCH_9: Record<string, string> = {
  "295 ROBUSTO A2": "6704",
  "295 ECOPLUS C1": "6525",
  "295 ECOPLUS A2": "8022",
  "295 CURVE PLUS C1": "5549",
  "295 CURVE PLUS": "3605",
  "275 ECOPLUS A3": "20434",
  "295 TRANS FLEET Z1": "17302",
  "295 XCURVE": "4376",
  "295 XFORZA": "1975",
};

const itemSchema = z.object({
  codigo: z.string().trim().min(1),
  nombre: z.string().trim().min(1),
  marca: z.string().trim().min(1).nullable(),
  categoria: z.string().trim().min(1).nullable(),
  medida: z.string().trim().min(1).nullable(),
  modelo: z.string().trim().min(1).nullable(),
  pesoNetoKg: z.number().positive().nullable(),
  unidadesContenedor40hc: z.number().int().positive().nullable(),
  hoja: z.string().optional(),
});
type Item = z.infer<typeof itemSchema>;

function toCreateInput(it: Item): Prisma.ProductoCreateManyInput {
  return {
    codigo: it.codigo.toUpperCase(),
    nombre: it.nombre,
    marca: it.marca,
    categoria: it.categoria,
    medida: it.medida,
    modelo: it.modelo,
    pesoNetoKg: it.pesoNetoKg ?? null,
    unidadesContenedor40hc: it.unidadesContenedor40hc ?? null,
    // unidad/precioVenta/diePorcentaje/stock*/activo quedan en sus defaults.
  };
}

async function main() {
  console.log(`\n=== IMPORT LISTA FOB ${DRY_RUN ? "(DRY-RUN)" : "(APLICANDO)"} ===`);

  const raw = JSON.parse(readFileSync(DATA_PATH, "utf-8")) as unknown[];
  const errores: { codigo: string; mensaje: string }[] = [];
  const items: Item[] = [];
  const seen = new Set<string>();

  for (const row of raw) {
    const parsed = itemSchema.safeParse(row);
    if (!parsed.success) {
      const codigo = (row as { codigo?: string })?.codigo ?? "?";
      errores.push({ codigo, mensaje: parsed.error.issues.map((i) => i.message).join("; ") });
      continue;
    }
    const cod = parsed.data.codigo.toUpperCase();
    if (seen.has(cod)) {
      errores.push({ codigo: cod, mensaje: "código duplicado en el JSON" });
      continue;
    }
    seen.add(cod);
    items.push(parsed.data);
  }

  // 1) Estandarizar los 9 existentes (update preservando precio/stock/relaciones).
  const idsEstandarizados = new Set(Object.values(MATCH_9).map((v) => v.toUpperCase()));
  const byCodigo = new Map(items.map((it) => [it.codigo.toUpperCase(), it]));
  let actualizados = 0;
  const updateLog: string[] = [];

  for (const [codigoActual, idPlanilla] of Object.entries(MATCH_9)) {
    const fobItem = byCodigo.get(idPlanilla.toUpperCase());
    if (!fobItem) {
      errores.push({ codigo: codigoActual, mensaje: `ID planilla ${idPlanilla} no está en el JSON` });
      continue;
    }
    const existente = await db.producto.findUnique({ where: { codigo: codigoActual } });
    if (!existente) {
      updateLog.push(`  (omitido) ${codigoActual}: no existe en la base`);
      continue;
    }
    updateLog.push(`  ${codigoActual} → ${idPlanilla}  «${fobItem.nombre}»  [${fobItem.marca}]`);
    if (!DRY_RUN) {
      await db.producto.update({
        where: { codigo: codigoActual },
        data: {
          codigo: idPlanilla.toUpperCase(),
          nombre: fobItem.nombre,
          marca: fobItem.marca,
          categoria: fobItem.categoria,
          medida: fobItem.medida,
          modelo: fobItem.modelo,
          pesoNetoKg: fobItem.pesoNetoKg ?? null,
          unidadesContenedor40hc: fobItem.unidadesContenedor40hc ?? null,
          // precioVenta / stockActual / costoPromedio NO se tocan.
        },
      });
    }
    actualizados++;
  }

  console.log(`\n[1] Estandarización de existentes (${actualizados}):`);
  updateLog.forEach((l) => console.log(l));

  // 2) Insertar el resto (saltando los IDs ya usados por los 9).
  const paraInsertar = items.filter((it) => !idsEstandarizados.has(it.codigo.toUpperCase()));
  let insertados = 0;
  for (let i = 0; i < paraInsertar.length; i += CHUNK_SIZE) {
    const chunk = paraInsertar.slice(i, i + CHUNK_SIZE).map(toCreateInput);
    if (!DRY_RUN) {
      const res = await db.producto.createMany({ data: chunk, skipDuplicates: true });
      insertados += res.count;
    } else {
      insertados += chunk.length;
    }
  }

  console.log(`\n[2] Inserción masiva: ${insertados} ${DRY_RUN ? "(estimado)" : "insertados"}`);
  console.log(`\n=== RESUMEN ===`);
  console.log(`  JSON válidos:      ${items.length}`);
  console.log(`  Estandarizados:    ${actualizados}`);
  console.log(`  Insertados:        ${insertados}`);
  console.log(`  Errores:           ${errores.length}`);
  if (errores.length) {
    console.log("  Detalle de errores (máx 20):");
    errores.slice(0, 20).forEach((e) => console.log(`    [${e.codigo}] ${e.mensaje}`));
  }
  if (DRY_RUN) console.log("\n(DRY-RUN: no se escribió nada en la base.)");
}

main()
  .then(() => db.$disconnect())
  .then(() => process.exit(0))
  .catch(async (e) => {
    console.error("ERROR:", e);
    await db.$disconnect();
    process.exit(1);
  });
