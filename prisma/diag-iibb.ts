// Diagnóstico IIBB: para cada operación con iibb > 0 (Compra/Venta/Gasto/
// Embarque/EmbarqueCosto/Despacho/GastoFijo), verifica que el asiento
// contabilizado tenga una línea correspondiente sobre alguna cuenta IIBB
// (1.1.4.06, 1.1.4.10, 1.1.4.11, 2.1.3.02). Reporta huecos.
//
// Uso:
//   vercel env pull --environment production .env.railway.tmp --yes
//   set -a && source .env.railway.tmp && set +a
//   pnpm tsx prisma/diag-iibb.ts
//   rm -f .env.railway.tmp

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const IIBB_CODIGOS = ["1.1.4.06", "1.1.4.10", "1.1.4.11", "2.1.3.02"];

async function main() {
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });

  console.log("\n=== 1. Cuentas IIBB en plan ===");
  const cuentas = await db.cuentaContable.findMany({
    where: { codigo: { in: IIBB_CODIGOS } },
    select: { id: true, codigo: true, nombre: true, categoria: true, activa: true, tipo: true },
  });
  console.table(cuentas);

  const cuentaIdsIibb = cuentas.map((c) => c.id);
  if (cuentaIdsIibb.length === 0) {
    console.log("⚠️  Ninguna cuenta IIBB existe en el plan.");
  }

  console.log("\n=== 2. Líneas en cuentas IIBB (asientos contabilizados) ===");
  const lineasIibb = await db.lineaAsiento.findMany({
    where: {
      cuentaId: { in: cuentaIdsIibb },
      asiento: { estado: "CONTABILIZADO" },
    },
    select: {
      id: true,
      cuentaId: true,
      debe: true,
      haber: true,
      asiento: { select: { id: true, numero: true, descripcion: true, origen: true } },
    },
  });
  console.log(`Total líneas IIBB contabilizadas: ${lineasIibb.length}`);
  for (const l of lineasIibb.slice(0, 20)) {
    const cuenta = cuentas.find((c) => c.id === l.cuentaId);
    console.log(
      `  Asiento #${l.asiento.numero} [${l.asiento.origen}] ${cuenta?.codigo} debe=${l.debe} haber=${l.haber} — ${l.asiento.descripcion}`,
    );
  }
  if (lineasIibb.length > 20) console.log(`  ... +${lineasIibb.length - 20} más`);

  console.log("\n=== 3. Compras con iibb > 0 ===");
  const compras = await db.compra.findMany({
    where: { iibb: { gt: 0 }, asientoId: { not: null } },
    select: { id: true, numero: true, iibb: true, asientoId: true },
  });
  for (const c of compras) {
    const tieneLinea = lineasIibb.some((l) => l.asiento.id === c.asientoId);
    console.log(
      `  ${tieneLinea ? "✓" : "✗"} Compra ${c.numero} iibb=${c.iibb} asiento=${c.asientoId}`,
    );
  }
  if (compras.length === 0) console.log("  (ninguna)");

  console.log("\n=== 4. Ventas con iibb > 0 ===");
  const ventas = await db.venta.findMany({
    where: { iibb: { gt: 0 }, asientoId: { not: null } },
    select: { id: true, numero: true, iibb: true, asientoId: true },
  });
  for (const v of ventas) {
    const tieneLinea = lineasIibb.some((l) => l.asiento.id === v.asientoId);
    console.log(
      `  ${tieneLinea ? "✓" : "✗"} Venta ${v.numero} iibb=${v.iibb} asiento=${v.asientoId}`,
    );
  }
  if (ventas.length === 0) console.log("  (ninguna)");

  console.log("\n=== 5. Gastos con iibb > 0 ===");
  const gastos = await db.gasto.findMany({
    where: { iibb: { gt: 0 }, asientoId: { not: null } },
    select: { id: true, numero: true, iibb: true, asientoId: true },
  });
  for (const g of gastos) {
    const tieneLinea = lineasIibb.some((l) => l.asiento.id === g.asientoId);
    console.log(
      `  ${tieneLinea ? "✓" : "✗"} Gasto ${g.numero} iibb=${g.iibb} asiento=${g.asientoId}`,
    );
  }
  if (gastos.length === 0) console.log("  (ninguno)");

  console.log("\n=== 6. EmbarqueCosto con iibb > 0 (facturas locales) ===");
  const costos = await db.embarqueCosto.findMany({
    where: { iibb: { gt: 0 } },
    select: {
      id: true,
      facturaNumero: true,
      iibb: true,
      momento: true,
      embarqueId: true,
      embarque: {
        select: {
          codigo: true,
          asientoId: true,
          asientoZonaPrimariaId: true,
          estado: true,
        },
      },
    },
  });
  for (const c of costos) {
    const asientosRelevantes = [c.embarque.asientoId, c.embarque.asientoZonaPrimariaId].filter(
      Boolean,
    );
    const tieneLinea = lineasIibb.some(
      (l) => l.asiento.id !== null && asientosRelevantes.includes(l.asiento.id as string),
    );
    console.log(
      `  ${tieneLinea ? "✓" : "✗"} EmbarqueCosto #${c.id} (${c.embarque.codigo} ${c.momento}) Fact.${c.facturaNumero} iibb=${c.iibb} estadoEmb=${c.embarque.estado}`,
    );
  }
  if (costos.length === 0) console.log("  (ninguno)");

  console.log("\n=== 7. Embarques con iibb > 0 (aduana) ===");
  const embarques = await db.embarque.findMany({
    where: { iibb: { gt: 0 }, asientoId: { not: null } },
    select: { id: true, codigo: true, iibb: true, asientoId: true },
  });
  for (const e of embarques) {
    const tieneLinea = lineasIibb.some((l) => l.asiento.id === e.asientoId);
    console.log(
      `  ${tieneLinea ? "✓" : "✗"} Embarque ${e.codigo} iibb=${e.iibb} asiento=${e.asientoId}`,
    );
  }
  if (embarques.length === 0) console.log("  (ninguno)");

  console.log("\n=== 8. Despachos con iibb > 0 ===");
  const despachos = await db.despacho.findMany({
    where: { iibb: { gt: 0 }, asientoId: { not: null } },
    select: { id: true, codigo: true, iibb: true, asientoId: true },
  });
  for (const d of despachos) {
    const tieneLinea = lineasIibb.some((l) => l.asiento.id === d.asientoId);
    console.log(
      `  ${tieneLinea ? "✓" : "✗"} Despacho ${d.codigo} iibb=${d.iibb} asiento=${d.asientoId}`,
    );
  }
  if (despachos.length === 0) console.log("  (ninguno)");

  console.log("\n=== 9. Saldos contables por cuenta IIBB ===");
  const sums = cuentaIdsIibb.length
    ? await db.lineaAsiento.groupBy({
        by: ["cuentaId"],
        where: {
          cuentaId: { in: cuentaIdsIibb },
          asiento: { estado: "CONTABILIZADO" },
        },
        _sum: { debe: true, haber: true },
      })
    : [];
  for (const c of cuentas) {
    const s = sums.find((x) => x.cuentaId === c.id);
    const debe = s?._sum.debe ?? 0;
    const haber = s?._sum.haber ?? 0;
    const saldo =
      c.categoria === "ACTIVO"
        ? Number(debe) - Number(haber)
        : Number(haber) - Number(debe);
    console.log(
      `  ${c.codigo} ${c.nombre} [${c.categoria}/${c.tipo}] debe=${debe} haber=${haber} saldo=${saldo.toFixed(2)}`,
    );
  }

  console.log(
    "\nLeyenda: ✗ = la operación tiene iibb>0 pero el asiento NO tiene línea sobre cuenta IIBB.",
  );
  console.log(
    "Si todas las marcas son ✓ y los saldos son != 0, el problema está en el rendering del Balance.",
  );
  console.log(
    "Si hay marcas ✗ → hay que recontabilizar (anular + emitir) el asiento, o aplicar fix manual.",
  );

  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
