import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

/**
 * PR 1.5 — Índices UNIQUE PARCIALES de ItemContenedor (Q11).
 *
 * Prisma `@@unique` no soporta cláusula WHERE, y `loteFabricacion` es
 * nullable (en Postgres NULL ≠ NULL, así que un UNIQUE normal no garante
 * unicidad cuando el lote falta). Por eso estos dos índices se crean en
 * raw SQL fuera del `db push`:
 *
 *   - cuando HAY lote: 1 fila por (contenedor, producto, lote)
 *   - cuando NO hay lote: 1 fila por (contenedor, producto)
 *
 * Idempotente (CREATE UNIQUE INDEX IF NOT EXISTS). Dry-run por defecto:
 * imprime el SQL sin ejecutarlo. Pasar `--apply` para ejecutar.
 *
 * Uso:
 *   pnpm db:partial-indexes-contenedor            # dry-run (imprime SQL)
 *   pnpm db:partial-indexes-contenedor --apply    # ejecuta
 */

const STATEMENTS: { nombre: string; sql: string }[] = [
  {
    nombre: "ItemContenedor_clp_idx",
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS "ItemContenedor_clp_idx" ON "ItemContenedor" ("contenedorId", "productoId", "loteFabricacion") WHERE "loteFabricacion" IS NOT NULL;`,
  },
  {
    nombre: "ItemContenedor_cp_null_idx",
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS "ItemContenedor_cp_null_idx" ON "ItemContenedor" ("contenedorId", "productoId") WHERE "loteFabricacion" IS NULL;`,
  },
];

async function main() {
  const apply = process.argv.includes("--apply");
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  console.log(
    apply
      ? "Aplicando índices parciales de ItemContenedor (Q11)..."
      : "DRY-RUN (sin --apply): solo imprime el SQL. Pasar --apply para ejecutar.\n",
  );

  try {
    for (const { nombre, sql } of STATEMENTS) {
      if (apply) {
        await prisma.$executeRawUnsafe(sql);
        console.log(`  ✓ ${nombre}`);
      } else {
        console.log(`  ${sql}`);
      }
    }
    if (apply) console.log("\nÍndices parciales OK (idempotente).");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
