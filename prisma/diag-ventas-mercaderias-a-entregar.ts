// Diagnóstico read-only: ventas que cargan saldo abierto en la cuenta-puente
// 1.1.5.03 MERCADERIAS A ENTREGAR (stock-dual W3).
//
// Contexto: en emisión, crearAsientoVenta hace DEBE CMV / HABER 1.1.5.03
// (provisión). Cuando se confirma la entrega (remito), crearAsientoEntrega
// hace DEBE 1.1.5.03 / HABER 1.1.5.01, cancelando la provisión. Una venta
// emitida pero NUNCA entregada deja su HABER en 1.1.5.03 abierto → el saldo
// de la cuenta queda acreedor (≈ -151.967.299,20 al 2026-06-15), que es la
// anomalía nº1 del GATE para sanear el balancete.
//
// Este script NO escribe nada. Atribuye cada línea de 1.1.5.03 a su venta
// (asiento.venta en la emisión; asiento.entregaVenta.ventaId en la entrega),
// agrupa, y lista las ventas con puente abierto para que el dueño marque
// cuáles ya fueron despachadas físicamente. El backfill (confirmar la entrega
// y cancelar la provisión) es un paso posterior, por venta, con autorización.
//
// Para cada venta abierta indica si YA tiene una entrega BORRADOR (post-#211,
// basta confirmarla) o si no tiene ninguna (venta legacy, hay que crear+confirmar).
//
// Uso (read-only contra prod):
//   DATABASE_URL=$(grep '^DATABASE_URL=' .env.local | cut -d= -f2- | tr -d '"') \
//     pnpm tsx prisma/diag-ventas-mercaderias-a-entregar.ts

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { Decimal } from "decimal.js";
import { PrismaClient } from "../src/generated/prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const CODIGO_PUENTE = "1.1.5.03";

function toDec(v: unknown): Decimal {
  return new Decimal((v ?? 0).toString());
}

