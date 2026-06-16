// Diagnóstico read-only de las cuentas con saldo invertido NO comercial.
// Para cada cuenta objetivo lista las líneas de asiento que la tocan junto a su
// CONTRAPARTIDA (las otras líneas del mismo asiento), origen, fecha y estado.
// Objetivo: entender por qué 1.1.5.03 / 1.1.5.05 sólo tienen HABER (saldo
// acreedor en una cuenta de ACTIVO) — ¿asientos invertidos? ¿falta la pata de
// débito (ingreso nunca contabilizado)? ¿cuenta equivocada?
//
// Uso (read-only contra prod):
//   DATABASE_URL=$(grep '^DATABASE_URL=' .env.local | cut -d= -f2- | tr -d '"') \
//     pnpm tsx prisma/diag-cuentas-credoras.ts

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { Decimal } from "decimal.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const OBJETIVO = ["1.1.5.03", "1.1.5.05", "1.1.2.10"];

function fmt(v: unknown): string {
  return new Decimal((v ?? 0).toString()).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

async function main() {
  for (const codigo of OBJETIVO) {
    const cuenta = await prisma.cuentaContable.findFirst({
      where: { codigo },
      select: { id: true, codigo: true, nombre: true, categoria: true },
    });
    if (!cuenta) {
      console.log(`\n### ${codigo} — NO ENCONTRADA`);
      continue;
    }

    const lineas = await prisma.lineaAsiento.findMany({
      where: { cuentaId: cuenta.id, asiento: { estado: "CONTABILIZADO" } },
      select: {
        debe: true,
        haber: true,
        descripcion: true,
        asiento: {
          select: {
            id: true,
            numero: true,
            fecha: true,
            descripcion: true,
            origen: true,
            lineas: {
              select: {
                debe: true,
                haber: true,
                cuenta: { select: { codigo: true, nombre: true } },
              },
            },
          },
        },
      },
      orderBy: { asiento: { fecha: "asc" } },
    });

    console.log("\n\n========================================================");
    console.log(
      `### ${cuenta.codigo} ${cuenta.nombre} [${cuenta.categoria}] — ${lineas.length} líneas`,
    );
    console.log("========================================================");

    // Agregar por origen del asiento.
    const porOrigen = new Map<string, { debe: Decimal; haber: Decimal; n: number }>();
    for (const l of lineas) {
      const o = l.asiento.origen ?? "—";
      const acc = porOrigen.get(o) ?? { debe: new Decimal(0), haber: new Decimal(0), n: 0 };
      acc.debe = acc.debe.plus(new Decimal(l.debe.toString()));
      acc.haber = acc.haber.plus(new Decimal(l.haber.toString()));
      acc.n += 1;
      porOrigen.set(o, acc);
    }
    console.log("\n  -- por ORIGEN del asiento --");
    for (const [o, acc] of porOrigen) {
      console.log(
        `     ${o.padEnd(18)} n=${String(acc.n).padStart(3)}  debe ${fmt(acc.debe).padStart(18)}  haber ${fmt(acc.haber).padStart(18)}`,
      );
    }

    // Mostrar hasta 8 asientos de ejemplo con su contrapartida.
    console.log("\n  -- ejemplos (asiento → contrapartida) --");
    for (const l of lineas.slice(0, 8)) {
      const a = l.asiento;
      const lado = new Decimal(l.debe.toString()).gt(0)
        ? `DEBE ${fmt(l.debe)}`
        : `HABER ${fmt(l.haber)}`;
      console.log(
        `\n   #${a.numero} ${a.fecha.toISOString().slice(0, 10)} [${a.origen}] ${lado}  — ${a.descripcion?.slice(0, 70) ?? ""}`,
      );
      for (const cl of a.lineas) {
        const ld = new Decimal(cl.debe.toString()).gt(0)
          ? `D ${fmt(cl.debe).padStart(16)}`
          : `H ${fmt(cl.haber).padStart(16)}`;
        const marca = cl.cuenta.codigo === cuenta.codigo ? " *" : "  ";
        console.log(
          `       ${marca}${cl.cuenta.codigo.padEnd(10)} ${cl.cuenta.nombre.slice(0, 32).padEnd(32)} ${ld}`,
        );
      }
    }
  }

  console.log("");
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    return prisma.$disconnect().then(() => process.exit(1));
  });
