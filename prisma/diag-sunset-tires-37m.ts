// Diagnostica las líneas en cuenta 2.1.8.10 (Sunset Tires Corp Ltd) que NO
// pertenecen a los 5 embarques FOB ya identificados — los $37M ARS HABER
// "sin rastro USD" que aparecieron en diag-moneda-origen.
//
// Uso:
//   DATABASE_URL=$(grep '^DATABASE_URL=' .env.local | cut -d= -f2- | tr -d '"') \
//     pnpm tsx prisma/diag-sunset-tires-37m.ts

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { Decimal } from "decimal.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

function fmt(n: Decimal | number | string): string {
  const d = new Decimal(n.toString());
  return d.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

async function main() {
  const cuenta = await prisma.cuentaContable.findFirst({
    where: { codigo: "2.1.8.10" },
    select: { id: true, codigo: true, nombre: true },
  });
  if (!cuenta) {
    console.error("Cuenta 2.1.8.10 no encontrada.");
    process.exit(1);
  }

  console.log(`Cuenta ${cuenta.codigo} ${cuenta.nombre}\n`);

  // Todas las líneas de la cuenta
  const lineas = await prisma.lineaAsiento.findMany({
    where: {
      cuentaId: cuenta.id,
      asiento: { estado: "CONTABILIZADO" },
    },
    include: {
      asiento: {
        select: {
          id: true,
          numero: true,
          fecha: true,
          descripcion: true,
          origen: true,
          // Cargar todas las relaciones que pueden estar atadas al asiento
          compra: { select: { numero: true, moneda: true, total: true } },
          gasto: { select: { numero: true, moneda: true, total: true } },
          movimiento: { select: { id: true, tipo: true, moneda: true, monto: true } },
          embarqueCierre: { select: { codigo: true } },
          embarqueZonaPrimaria: { select: { codigo: true } },
          embarqueCosto: { select: { facturaNumero: true, moneda: true, embarque: { select: { codigo: true } } } },
          prestamo: { select: { prestamista: true } },
        },
      },
    },
    orderBy: { asiento: { fecha: "asc" } },
  });


  let totalDebe = new Decimal(0);
  let totalHaber = new Decimal(0);
  console.log("┌─────┬──────────┬──────────────┬──────────────┬─────────┬────────────────────────────────────────");
  console.log("│ Asn │  Fecha   │     Debe     │    Haber     │ Fuente  │ Detalle");
  console.log("├─────┼──────────┼──────────────┼──────────────┼─────────┼────────────────────────────────────────");

  for (const l of lineas) {
    const a = l.asiento;
    const fecha = a.fecha.toISOString().slice(0, 10);
    const debe = new Decimal(l.debe.toString());
    const haber = new Decimal(l.haber.toString());
    totalDebe = totalDebe.plus(debe);
    totalHaber = totalHaber.plus(haber);

    let fuente: string = a.origen;
    let detalle = a.descripcion ?? "";
    let monedaSrc: string = "?";

    if (a.compra) {
      fuente = "COMPRA";
      detalle = `Compra ${a.compra.numero}`;
      monedaSrc = a.compra.moneda;
    } else if (a.gasto) {
      fuente = "GASTO";
      detalle = `Gasto ${a.gasto.numero}`;
      monedaSrc = a.gasto.moneda;
    } else if (a.movimiento) {
      fuente = `MOV-${a.movimiento.tipo}`;
      detalle = `Movimiento ${a.movimiento.id.slice(0, 8)}`;
      monedaSrc = a.movimiento.moneda;
    } else if (a.embarqueCosto) {
      fuente = "EMB-COSTO";
      detalle = `${a.embarqueCosto.embarque.codigo} / ${a.embarqueCosto.facturaNumero ?? "(sin nº)"}`;
      monedaSrc = a.embarqueCosto.moneda;
    } else if (a.embarqueCierre) {
      fuente = "EMB-FOB";
      detalle = `${a.embarqueCierre.codigo} (cierre/nacionalización)`;
    } else if (a.embarqueZonaPrimaria) {
      fuente = "EMB-FOB-ZP";
      detalle = `${a.embarqueZonaPrimaria.codigo} (zona primaria)`;
    } else if (a.prestamo) {
      fuente = "PRESTAMO";
      detalle = `${a.prestamo.prestamista}`;
    }

    const marcaUsd = l.monedaOrigen ? `[${l.monedaOrigen}]` : "";
    console.log(
      `│ #${String(a.numero).padStart(3, " ")} │ ${fecha} │ ${fmt(debe).padStart(12, " ")} │ ${fmt(haber).padStart(12, " ")} │ ${(fuente + monedaSrc).padEnd(7, " ")} │ ${detalle} ${marcaUsd}`,
    );
    if (l.descripcion) {
      console.log(`│     │          │              │              │         │   └─ ${l.descripcion}`);
    }
  }

  console.log("└─────┴──────────┴──────────────┴──────────────┴─────────┴────────────────────────────────────────");
  console.log(`Totales: DEBE ${fmt(totalDebe).padStart(15, " ")}  HABER ${fmt(totalHaber).padStart(15, " ")}  Saldo HABER−DEBE ${fmt(totalHaber.minus(totalDebe))}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
