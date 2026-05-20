import { config as dotenvConfig } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

dotenvConfig({ path: ".env.local" });
dotenvConfig({ path: ".env" });

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

// Diagnóstico del extracto bancario: para cada cuenta bancaria, dump todas
// las lineas de asiento que tocan su GL en el periodo, agrupadas por origen.
// Permite detectar:
//   - Asientos BORRADOR / ANULADO que afectan el saldo si la query los incluye
//   - VEPs/transferencias/cobros faltantes
//   - Asientos huérfanos (sin movimiento ni venta/compra de origen)
//   - Saldo inicial inflado por asientos previos al periodo
//
// Uso: pnpm tsx prisma/diag-extracto-bancario.ts [desde YYYY-MM-DD] [hasta YYYY-MM-DD]
//   default: desde = 2026-01-01, hasta = hoy

function parseArg(idx: number, fallback: string): Date {
  const raw = process.argv[idx];
  const value = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : fallback;
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
}

function fmt(d: unknown): string {
  return Number(d).toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

async function main() {
  const desde = parseArg(2, "2026-01-01");
  const hastaInput = process.argv[3];
  const hasta = hastaInput
    ? parseArg(3, "2026-12-31")
    : new Date(new Date().setUTCHours(23, 59, 59, 999));

  console.log(`\n=== Diagnóstico extracto bancario ===`);
  console.log(`Periodo: ${desde.toISOString().slice(0, 10)} → ${hasta.toISOString().slice(0, 10)}\n`);

  const bancos = await prisma.cuentaBancaria.findMany({
    select: {
      id: true,
      banco: true,
      numero: true,
      moneda: true,
      cuentaContableId: true,
      cuentaContable: { select: { codigo: true, nombre: true } },
    },
    orderBy: [{ banco: "asc" }],
  });

  for (const banco of bancos) {
    console.log(`\n${"=".repeat(80)}`);
    console.log(`BANCO: ${banco.banco} · ${banco.numero ?? "—"} · ${banco.moneda}`);
    console.log(`GL: ${banco.cuentaContable.codigo} ${banco.cuentaContable.nombre} (id=${banco.cuentaContableId})`);
    console.log("=".repeat(80));

    // Saldo inicial: sum(debe - haber) de TODOS los asientos contabilizados anteriores a 'desde'.
    const inicialAgg = await prisma.lineaAsiento.aggregate({
      where: {
        cuentaId: banco.cuentaContableId,
        asiento: {
          estado: "CONTABILIZADO",
          fecha: { lt: desde },
        },
      },
      _sum: { debe: true, haber: true },
    });
    const saldoInicial =
      Number(inicialAgg._sum.debe ?? 0) - Number(inicialAgg._sum.haber ?? 0);
    console.log(`\nSaldo inicial al ${desde.toISOString().slice(0, 10)}: ${fmt(saldoInicial)}`);

    // Asientos BORRADOR/ANULADO antes de 'desde' que tocan el GL (no afectan saldo
    // pero pueden indicar problemas):
    const previosNoContab = await prisma.lineaAsiento.findMany({
      where: {
        cuentaId: banco.cuentaContableId,
        asiento: { estado: { not: "CONTABILIZADO" }, fecha: { lt: desde } },
      },
      select: {
        debe: true,
        haber: true,
        asiento: {
          select: { numero: true, fecha: true, estado: true, descripcion: true, origen: true },
        },
      },
    });
    if (previosNoContab.length > 0) {
      console.log(`\n  ⚠ ${previosNoContab.length} líneas en asientos BORRADOR/ANULADO previos al período (no cuentan en saldo inicial):`);
      for (const l of previosNoContab.slice(0, 5)) {
        console.log(
          `    #${l.asiento.numero} ${l.asiento.fecha.toISOString().slice(0, 10)} ${l.asiento.estado} — DEBE ${fmt(l.debe)} HABER ${fmt(l.haber)} — ${l.asiento.descripcion?.slice(0, 60)}`,
        );
      }
      if (previosNoContab.length > 5) console.log(`    ... y ${previosNoContab.length - 5} más`);
    }

    // Lineas del periodo, todas las estados, agrupadas por origen y estado.
    const lineas = await prisma.lineaAsiento.findMany({
      where: {
        cuentaId: banco.cuentaContableId,
        asiento: { fecha: { gte: desde, lte: hasta } },
      },
      orderBy: [{ asiento: { fecha: "asc" } }, { asiento: { numero: "asc" } }],
      select: {
        debe: true,
        haber: true,
        descripcion: true,
        asiento: {
          select: {
            id: true,
            numero: true,
            fecha: true,
            estado: true,
            origen: true,
            descripcion: true,
            movimiento: { select: { id: true } },
          },
        },
      },
    });

    // Resumen por origen × estado
    const resumen = new Map<string, { count: number; debe: number; haber: number }>();
    for (const l of lineas) {
      const key = `${l.asiento.origen}/${l.asiento.estado}`;
      const r = resumen.get(key) ?? { count: 0, debe: 0, haber: 0 };
      r.count++;
      r.debe += Number(l.debe);
      r.haber += Number(l.haber);
      resumen.set(key, r);
    }
    console.log(`\nLíneas en el periodo (${lineas.length}):`);
    console.log(`  ${"Origen/Estado".padEnd(28)} ${"Count".padStart(6)} ${"Total DEBE".padStart(18)} ${"Total HABER".padStart(18)} ${"Neto".padStart(18)}`);
    for (const [key, r] of [...resumen.entries()].sort()) {
      const neto = r.debe - r.haber;
      console.log(
        `  ${key.padEnd(28)} ${String(r.count).padStart(6)} ${fmt(r.debe).padStart(18)} ${fmt(r.haber).padStart(18)} ${fmt(neto).padStart(18)}`,
      );
    }

    // Saldo final calculado igual que el extracto (sólo CONTABILIZADO).
    const contabilizadas = lineas.filter((l) => l.asiento.estado === "CONTABILIZADO");
    const totalDebe = contabilizadas.reduce((acc, l) => acc + Number(l.debe), 0);
    const totalHaber = contabilizadas.reduce((acc, l) => acc + Number(l.haber), 0);
    const saldoFinal = saldoInicial + totalDebe - totalHaber;
    console.log(`\nSaldo final calculado (sólo CONTABILIZADO):`);
    console.log(`  Saldo inicial    : ${fmt(saldoInicial).padStart(18)}`);
    console.log(`  + DEBE periodo   : ${fmt(totalDebe).padStart(18)}`);
    console.log(`  - HABER periodo  : ${fmt(totalHaber).padStart(18)}`);
    console.log(`  = Saldo final    : ${fmt(saldoFinal).padStart(18)}`);

    // Asientos BORRADOR en el periodo (potenciales VEPs/cobros sin contabilizar):
    const borradores = lineas.filter((l) => l.asiento.estado === "BORRADOR");
    if (borradores.length > 0) {
      console.log(`\n  ⚠ ${borradores.length} líneas en asientos BORRADOR del periodo (NO suman al saldo — son los que parecen "faltar"):`);
      for (const l of borradores.slice(0, 20)) {
        const sign = Number(l.debe) > 0 ? `+${fmt(l.debe)}` : `-${fmt(l.haber)}`;
        console.log(
          `    #${l.asiento.numero} ${l.asiento.fecha.toISOString().slice(0, 10)} ${l.asiento.origen} ${sign.padStart(16)} — ${l.asiento.descripcion?.slice(0, 80)}`,
        );
      }
      if (borradores.length > 20) console.log(`    ... y ${borradores.length - 20} más`);
    }

    // Asientos ANULADOS en el periodo (informativos):
    const anulados = lineas.filter((l) => l.asiento.estado === "ANULADO");
    if (anulados.length > 0) {
      console.log(`\n  (info) ${anulados.length} líneas en asientos ANULADO del periodo`);
    }

    // Si el usuario pasó --dump como 4to argumento, listar las CONTABILIZADO
    // ordenadas en orden cronológico para inspección.
    if (process.argv[4] === "--dump" && contabilizadas.length > 0) {
      console.log(`\n  Líneas CONTABILIZADO en orden cronológico:`);
      let acum = saldoInicial;
      for (const l of contabilizadas) {
        const d = Number(l.debe);
        const h = Number(l.haber);
        acum += d - h;
        const sign = d > 0 ? `+${fmt(d)}` : `-${fmt(h)}`;
        console.log(
          `    ${l.asiento.fecha.toISOString().slice(0, 10)} #${String(l.asiento.numero).padStart(5)} ${l.asiento.origen.padEnd(10)} ${sign.padStart(16)}  saldo: ${fmt(acum).padStart(16)}  — ${(l.descripcion || l.asiento.descripcion || "").slice(0, 60)}`,
        );
      }
    }
  }

  console.log("\n=== Fin del diagnóstico ===\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
