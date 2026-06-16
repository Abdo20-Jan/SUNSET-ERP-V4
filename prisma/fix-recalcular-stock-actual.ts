/**
 * Recalcula `Producto.stockActual` y `Producto.costoPromedio` (campos
 * legacy) a partir de los MovimientoStock actuales del producto. Usa el
 * MISMO replay que el runtime — `replayStockNacional` de
 * src/lib/services/stock-recalc.ts (sin 'server-only', importable desde tsx) —
 * para no divergir (antes este script perdía las TRANSFERENCIAS).
 *
 * Útil cuando se eliminan ItemEmbarque/MovimientoStock históricos pero
 * los campos agregados quedan stale.
 *
 * Uso:
 *   pnpm tsx prisma/fix-recalcular-stock-actual.ts <codigo>            # dry-run
 *   pnpm tsx prisma/fix-recalcular-stock-actual.ts <codigo> --apply    # aplica
 *
 * Sin argumento <codigo>: recalcula TODOS los productos activos.
 */
import { config as dotenvConfig } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { Decimal } from "decimal.js";
import { replayStockNacional } from "../src/lib/services/stock-recalc";
import { PrismaClient } from "../src/generated/prisma/client";

dotenvConfig({ path: ".env.local" });
dotenvConfig({ path: ".env" });

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const codigoFiltro = args.find((a) => !a.startsWith("--"));

async function main() {
  console.log(`Modo: ${APPLY ? "APPLY" : "DRY-RUN"}\n`);

  const productos = await prisma.producto.findMany({
    where: codigoFiltro ? { codigo: codigoFiltro } : { activo: true },
    select: { id: true, codigo: true, stockActual: true, costoPromedio: true },
  });

  if (productos.length === 0) {
    console.log(codigoFiltro ? `Producto ${codigoFiltro} no encontrado.` : "Sin productos.");
    return;
  }

  let cambios = 0;
  let aplicados = 0;
  for (const p of productos) {
    const movs = await prisma.movimientoStock.findMany({
      where: { productoId: p.id },
      orderBy: [{ fecha: "asc" }, { id: "asc" }],
      select: {
        tipo: true,
        cantidad: true,
        costoUnitario: true,
        deposito: { select: { tipo: true } },
      },
    });

    const { stock, promedio } = replayStockNacional(
      movs.map((m) => ({
        tipo: m.tipo,
        cantidad: m.cantidad,
        costoUnitario: m.costoUnitario,
        depositoTipo: m.deposito.tipo,
      })),
    );

    const promedioFinal = promedio.toDecimalPlaces(2);
    const stockAtual = p.stockActual;
    const promedioAtual = new Decimal(p.costoPromedio.toString());

    const stockDiff = stock !== stockAtual;
    const promedioDiff = !promedioFinal.eq(promedioAtual);

    if (!stockDiff && !promedioDiff) continue;
    cambios++;

    console.log(
      `${p.codigo.padEnd(20)} stockActual: ${stockAtual} → ${stock} | costoProm: ${promedioAtual.toFixed(2)} → ${promedioFinal.toFixed(2)} (${movs.length} movs)`,
    );

    if (APPLY) {
      await prisma.producto.update({
        where: { id: p.id },
        data: { stockActual: stock, costoPromedio: promedioFinal.toFixed(2) },
      });
      aplicados++;
    }
  }

  console.log(`\nTotal con diferencia: ${cambios}`);
  if (APPLY) console.log(`Aplicados: ${aplicados}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
