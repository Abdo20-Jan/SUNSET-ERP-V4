import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { ITEM_DESPACHO_PARTIAL_DDL } from "./partial-indexes-despacho";

/**
 * PR schema ItemDespacho cruzado — índices UNIQUE PARCIALES + CHECK.
 *
 * `@@unique([despachoId, itemEmbarqueId])` fue REMOVIDO del model y sustituido
 * por dos índices parciales (legacy / cruzado) + un CHECK de coherencia, que
 * Prisma no puede expresar (no soporta WHERE). Por eso se crean en raw SQL
 * fuera del `db push`. Ver `partial-indexes-despacho.ts`.
 *
 * OBLIGATORIO ejecutar tras cada `prisma db push` (el push no toca estos
 * objetos porque el PSL no los representa, pero `--force-reset` o un cambio en
 * las columnas contenedorId/itemContenedorId los borra en cascada). El script
 * `db:sync` lo encadena.
 *
 * Idempotente. Dry-run por defecto; pasar `--apply` para ejecutar.
 *
 * Uso:
 *   pnpm db:partial-indexes-despacho            # dry-run (imprime SQL)
 *   pnpm db:partial-indexes-despacho --apply    # ejecuta
 */

async function main() {
  const apply = process.argv.includes("--apply");
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  console.log(
    apply
      ? "Aplicando índices parciales + CHECK de ItemDespacho..."
      : "DRY-RUN (sin --apply): solo imprime el SQL. Pasar --apply para ejecutar.\n",
  );

  try {
    for (const { nombre, sql } of ITEM_DESPACHO_PARTIAL_DDL) {
      if (apply) {
        await prisma.$executeRawUnsafe(sql);
        console.log(`  ✓ ${nombre}`);
      } else {
        console.log(`  ${sql}`);
      }
    }
    if (apply) console.log("\nÍndices parciales + CHECK OK (idempotente).");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
