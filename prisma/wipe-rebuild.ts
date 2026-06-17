/**
 * WIPE para el rebuild (pivot 2026-06-17) — fresh start total.
 *
 * Decisión del dueño: limpiar 100% de la base PRESERVANDO sólo el catálogo de
 * productos, los depósitos y las tablas de SISTEMA/REFERENCIA (plan de cuentas
 * RT9, login, períodos, geo/fiscal, cotizaciones, IPC, parámetros de retención,
 * cuentas bancarias y config de CRM). Se borran TODO el negocio + los maestros
 * de Clientes y Proveedores. El stock de los productos se resetea a cero.
 *
 * Seguridad:
 *  - Dry-run por defecto: imprime qué borraría y los conteos. Sólo con `--apply`
 *    ejecuta el TRUNCATE.
 *  - Pre-flight de FK: aborta si alguna tabla PRESERVADA referencia una tabla a
 *    BORRAR (un TRUNCATE sin CASCADE fallaría / con CASCADE arrastraría la
 *    preservada). Mejor abortar y revisar.
 *  - TRUNCATE de TODO el conjunto a borrar en una sola sentencia (sin CASCADE):
 *    las FK intra-conjunto se satisfacen porque todas las tablas están listadas.
 *  - Tomar el `pg_dump` ANTES de correr con `--apply` (lo hace el operador).
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

// Tablas que SOBREVIVEN (nombre de tabla = nombre de modelo; sin @@map).
const KEEP = new Set<string>([
  // Maestros que el dueño pidió preservar.
  "Producto",
  "Deposito",
  // Sistema / contabilidad.
  "User",
  "CuentaContable",
  "PeriodoContable",
  "CuentaBancaria",
  // Referencia geográfica / fiscal.
  "Provincia",
  "Localidad",
  "CodigoPostal",
  "JurisdiccionIIBB",
  "IndiceIPC",
  "ParametroRetencion",
  // Reexpresión / cotizaciones.
  "Cotizacion",
  // Config de CRM (no datos de negocio).
  "PipelineStage",
  "EmailTemplate",
  "ScoringRule",
]);

async function main() {
  const apply = process.argv.includes("--apply");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL no seteada");

  const adapter = new PrismaPg({ connectionString: url });
  const prisma = new PrismaClient({ adapter });

  try {
    const host = url.replace(/\/\/[^:]+:[^@]+@/, "//***:***@").replace(/\?.*/, "");
    console.log(`\nBase objetivo: ${host}`);
    console.log(`Modo: ${apply ? "APPLY (ejecuta TRUNCATE)" : "DRY-RUN (sólo informa)"}\n`);

    // 1) Todas las tablas base del schema public (excluye internas de Prisma "_").
    const todas = (
      await prisma.$queryRawUnsafe<{ table_name: string }[]>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
           AND table_name NOT LIKE '\\_%'
         ORDER BY table_name`,
      )
    ).map((r) => r.table_name);

    const wipe = todas.filter((t) => !KEEP.has(t));
    const keepPresentes = todas.filter((t) => KEEP.has(t));
    const keepFaltantes = [...KEEP].filter((t) => !todas.includes(t));

    if (keepFaltantes.length > 0) {
      console.log(
        `⚠️  Tablas KEEP que no existen en la base (revisar nombres): ${keepFaltantes.join(", ")}\n`,
      );
    }

    // 2) Pre-flight de FK: ninguna tabla PRESERVADA puede referenciar una a BORRAR.
    const fks = await prisma.$queryRawUnsafe<
      { referencing: string; referenced: string; constraint_name: string }[]
    >(
      `SELECT tc.table_name AS referencing, ccu.table_name AS referenced, tc.constraint_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.constraint_column_usage ccu
         ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
       WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`,
    );
    const keptHaciaWipe = fks.filter(
      (f) =>
        KEEP.has(f.referencing) && wipe.includes(f.referenced) && f.referencing !== f.referenced,
    );
    if (keptHaciaWipe.length > 0) {
      console.error("❌ ABORT: tablas PRESERVADAS referencian tablas a BORRAR (FK kept→wipe):");
      for (const f of keptHaciaWipe) {
        console.error(`   ${f.referencing} → ${f.referenced}  (${f.constraint_name})`);
      }
      console.error(
        "\nResolvé esas FK (mover la tabla a la lista de borrado o anular la FK) antes de aplicar.",
      );
      process.exitCode = 1;
      return;
    }

    // 3) Conteos.
    const conteo = async (t: string): Promise<number> => {
      const r = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*)::bigint AS n FROM "${t}"`,
      );
      return Number(r[0]?.n ?? 0);
    };

    console.log(`PRESERVA (${keepPresentes.length}):`);
    for (const t of keepPresentes) console.log(`   ✓ ${t.padEnd(26)} ${await conteo(t)} filas`);

    let totalWipe = 0;
    const conFilas: string[] = [];
    for (const t of wipe) {
      const n = await conteo(t);
      totalWipe += n;
      if (n > 0) conFilas.push(`${t} (${n})`);
    }
    console.log(`\nBORRA (${wipe.length} tablas, ${totalWipe} filas en total):`);
    console.log(`   ${wipe.join(", ")}`);
    console.log(`\n   Con datos: ${conFilas.length > 0 ? conFilas.join(", ") : "(ninguna)"}`);

    if (!apply) {
      console.log("\nDRY-RUN: nada fue modificado. Reejecutá con --apply para borrar.\n");
      return;
    }

    // 4) APPLY: TRUNCATE de todo el conjunto en una sentencia + reset de stock.
    const lista = wipe.map((t) => `"${t}"`).join(", ");
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`TRUNCATE TABLE ${lista} RESTART IDENTITY`);
      await tx.$executeRawUnsafe(`UPDATE "Producto" SET "stockActual" = 0, "costoPromedio" = 0`);
    });

    // 5) Verificación post.
    let resto = 0;
    for (const t of wipe) resto += await conteo(t);
    const prod = await conteo("Producto");
    const dep = await conteo("Deposito");
    const stockNoCero = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*)::bigint AS n FROM "Producto" WHERE "stockActual" <> 0 OR "costoPromedio" <> 0`,
    );
    console.log("\n✅ WIPE aplicado.");
    console.log(`   Filas restantes en tablas borradas: ${resto} (esperado 0)`);
    console.log(`   Producto: ${prod} filas · Deposito: ${dep} filas`);
    console.log(
      `   Productos con stock/costo ≠ 0: ${Number(stockNoCero[0]?.n ?? 0)} (esperado 0)\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
