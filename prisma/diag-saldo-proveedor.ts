/**
 * Diagnóstico read-only del saldo contable de la cuenta de un proveedor.
 * Lista todos los HABER (facturas pendientes) y DEBE (pagos) cronológicamente,
 * con cross-reference a Compra/EmbarqueCosto/Gasto por número de factura.
 *
 * Útil cuando "Proveedores comerciales" muestra un proveedor con saldo > 0
 * pero el usuario "ya pagó todo" — el script identifica qué HABER está
 * pendiente (deuda real) vs qué DEBE no está vinculado a una factura
 * (pago histórico sin identificador).
 *
 * Uso:
 *   pnpm tsx prisma/diag-saldo-proveedor.ts <proveedorNombrePartial>
 *   pnpm tsx prisma/diag-saldo-proveedor.ts TP
 *   pnpm tsx prisma/diag-saldo-proveedor.ts CYSAR
 */
import { config as dotenvConfig } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

dotenvConfig({ path: ".env.local" });
dotenvConfig({ path: ".env" });

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const QUERY = process.argv[2];
if (!QUERY) {
  console.error("Uso: pnpm tsx prisma/diag-saldo-proveedor.ts <nombreProveedorPartial>");
  process.exit(1);
}

function fmtNum(n: number): string {
  return n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function main() {
  const proveedores = await prisma.proveedor.findMany({
    where: {
      nombre: { contains: QUERY, mode: "insensitive" },
      cuentaContableId: { not: null },
    },
    select: {
      id: true,
      nombre: true,
      cuentaContableId: true,
      cuentaContable: { select: { id: true, codigo: true, nombre: true } },
    },
  });

  if (proveedores.length === 0) {
    console.error(`Ningún proveedor con nombre conteniendo "${QUERY}" tiene cuenta contable.`);
    process.exit(1);
  }

  for (const p of proveedores) {
    const cuentaId = p.cuentaContableId!;
    console.log("\n══════════════════════════════════════════════════════════════════════════════");
    console.log(`PROVEEDOR: ${p.nombre}`);
    console.log(`CUENTA   : ${p.cuentaContable!.codigo} ${p.cuentaContable!.nombre}`);
    console.log("══════════════════════════════════════════════════════════════════════════════");

    // Saldo total agregado
    const agg = await prisma.lineaAsiento.aggregate({
      where: { cuentaId, asiento: { estado: "CONTABILIZADO" } },
      _sum: { debe: true, haber: true },
    });
    const totalDebe = Number(agg._sum.debe ?? 0);
    const totalHaber = Number(agg._sum.haber ?? 0);
    const saldo = totalHaber - totalDebe;
    console.log(`Σ HABER (facturas)  : ${fmtNum(totalHaber)}`);
    console.log(`Σ DEBE  (pagos)     : ${fmtNum(totalDebe)}`);
    console.log(
      `Saldo contable      : ${fmtNum(saldo)} ${saldo > 0.5 ? "⚠️ deuda" : saldo < -0.5 ? "ℹ️ a favor" : "✅ zerada"}`,
    );

    // Listar todas las líneas
    const lineas = await prisma.lineaAsiento.findMany({
      where: { cuentaId, asiento: { estado: "CONTABILIZADO" } },
      select: {
        descripcion: true,
        debe: true,
        haber: true,
        asiento: {
          select: {
            numero: true,
            fecha: true,
            descripcion: true,
          },
        },
      },
      orderBy: [{ asiento: { fecha: "asc" } }, { id: "asc" }],
    });

    // Facturas asociadas (Compra + EmbarqueCosto + Gasto) para cross-ref
    const compras = await prisma.compra.findMany({
      where: { proveedorId: p.id },
      select: { numero: true, fecha: true, total: true, tipoCambio: true, estado: true },
    });
    const costos = await prisma.embarqueCosto.findMany({
      where: { proveedorId: p.id },
      select: {
        id: true,
        facturaNumero: true,
        fechaFactura: true,
        embarque: { select: { codigo: true } },
      },
    });
    const gastos = await prisma.gasto.findMany({
      where: { proveedorId: p.id },
      select: {
        numero: true,
        facturaNumero: true,
        fecha: true,
        total: true,
        tipoCambio: true,
        estado: true,
      },
    });
    const numerosCompras = new Map<string, string>(); // numero → tipo
    for (const c of compras) numerosCompras.set(c.numero, `Compra ${c.estado}`);
    const numerosCostos = new Map<string, string>();
    for (const c of costos) {
      const n = c.facturaNumero ?? `Factura #${c.id}`;
      numerosCostos.set(n, `EmbarqueCosto ${c.embarque.codigo}`);
    }
    const numerosGastos = new Map<string, string>();
    for (const g of gastos) {
      const n = g.facturaNumero ?? g.numero;
      numerosGastos.set(n, `Gasto ${g.estado}`);
    }

    function lookupFactura(desc: string | null): string {
      if (!desc) return "";
      const tokens = desc.split(/[\s—,;]+/).filter((t) => t.length > 0);
      for (const t of tokens) {
        const c = numerosCompras.get(t);
        if (c) return `[${c}: ${t}]`;
        const co = numerosCostos.get(t);
        if (co) return `[${co}: ${t}]`;
        const g = numerosGastos.get(t);
        if (g) return `[${g}: ${t}]`;
      }
      return "";
    }

    console.log(`\nLíneas (${lineas.length}):\n`);
    console.log(
      "Fecha       Nº     │ Descripción / Asiento descr".padEnd(75) +
        "│ DEBE         │ HABER        │ Match",
    );
    console.log("─".repeat(155));

    let runningSaldo = 0;
    for (const l of lineas) {
      const fechaStr = l.asiento.fecha.toISOString().slice(0, 10);
      const numStr = String(l.asiento.numero).padStart(4);
      const desc = (l.descripcion ?? l.asiento.descripcion ?? "").slice(0, 60);
      const debe = Number(l.debe);
      const haber = Number(l.haber);
      const debeStr = debe > 0 ? fmtNum(debe).padStart(12) : "            ";
      const haberStr = haber > 0 ? fmtNum(haber).padStart(12) : "            ";
      runningSaldo += haber - debe;
      const match = lookupFactura(l.descripcion) || lookupFactura(l.asiento.descripcion);
      console.log(
        `${fechaStr}  #${numStr} │ ${desc.padEnd(60)}│ ${debeStr} │ ${haberStr} │ ${match}`,
      );
    }
    console.log("─".repeat(155));
    console.log(
      `${" ".repeat(75)}│ ${fmtNum(totalDebe).padStart(12)} │ ${fmtNum(totalHaber).padStart(12)} │ saldo final: ${fmtNum(runningSaldo)}`,
    );

    // Resumen: HABER sin DEBE correspondiente por número
    console.log(`\nFacturas asociadas (Compras + EmbarqueCostos + Gastos):`);
    console.log(`  Compras       : ${compras.length}`);
    console.log(`  EmbarqueCosto : ${costos.length}`);
    console.log(`  Gastos        : ${gastos.length}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
