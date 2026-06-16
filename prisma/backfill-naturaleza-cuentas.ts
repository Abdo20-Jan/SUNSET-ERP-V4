import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { CuentaCategoria, Naturaleza, PrismaClient } from "../src/generated/prisma/client";

/**
 * Backfill del campo `naturaleza` en CuentaContable.
 *
 * Regla: toda cuenta toma la naturaleza por defecto de su categoría
 * (ACTIVO/EGRESO → DEUDOR; resto → ACREEDOR), EXCEPTO las regularizadoras
 * (contra-cuentas), que tienen naturaleza opuesta y se listan explícitamente
 * en OVERRIDES por código.
 *
 * El balance ya funciona sin esto (cuenta con naturaleza null usa la naturaleza
 * por defecto de la categoría). Este script fija el valor explícito y corrige
 * las regularizadoras, cuyo signo era invertido por la lógica vieja.
 *
 * Idempotente: sólo escribe cuando el valor actual difiere del esperado.
 *
 * Uso:
 *   pnpm tsx prisma/backfill-naturaleza-cuentas.ts --dry-run
 *   pnpm tsx prisma/backfill-naturaleza-cuentas.ts
 */

const DRY_RUN = process.argv.includes("--dry-run");

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

// Regularizadoras conocidas: naturaleza OPUESTA a la de su categoría.
// Se incluyen también los códigos del plan reestructurado (RT9) aunque aún no
// existan, para que el backfill quede correcto cuando se siembren.
const OVERRIDES: Record<string, Naturaleza> = {
  // Contra-PN
  "3.2.1.03": Naturaleza.DEUDOR, // (–) Dividendos Declarados
  // Contra-activo (regularizadoras de Bienes de Uso / Intangibles)
  "1.2.1.09": Naturaleza.ACREEDOR, // (–) Depreciación Acumulada Bienes de Uso
  "1.2.2.09": Naturaleza.ACREEDOR, // (–) Amortización Acumulada Intangibles
  // Contra-ingreso (deducciones sobre ventas)
  "4.1.2.01": Naturaleza.DEUDOR, // (–) Devoluciones sobre Ventas
  "4.1.2.02": Naturaleza.DEUDOR, // (–) Bonificaciones y Descuentos sobre Ventas
};

function naturalezaDefault(categoria: CuentaCategoria): Naturaleza {
  return categoria === CuentaCategoria.ACTIVO || categoria === CuentaCategoria.EGRESO
    ? Naturaleza.DEUDOR
    : Naturaleza.ACREEDOR;
}

// Heurística para detectar regularizadoras por nombre que NO estén en OVERRIDES,
// para avisar al humano (posible regularizadora sin override → signo erróneo).
const REGULARIZADORA_HINT = /\(-\)|\(–\)|ACUMULAD|DEVOLUC|BONIFICAC|DECLARAD/i;

async function main() {
  console.log(`\n=== BACKFILL NATURALEZA CUENTAS ${DRY_RUN ? "(DRY-RUN)" : "(APLICANDO)"} ===`);

  const cuentas = await db.cuentaContable.findMany({
    orderBy: { codigo: "asc" },
    select: { codigo: true, nombre: true, categoria: true, naturaleza: true },
  });

  let actualizados = 0;
  let yaCorrectos = 0;
  let regularizadorasCorregidas = 0;
  const sospechosas: string[] = [];

  for (const c of cuentas) {
    const override = OVERRIDES[c.codigo];
    const esperada = override ?? naturalezaDefault(c.categoria);

    // Aviso: nombre con pinta de regularizadora pero sin override → revisar.
    if (!override && REGULARIZADORA_HINT.test(c.nombre)) {
      sospechosas.push(`${c.codigo} "${c.nombre}" (${c.categoria}) → quedaría ${esperada}`);
    }

    if (c.naturaleza === esperada) {
      yaCorrectos++;
      continue;
    }

    if (!DRY_RUN) {
      await db.cuentaContable.update({
        where: { codigo: c.codigo },
        data: { naturaleza: esperada },
      });
    }
    const tag = override ? " [REGULARIZADORA]" : "";
    console.log(`  →  ${c.codigo} "${c.nombre}": ${c.naturaleza ?? "null"} → ${esperada}${tag}`);
    actualizados++;
    if (override) regularizadorasCorregidas++;
  }

  console.log("\n=== RESUMEN ===");
  console.log(`  Total cuentas:            ${cuentas.length}`);
  console.log(`  Actualizadas:             ${actualizados} ${DRY_RUN ? "(estimado)" : ""}`);
  console.log(`  Regularizadoras (override): ${regularizadorasCorregidas}`);
  console.log(`  Ya correctas:             ${yaCorrectos}`);

  if (sospechosas.length > 0) {
    console.log(
      `\n⚠  ${sospechosas.length} cuenta(s) parecen regularizadoras y NO están en OVERRIDES:`,
    );
    for (const s of sospechosas) console.log(`     ${s}`);
    console.log("   → Revisar: si lo son, agregarlas a OVERRIDES antes de aplicar.");
  }

  if (DRY_RUN) console.log("\n(DRY-RUN: nada foi escrito na base.)");
}

main()
  .then(() => db.$disconnect())
  .then(() => process.exit(0))
  .catch(async (e) => {
    console.error("ERROR:", e);
    await db.$disconnect();
    process.exit(1);
  });
