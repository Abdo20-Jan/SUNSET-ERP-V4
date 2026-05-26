/**
 * EXCLUSÃO DESTRUTIVA dos embarques AR-251223-036CN e AR-251020-007CN
 * e TODOS os artefatos relacionados (asientos, costos, despachos, stock).
 *
 * IMPORTANTE: operação irreversível em prod. Sempre rodar dry-run antes.
 *
 * Inventário (de diag-embarques-target.ts):
 *
 *   AR-251223-036CN (252 ROBUSTO A2):
 *   - 1 ItemEmbarque (#28)
 *   - 5 EmbarqueCostos (#122-126) — TRP, TERMINAL 7, TP LOG, CMA-CGM×2
 *   - 1 Despacho AR-251223-036CN-D1 (asiento #13 ANULADO)
 *   - Asientos: #13 ANULADO, #47 ANULADO ZP, #48-52 CONTABILIZADO costos
 *   - Stock: ROBUSTO A2 ZPA=0, NACIONAL=100 (vamos eliminar TUDO)
 *   - 1 Transferencia T-FIX-AR-251223-036CN-... (ZPA→NACIONAL do fix-robusto)
 *   - 3 MovimientoStock (1 INGRESO + 2 TRANSFERENCIA)
 *
 *   AR-251020-007CN (250 ECOPLUS C1):
 *   - 1 ItemEmbarque (#27)
 *   - 5 EmbarqueCostos (#117-121)
 *   - Asientos: #37 ZP CONTABILIZADO + #42-46 costos + 22 órfãos (race)
 *   - Stock: ECOPLUS C1 NACIONAL=500 (NÃO mexer — é de outros embarques)
 *   - 0 movimientoStock vinculados (embarque ainda em ZONA_PRIMARIA)
 *
 * Ordem de exclusão (FKs):
 *   1. MovimientoStock (3 do ROBUSTO A2)
 *   2. Transferencia (1 do ROBUSTO A2)
 *   3. StockPorDeposito (2 do ROBUSTO A2)
 *   4. AplicacionPagoEmbarqueCosto WHERE embarqueCostoId IN (...) — 0 rows
 *   5. Embarque (cascade: items, costos, lineas costo, despachos, itemDespachos)
 *   6. LineaAsiento WHERE asientoId IN (todos linkados + órfãos)
 *   7. Asiento (todos)
 *
 * Uso:
 *   pnpm tsx prisma/fix-eliminar-embarques-target.ts            # dry-run
 *   pnpm tsx prisma/fix-eliminar-embarques-target.ts --apply    # aplica
 */
import { config as dotenvConfig } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

dotenvConfig({ path: ".env.local" });
dotenvConfig({ path: ".env" });

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const APPLY = process.argv.includes("--apply");

const TARGETS = ["AR-251223-036CN", "AR-251020-007CN"];
const PRODUCTO_ROBUSTO = "295 ROBUSTO A2";

async function inventory() {
  const embarques = await prisma.embarque.findMany({
    where: { codigo: { in: TARGETS } },
    include: {
      items: { select: { id: true, productoId: true } },
      costos: { select: { id: true, asientoId: true } },
      despachos: {
        include: { items: { select: { id: true } }, transferencias: { select: { id: true } } },
      },
    },
  });

  // Coletar todos asientoIds dos artefactos
  const asientoIdsLinkados = new Set<string>();
  for (const e of embarques) {
    if (e.asientoId) asientoIdsLinkados.add(e.asientoId);
    if (e.asientoZonaPrimariaId) asientoIdsLinkados.add(e.asientoZonaPrimariaId);
    for (const c of e.costos) {
      if (c.asientoId) asientoIdsLinkados.add(c.asientoId);
    }
    for (const d of e.despachos) {
      if (d.asientoId) asientoIdsLinkados.add(d.asientoId);
    }
  }

  // Detectar órfãos por descripção
  const orfaos = await prisma.asiento.findMany({
    where: {
      OR: TARGETS.map((codigo) => ({ descripcion: { contains: codigo } })),
      id: { notIn: Array.from(asientoIdsLinkados) },
    },
    select: { id: true, numero: true, estado: true, descripcion: true },
  });

  // Stock + movimientoStock + Transferencia do ROBUSTO A2
  const productoRobusto = await prisma.producto.findFirst({
    where: { codigo: PRODUCTO_ROBUSTO },
    select: { id: true },
  });
  if (!productoRobusto) throw new Error(`Producto ${PRODUCTO_ROBUSTO} no encontrado`);

  const movsRobusto = await prisma.movimientoStock.findMany({
    where: { productoId: productoRobusto.id },
    select: { id: true, tipo: true, cantidad: true },
  });
  const transfsRobusto = await prisma.transferencia.findMany({
    where: { productoId: productoRobusto.id },
    select: { id: true, numero: true },
  });
  const stocksRobusto = await prisma.stockPorDeposito.findMany({
    where: { productoId: productoRobusto.id },
    select: { id: true, depositoId: true, cantidadFisica: true },
  });

  return {
    embarques,
    asientoIdsLinkados: Array.from(asientoIdsLinkados),
    orfaos,
    productoRobusto,
    movsRobusto,
    transfsRobusto,
    stocksRobusto,
  };
}