function fmt(n: Decimal): string {
  return n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function fmtFecha(d: Date): string {
  return d.toISOString().slice(0, 10);
}

type Grupo = {
  ventaId: string;
  debe: Decimal; // Σ DEBE en 1.1.5.03 atribuido a la venta (entregas que cancelaron)
  haber: Decimal; // Σ HABER en 1.1.5.03 atribuido a la venta (provisión en emisión)
};

async function main() {
  const cuenta = await prisma.cuentaContable.findFirst({
    where: { codigo: CODIGO_PUENTE },
    select: { id: true, codigo: true, nombre: true, categoria: true },
  });
  if (!cuenta) {
    console.error(`✗ Cuenta ${CODIGO_PUENTE} no encontrada.`);
    return;
  }

  // (1) Saldo vivo de la cuenta — fuente de verdad para reconciliar.
  const aggCuenta = await prisma.lineaAsiento.aggregate({
    where: { cuentaId: cuenta.id, asiento: { estado: "CONTABILIZADO" } },
    _sum: { debe: true, haber: true },
  });
  const debeTotal = toDec(aggCuenta._sum.debe);
  const haberTotal = toDec(aggCuenta._sum.haber);
  // ACTIVO: saldoNatural = debe - haber. Puente abierto ⇒ saldoNatural < 0.
  const saldoNatural = debeTotal.minus(haberTotal).toDecimalPlaces(2);

  // (2) Todas las líneas de 1.1.5.03, atribuyendo cada una a una venta.
  const lineas = await prisma.lineaAsiento.findMany({
    where: { cuentaId: cuenta.id, asiento: { estado: "CONTABILIZADO" } },
    select: {
      debe: true,
      haber: true,
      asiento: {
        select: {
          venta: { select: { id: true } },
          entregaVenta: { select: { ventaId: true } },
        },
      },
    },
  });

  const grupos = new Map<string, Grupo>();
  let sinAtribuirDebe = new Decimal(0);
  let sinAtribuirHaber = new Decimal(0);

  for (const l of lineas) {
    const ventaId = l.asiento.venta?.id ?? l.asiento.entregaVenta?.ventaId ?? null;
    if (!ventaId) {
      sinAtribuirDebe = sinAtribuirDebe.plus(toDec(l.debe));
      sinAtribuirHaber = sinAtribuirHaber.plus(toDec(l.haber));
      continue;
    }
    const g = grupos.get(ventaId) ?? {
      ventaId,
      debe: new Decimal(0),
      haber: new Decimal(0),
    };
    g.debe = g.debe.plus(toDec(l.debe));
    g.haber = g.haber.plus(toDec(l.haber));
    grupos.set(ventaId, g);
  }

  // Puente abierto por venta = haber - debe (provisión no cancelada).
  const abiertas = [...grupos.values()]
    .map((g) => ({ ...g, abierto: g.haber.minus(g.debe).toDecimalPlaces(2) }))
    .filter((g) => !g.abierto.isZero())
    .sort((a, b) => b.abierto.comparedTo(a.abierto));

  // (3) Detalles de las ventas con puente abierto.
  const ventaIds = abiertas.map((g) => g.ventaId);
  const ventas = await prisma.venta.findMany({
    where: { id: { in: ventaIds } },
    select: {
      id: true,
      numero: true,
      fecha: true,
      estado: true,
      cliente: { select: { nombre: true } },
      items: {
        select: { cantidad: true, producto: { select: { codigo: true } } },
      },
      entregas: { select: { estado: true } },
    },
  });
  const ventaMap = new Map(ventas.map((v) => [v.id, v]));

  // ---- Salida ----
  console.log("\n==================================================================");
  console.log(` CUENTA-PUENTE ${cuenta.codigo} ${cuenta.nombre} [${cuenta.categoria}]`);
  console.log("==================================================================");
  console.log(`  Σ DEBE  (entregas que cancelaron) : ${fmt(debeTotal).padStart(20)}`);
  console.log(`  Σ HABER (provisiones en emisión)  : ${fmt(haberTotal).padStart(20)}`);
  console.log(`  saldo natural (ACTIVO=debe-haber) : ${fmt(saldoNatural).padStart(20)}`);
  console.log(`  → puente abierto a cancelar       : ${fmt(saldoNatural.negated()).padStart(20)}`);

  console.log("\n==================================================================");
  console.log(` VENTAS CON PUENTE ABIERTO (${abiertas.length})`);
  console.log("==================================================================");
  console.log(
    `  ${"venta".padEnd(14)} ${"fecha".padEnd(10)} ${"cliente".padEnd(28)} ` +
      `${"abierto".padStart(18)}  estado     entrega`,
  );
  console.log(`  ${"-".repeat(96)}`);

  let sumaAbierto = new Decimal(0);
  let conBorrador = 0;
  let sinEntrega = 0;
  for (const g of abiertas) {
    sumaAbierto = sumaAbierto.plus(g.abierto);
    const v = ventaMap.get(g.ventaId);
    if (!v) {
      console.log(
        `  ${"(?)".padEnd(14)} ${"".padEnd(10)} ${`venta ${g.ventaId} no hallada`.padEnd(28)} ` +
          `${fmt(g.abierto).padStart(18)}`,
      );
      continue;
    }
    const tieneBorrador = v.entregas.some((e) => e.estado === "BORRADOR");
    const tieneConfirmada = v.entregas.some((e) => e.estado === "CONFIRMADA");
    const entregaInfo = tieneBorrador
      ? "BORRADOR↺"
      : tieneConfirmada
        ? "parcial"
        : v.entregas.length === 0
          ? "NINGUNA"
          : "anulada";
    if (tieneBorrador) conBorrador++;
    if (v.entregas.length === 0) sinEntrega++;
    const itemsResumo = `${v.items.length} ít/${v.items.reduce((a, it) => a + it.cantidad, 0)} u`;
    console.log(
      `  ${v.numero.padEnd(14)} ${fmtFecha(v.fecha).padEnd(10)} ${v.cliente.nombre.slice(0, 28).padEnd(28)} ` +
        `${fmt(g.abierto).padStart(18)}  ${v.estado.padEnd(10)} ${entregaInfo.padEnd(10)} ${itemsResumo}`,
    );
  }

  // (4) Líneas sin venta atribuible (reversos de anulación, asientos manuales).
  const sinAtribuirAbierto = sinAtribuirHaber.minus(sinAtribuirDebe).toDecimalPlaces(2);

  console.log("\n==================================================================");
  console.log(" RESUMEN / RECONCILIACIÓN");
  console.log("==================================================================");
  console.log(`  ventas con puente abierto         : ${abiertas.length}`);
  console.log(`    · con entrega BORRADOR (post-#211, basta confirmar) : ${conBorrador}`);
  console.log(`    · sin entrega (legacy, crear+confirmar)             : ${sinEntrega}`);
  console.log(`  Σ abierto atribuido a ventas      : ${fmt(sumaAbierto).padStart(20)}`);
  console.log(`  Σ abierto SIN venta atribuible     : ${fmt(sinAtribuirAbierto).padStart(20)}`);
  const reconciliado = sumaAbierto.plus(sinAtribuirAbierto).toDecimalPlaces(2);
  console.log(`  Σ total (debe ser = puente abierto): ${fmt(reconciliado).padStart(20)}`);
  const esperado = saldoNatural.negated();
  const ok = reconciliado.equals(esperado);
  console.log(
    `  reconcilia con saldo de la cuenta? ${ok ? "SÍ ✓" : `NO ✗ (cuenta=${fmt(esperado)}, atribuido=${fmt(reconciliado)}, Δ=${fmt(reconciliado.minus(esperado))})`}`,
  );
  console.log("");
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    return prisma.$disconnect().then(() => process.exit(1));
  });
