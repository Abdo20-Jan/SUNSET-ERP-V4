// Diagnóstico read-only de saldos de signo invertido en ACTIVO/PASIVO.
//
// Dos objetivos:
//  (1) VALIDAR el PR #203: confirmar que TP LOGISTICA (2.1.1.20) tiene saldo
//      DEUDOR (saldo a favor) y que la regla de reclasificación lo lleva al
//      Activo. Misma regla pura que src/lib/services/reportes/balance-general.ts:
//      proveedores (2.1.1./2.1.8.) con saldo<0 → Activo; clientes (1.1.3.) con
//      saldo<0 → Pasivo.
//  (2) INVESTIGAR los hallazgos: cuentas con saldo invertido que NO son del
//      subledger comercial (1.1.5.03, 1.1.5.05, 1.1.2.10, ...) — el balance NO
//      las reclasifica, así que quedan como anomalía a explicar.
//
// Uso (read-only contra prod):
//   DATABASE_URL=$(grep '^DATABASE_URL=' .env.local | cut -d= -f2- | tr -d '"') \
//     pnpm tsx prisma/diag-saldos-invertidos.ts

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { naturalezaPorDefecto, saldoNatural } from "../src/lib/services/cuenta-naturaleza";
import { PrismaClient } from "../src/generated/prisma/client";
import { Decimal } from "decimal.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const RUBRO_PROVEEDORES = ["2.1.1.", "2.1.8."];
const RUBRO_CLIENTES = ["1.1.3."];

function toDec(v: unknown): Decimal {
  return new Decimal((v ?? 0).toString());
}

function fmt(n: Decimal): string {
  return n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

async function main() {
  const cuentas = await prisma.cuentaContable.findMany({
    where: { categoria: { in: ["ACTIVO", "PASIVO"] }, tipo: "ANALITICA" },
    select: { id: true, codigo: true, nombre: true, categoria: true, naturaleza: true },
    orderBy: { codigo: "asc" },
  });

  const agg = await prisma.lineaAsiento.groupBy({
    by: ["cuentaId"],
    where: { asiento: { estado: "CONTABILIZADO" } },
    _sum: { debe: true, haber: true },
  });
  const aggMap = new Map<number, { debe: Decimal; haber: Decimal }>();
  for (const a of agg) {
    aggMap.set(a.cuentaId, { debe: toDec(a._sum.debe), haber: toDec(a._sum.haber) });
  }

  type Row = {
    codigo: string;
    nombre: string;
    categoria: string;
    debe: Decimal;
    haber: Decimal;
    saldo: Decimal;
  };

  const invertidas: Row[] = [];
  for (const c of cuentas) {
    const m = aggMap.get(c.id) ?? { debe: new Decimal(0), haber: new Decimal(0) };
    const nat = c.naturaleza ?? naturalezaPorDefecto(c.categoria);
    const saldo = saldoNatural(nat, m.debe, m.haber).toDecimalPlaces(2);
    if (saldo.lt(0)) {
      invertidas.push({
        codigo: c.codigo,
        nombre: c.nombre,
        categoria: c.categoria,
        debe: m.debe,
        haber: m.haber,
        saldo,
      });
    }
  }

  const esComercial = (codigo: string, categoria: string) =>
    (categoria === "PASIVO" && RUBRO_PROVEEDORES.some((p) => codigo.startsWith(p))) ||
    (categoria === "ACTIVO" && RUBRO_CLIENTES.some((p) => codigo.startsWith(p)));

  const reclasificadas = invertidas.filter((r) => esComercial(r.codigo, r.categoria));
  const anomalias = invertidas.filter((r) => !esComercial(r.codigo, r.categoria));

  console.log("\n==================================================================");
  console.log(" (1) RECLASIFICADAS por PR #203 (saldo a favor → lado opuesto)");
  console.log("==================================================================");
  if (reclasificadas.length === 0) {
    console.log("  (ninguna)");
  }
  for (const r of reclasificadas) {
    const destino = r.categoria === "PASIVO" ? "→ ACTIVO" : "→ PASIVO";
    console.log(
      `  ${r.codigo.padEnd(10)} ${r.nombre.slice(0, 34).padEnd(34)} ` +
        `saldo ${fmt(r.saldo).padStart(18)}  ${destino} (exhibe ${fmt(r.saldo.negated())})`,
    );
  }

  console.log("\n==================================================================");
  console.log(" (2) ANOMALÍAS: saldo invertido NO comercial (balance NO las toca)");
  console.log("==================================================================");
  if (anomalias.length === 0) {
    console.log("  (ninguna)");
  }
  for (const r of anomalias) {
    console.log(
      `  ${r.codigo.padEnd(10)} ${r.nombre.slice(0, 34).padEnd(34)} [${r.categoria.padEnd(7)}] ` +
        `debe ${fmt(r.debe).padStart(18)}  haber ${fmt(r.haber).padStart(18)}  saldo ${fmt(r.saldo).padStart(18)}`,
    );
  }

  // Validación puntual TP LOGISTICA.
  console.log("\n==================================================================");
  console.log(" (3) VALIDACIÓN PR #203 — TP LOGISTICA 2.1.1.20");
  console.log("==================================================================");
  const tp = cuentas.find((c) => c.codigo === "2.1.1.20");
  if (!tp) {
    console.log("  ⚠ cuenta 2.1.1.20 no encontrada");
  } else {
    const m = aggMap.get(tp.id) ?? { debe: new Decimal(0), haber: new Decimal(0) };
    const nat = tp.naturaleza ?? naturalezaPorDefecto(tp.categoria);
    const saldo = saldoNatural(nat, m.debe, m.haber).toDecimalPlaces(2);
    console.log(`  ${tp.codigo} ${tp.nombre}`);
    console.log(
      `  debe=${fmt(m.debe)}  haber=${fmt(m.haber)}  saldo(natural PASIVO)=${fmt(saldo)}`,
    );
    const esAFavor = saldo.lt(0);
    console.log(
      `  saldo a favor (deudor)? ${esAFavor ? "SÍ" : "NO"} → ` +
        (esAFavor ? `se exhibe en ACTIVO por ${fmt(saldo.negated())}` : "queda en PASIVO"),
    );
    const esperado = new Decimal("-82336.63");
    console.log(
      `  ¿coincide con -82.336,63 esperado del vault? ${saldo.equals(esperado) ? "SÍ ✓" : `NO (real ${fmt(saldo)})`}`,
    );
  }

  // Posibles cuentas duplicadas TP LOGISTICA (2.1.1.25).
  console.log("\n  -- cuentas que contienen 'LOGISTICA' / 'TP' en el nombre --");
  const tpDup = cuentas.filter((c) => /logist/i.test(c.nombre) || /\btp\b/i.test(c.nombre));
  for (const c of tpDup) {
    const m = aggMap.get(c.id) ?? { debe: new Decimal(0), haber: new Decimal(0) };
    const nat = c.naturaleza ?? naturalezaPorDefecto(c.categoria);
    const saldo = saldoNatural(nat, m.debe, m.haber).toDecimalPlaces(2);
    console.log(
      `     ${c.codigo.padEnd(10)} ${c.nombre.padEnd(38)} saldo ${fmt(saldo).padStart(18)}`,
    );
  }

  console.log("");
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    return prisma.$disconnect().then(() => process.exit(1));
  });
