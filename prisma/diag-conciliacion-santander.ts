import { config as dotenvConfig } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

dotenvConfig({ path: ".env.local" });
dotenvConfig({ path: ".env" });

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

function fmt(d: unknown): string {
  return Number(d).toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

async function main() {
  const desde = new Date(Date.UTC(2026, 1, 1, 0, 0, 0));
  const hasta = new Date(Date.UTC(2026, 1, 25, 23, 59, 59, 999));

  const banco = await prisma.cuentaBancaria.findFirst({
    where: { banco: { contains: "SANTANDER", mode: "insensitive" }, moneda: "ARS" },
    select: { id: true, banco: true, numero: true, cuentaContableId: true },
  });
  if (!banco) {
    console.log("No se encontró cuenta Santander ARS");
    return;
  }
  console.log(`Cuenta: ${banco.banco} ${banco.numero} (cuentaBancariaId=${banco.id})`);

  // Tabla MovimientoTesoreria directa
  const movs = await prisma.movimientoTesoreria.findMany({
    where: {
      cuentaBancariaId: banco.id,
      fecha: { gte: desde, lte: hasta },
    },
    orderBy: [{ fecha: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      tipo: true,
      monto: true,
      fecha: true,
      descripcion: true,
      comprobante: true,
      referenciaBanco: true,
      asientoId: true,
      asiento: { select: { numero: true, estado: true } },
    },
  });

  console.log(`\nMovimientoTesoreria (${movs.length}):`);
  let total = 0;
  for (const m of movs) {
    const monto = Number(m.monto);
    const signo = ["EGRESO", "TRANSFERENCIA_EGRESO"].some((t) => m.tipo.includes(t)) ? -1 : 1;
    // Simplificación: comparar signo por nombre del tipo.
    const signoReal = m.tipo.toString().includes("EGRESO") ? -1 : 1;
    total += signoReal * monto;
    console.log(
      `  ${m.fecha.toISOString().slice(0, 10)} ${m.tipo.padEnd(28)} ${(signoReal * monto).toString().padStart(18)}  asiento=${m.asiento?.numero ?? "(sin asiento)"}/${m.asiento?.estado ?? "—"}  ref=${m.referenciaBanco ?? "—"}  ${m.descripcion?.slice(0, 60) ?? ""}`,
    );
  }
  console.log(`\nSuma neta de MovimientoTesoreria: ${fmt(total)}`);

  // Lineas asiento GL contabilizadas
  const lineas = await prisma.lineaAsiento.findMany({
    where: {
      cuentaId: banco.cuentaContableId,
      asiento: { fecha: { gte: desde, lte: hasta }, estado: "CONTABILIZADO" },
    },
    orderBy: [{ asiento: { fecha: "asc" } }, { asiento: { numero: "asc" } }],
    select: {
      debe: true,
      haber: true,
      asiento: { select: { numero: true, fecha: true, descripcion: true } },
    },
  });

  console.log(`\nLineaAsiento CONTABILIZADO en periodo (${lineas.length}):`);
  let neto = 0;
  for (const l of lineas) {
    const d = Number(l.debe);
    const h = Number(l.haber);
    neto += d - h;
    console.log(
      `  ${l.asiento.fecha.toISOString().slice(0, 10)} #${l.asiento.numero}  DEBE ${fmt(d).padStart(16)}  HABER ${fmt(h).padStart(16)}  ${l.asiento.descripcion?.slice(0, 60)}`,
    );
  }
  console.log(`Neto LineaAsiento: ${fmt(neto)}`);

  // Comparar centavos: comparar Decimal exacto contra sumando manual.
  // Sumar todas las Decimal monto y reportar el último digito.
  const sumaPesos = movs.reduce((acc, m) => acc + Number(m.monto), 0);
  console.log(`\nSuma absoluta de montos (sin signo): ${fmt(sumaPesos)}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