async function main() {
  console.log(`\n=== Eliminación destructiva ${TARGETS.join(" + ")} ===`);
  console.log(`Modo: ${APPLY ? "APPLY (cambios reales)" : "DRY-RUN (sin cambios)"}\n`);

  const inv = await inventory();

  // Imprimir inventário
  console.log(`Embarques a eliminar      : ${inv.embarques.length}`);
  console.log(`Asientos linkados via FK  : ${inv.asientoIdsLinkados.length}`);
  console.log(`Asientos órfãos (descr)   : ${inv.orfaos.length}`);
  console.log(`ROBUSTO A2 movsStock      : ${inv.movsRobusto.length}`);
  console.log(`ROBUSTO A2 Transferencias : ${inv.transfsRobusto.length}`);
  console.log(`ROBUSTO A2 StockPorDeposito: ${inv.stocksRobusto.length}`);

  const todosAsientoIds = [...inv.asientoIdsLinkados, ...inv.orfaos.map((o) => o.id)];
  const lineasAsientos = await prisma.lineaAsiento.count({
    where: { asientoId: { in: todosAsientoIds } },
  });
  console.log(`Total LineaAsiento a eliminar: ${lineasAsientos}`);

  const aplicacionesPago = await prisma.aplicacionPagoEmbarqueCosto.count({
    where: { lineaAsiento: { asientoId: { in: todosAsientoIds } } },
  });
  console.log(`AplicacionPago vinculadas (Cascade via LineaAsiento): ${aplicacionesPago}`);

  if (!APPLY) {
    console.log(`\n--- DRY-RUN — rodar con --apply para eliminar. ---`);
    return;
  }

  console.log(`\n--- APLICANDO ---`);

  await prisma.$transaction(
    async (tx) => {
      // 1. Stock 295 ROBUSTO A2
      console.log(`\n[1/6] Stock 295 ROBUSTO A2`);
      const delMovs = await tx.movimientoStock.deleteMany({
        where: { productoId: inv.productoRobusto.id },
      });
      console.log(`  MovimientoStock eliminados: ${delMovs.count}`);

      const delTransfs = await tx.transferencia.deleteMany({
        where: { productoId: inv.productoRobusto.id },
      });
      console.log(`  Transferencia eliminadas: ${delTransfs.count}`);

      const delStocks = await tx.stockPorDeposito.deleteMany({
        where: { productoId: inv.productoRobusto.id },
      });
      console.log(`  StockPorDeposito eliminados: ${delStocks.count}`);

      // 2. Desvincular Embarque.asientoId / asientoZonaPrimariaId
      console.log(`\n[2/6] Desvincular Embarque ↔ Asiento`);
      const embIds = inv.embarques.map((e) => e.id);
      const upd = await tx.embarque.updateMany({
        where: { id: { in: embIds } },
        data: { asientoId: null, asientoZonaPrimariaId: null },
      });
      console.log(`  Embarques actualizados: ${upd.count}`);

      // 3. Desvincular EmbarqueCosto.asientoId e Despacho.asientoId
      const costoIds = inv.embarques.flatMap((e) => e.costos.map((c) => c.id));
      if (costoIds.length > 0) {
        await tx.embarqueCosto.updateMany({
          where: { id: { in: costoIds } },
          data: { asientoId: null },
        });
      }
      const despachoIds = inv.embarques.flatMap((e) => e.despachos.map((d) => d.id));
      if (despachoIds.length > 0) {
        await tx.despacho.updateMany({
          where: { id: { in: despachoIds } },
          data: { asientoId: null },
        });
      }

      // 3.5. Eliminar Despachos explicitamente PRIMERO (cascade: ItemDespacho,
      // VepDespacho; SetNull: Transferencia.despachoId, EmbarqueCosto.despachoId).
      // Necesario porque ItemDespacho.itemEmbarqueId es Restrict, lo que bloquea
      // el cascade de ItemEmbarque al borrar Embarque.
      console.log(`\n[3/6] Eliminar Despachos explicitamente`);
      if (despachoIds.length > 0) {
        const delDespachos = await tx.despacho.deleteMany({
          where: { id: { in: despachoIds } },
        });
        console.log(`  Despachos eliminados: ${delDespachos.count}`);
      } else {
        console.log(`  (sin despachos)`);
      }

      // 4. Eliminar Embarques (cascade: items, costos, lineas costos)
      console.log(`\n[4/6] Eliminar Embarques (cascade items/costos)`);
      const delEmbs = await tx.embarque.deleteMany({ where: { id: { in: embIds } } });
      console.log(`  Embarques eliminados: ${delEmbs.count}`);

      // 5. Eliminar LineaAsiento (onDelete: Restrict no Asiento)
      console.log(`\n[5/6] Eliminar LineaAsiento`);
      const delLineas = await tx.lineaAsiento.deleteMany({
        where: { asientoId: { in: todosAsientoIds } },
      });
      console.log(`  LineaAsiento eliminadas: ${delLineas.count}`);

      // 6. Eliminar Asientos
      console.log(`\n[6/6] Eliminar Asientos`);
      const delAsientos = await tx.asiento.deleteMany({
        where: { id: { in: todosAsientoIds } },
      });
      console.log(`  Asientos eliminados: ${delAsientos.count}`);
    },
    { timeout: 60_000, maxWait: 10_000 },
  );

  console.log(`\n✓ Exclusión completada.`);
}

main()
  .catch((e) => {
    console.error(`\n✗ Error: ${e instanceof Error ? e.message : String(e)}`);
    if (e instanceof Error && e.stack) console.error(e.stack);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
