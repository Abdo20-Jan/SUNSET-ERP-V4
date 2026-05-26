// Backfill: poblar LineaAsiento.{monedaOrigen,montoOrigen,tipoCambioOrigen}
// retroactivamente para asientos de proveedores **del exterior** (mercadería
// EXT, servicios EXT, o país != AR) originados en Compra, Gasto, EmbarqueCosto,
// Embarque, PrestamoExterno o MovimientoTesoreria USD.
//
// Estrategia: identifica la línea-pasivo (HABER en cuenta proveedor) en cada
// asiento, y la marca con el principal USD del documento fuente y su TC.
// Idempotente: solo escribe líneas que aún no tienen monedaOrigen.
//
// IMPORTANTE: filtra por proveedor.tipoProveedor o pais. Proveedores
// nacionales con factura USD ocasional (CMA-CGM, TRP, etc.) son IGNORADOS
// porque el pago se hace en pesos y marcar HABER sin DEBE crea saldo USD
// fantasma.
//
// Uso:
//   DATABASE_URL=$(grep "^DATABASE_URL=" .env.local | cut -d= -f2- | tr -d '"') \
//     pnpm tsx prisma/backfill-moneda-origen.ts [--dry]

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Moneda, TipoProveedor } from "../src/generated/prisma/client";
import { Decimal } from "decimal.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
const DRY = process.argv.includes("--dry");

const TIPOS_EXTERIOR: TipoProveedor[] = [
  TipoProveedor.MERCADERIA_EXTERIOR,
  TipoProveedor.SERVICIOS_EXTERIOR,
];

// Identifica proveedores exteriores por tipo o por país. Cubre intercompanies
// (Sunset Tires Corp, Sunset SACIS) y servicios técnicos extranjeros.
function esExterior(p: { tipoProveedor: TipoProveedor; pais: string }): boolean {
  if (TIPOS_EXTERIOR.includes(p.tipoProveedor)) return true;
  if (p.pais && p.pais.toUpperCase() !== "AR") return true;
  return false;
}

type Stats = {
  compras: number;
  gastos: number;
  embarqueCostos: number;
  embarques: number;
  prestamos: number;
  movimientos: number;
  skipped: number;
};

const stats: Stats = {
  compras: 0,
  gastos: 0,
  embarqueCostos: 0,
  embarques: 0,
  prestamos: 0,
  movimientos: 0,
  skipped: 0,
};

async function backfillCompras() {
  const compras = await prisma.compra.findMany({
    where: { moneda: Moneda.USD, asientoId: { not: null } },
    select: {
      id: true,
      numero: true,
      proveedorId: true,
      subtotal: true,
      iva: true,
      iibb: true,
      otros: true,
      tipoCambio: true,
      asientoId: true,
      proveedor: { select: { nombre: true, cuentaContableId: true, tipoProveedor: true, pais: true } },
    },
  });

  for (const c of compras) {
    if (!c.asientoId || !c.proveedor.cuentaContableId) {
      stats.skipped++;
      continue;
    }
    if (!esExterior(c.proveedor)) {
      stats.skipped++;
      continue;
    }
    const totalSrc = new Decimal(c.subtotal.toString())
      .plus(c.iva.toString())
      .plus(c.iibb.toString())
      .plus(c.otros.toString());

    const lineas = await prisma.lineaAsiento.findMany({
      where: {
        asientoId: c.asientoId,
        cuentaId: c.proveedor.cuentaContableId,
        haber: { gt: 0 },
        monedaOrigen: null,
      },
    });
    if (lineas.length === 0) continue;
    if (!DRY) {
      await prisma.lineaAsiento.updateMany({
        where: { id: { in: lineas.map((l) => l.id) } },
        data: {
          monedaOrigen: Moneda.USD,
          montoOrigen: totalSrc.toDecimalPlaces(2).toFixed(2),
          tipoCambioOrigen: new Decimal(c.tipoCambio.toString()).toFixed(6),
        },
      });
    }
    stats.compras += lineas.length;
  }
}

async function backfillGastos() {
  const gastos = await prisma.gasto.findMany({
    where: { moneda: Moneda.USD, asientoId: { not: null } },
    select: {
      id: true,
      numero: true,
      iva: true,
      iibb: true,
      otros: true,
      tipoCambio: true,
      asientoId: true,
      proveedor: { select: { cuentaContableId: true, tipoProveedor: true, pais: true } },
      lineas: { select: { subtotal: true } },
    },
  });

  for (const g of gastos) {
    if (!g.asientoId || !g.proveedor.cuentaContableId) {
      stats.skipped++;
      continue;
    }
    if (!esExterior(g.proveedor)) {
      stats.skipped++;
      continue;
    }
    const subtotalSrc = g.lineas.reduce(
      (acc, l) => acc.plus(l.subtotal.toString()),
      new Decimal(0),
    );
    const totalSrc = subtotalSrc
      .plus(g.iva.toString())
      .plus(g.iibb.toString())
      .plus(g.otros.toString());

    const lineas = await prisma.lineaAsiento.findMany({
      where: {
        asientoId: g.asientoId,
        cuentaId: g.proveedor.cuentaContableId,
        haber: { gt: 0 },
        monedaOrigen: null,
      },
    });
    if (lineas.length === 0) continue;
    if (!DRY) {
      await prisma.lineaAsiento.updateMany({
        where: { id: { in: lineas.map((l) => l.id) } },
        data: {
          monedaOrigen: Moneda.USD,
          montoOrigen: totalSrc.toDecimalPlaces(2).toFixed(2),
          tipoCambioOrigen: new Decimal(g.tipoCambio.toString()).toFixed(6),
        },
      });
    }
    stats.gastos += lineas.length;
  }
}

async function backfillEmbarqueCostos() {
  const costos = await prisma.embarqueCosto.findMany({
    where: { moneda: Moneda.USD, asientoId: { not: null } },
    select: {
      id: true,
      iva: true,
      iibb: true,
      otros: true,
      tipoCambio: true,
      asientoId: true,
      proveedor: { select: { cuentaContableId: true, tipoProveedor: true, pais: true } },
      lineas: { select: { subtotal: true } },
    },
  });

  for (const c of costos) {
    if (!c.asientoId || !c.proveedor.cuentaContableId) {
      stats.skipped++;
      continue;
    }
    if (!esExterior(c.proveedor)) {
      stats.skipped++;
      continue;
    }
    const subtotalSrc = c.lineas.reduce(
      (acc, l) => acc.plus(l.subtotal.toString()),
      new Decimal(0),
    );
    const totalSrc = subtotalSrc
      .plus(c.iva.toString())
      .plus(c.iibb.toString())
      .plus(c.otros.toString());

    const lineas = await prisma.lineaAsiento.findMany({
      where: {
        asientoId: c.asientoId,
        cuentaId: c.proveedor.cuentaContableId,
        haber: { gt: 0 },
        monedaOrigen: null,
      },
    });
    if (lineas.length === 0) continue;
    if (!DRY) {
      await prisma.lineaAsiento.updateMany({
        where: { id: { in: lineas.map((l) => l.id) } },
        data: {
          monedaOrigen: Moneda.USD,
          montoOrigen: totalSrc.toDecimalPlaces(2).toFixed(2),
          tipoCambioOrigen: new Decimal(c.tipoCambio.toString()).toFixed(6),
        },
      });
    }
    stats.embarqueCostos += lineas.length;
  }
}

async function backfillEmbarques() {
  // Embarque tiene 2 asientos posibles: el de "cierre/nacionalización" (asientoId)
  // y el de "zona primaria" (asientoZonaPrimariaId). El FOB del proveedor exterior
  // se contabiliza una sola vez (el que existe primero).
  const embarques = await prisma.embarque.findMany({
    where: {
      moneda: Moneda.USD,
      OR: [{ asientoId: { not: null } }, { asientoZonaPrimariaId: { not: null } }],
    },
    select: {
      id: true,
      codigo: true,
      fobTotal: true,
      valorFleteOrigen: true,
      valorSeguroOrigen: true,
      tipoCambio: true,
      asientoId: true,
      asientoZonaPrimariaId: true,
      proveedor: { select: { cuentaContableId: true, tipoProveedor: true, pais: true } },
    },
  });

  for (const e of embarques) {
    if (!e.proveedor.cuentaContableId) {
      stats.skipped++;
      continue;
    }
    if (!esExterior(e.proveedor)) {
      stats.skipped++;
      continue;
    }
    const totalSrc = new Decimal(e.fobTotal.toString())
      .plus((e.valorFleteOrigen ?? 0).toString())
      .plus((e.valorSeguroOrigen ?? 0).toString());

    const asientoId = e.asientoZonaPrimariaId ?? e.asientoId;
    if (!asientoId) continue;

    const lineas = await prisma.lineaAsiento.findMany({
      where: {
        asientoId,
        cuentaId: e.proveedor.cuentaContableId,
        haber: { gt: 0 },
        monedaOrigen: null,
      },
    });
    if (lineas.length === 0) continue;
    if (!DRY) {
      await prisma.lineaAsiento.updateMany({
        where: { id: { in: lineas.map((l) => l.id) } },
        data: {
          monedaOrigen: Moneda.USD,
          montoOrigen: totalSrc.toDecimalPlaces(2).toFixed(2),
          tipoCambioOrigen: new Decimal(e.tipoCambio.toString()).toFixed(6),
        },
      });
    }
    stats.embarques += lineas.length;
  }
}

async function backfillPrestamos() {
  const prestamos = await prisma.prestamoExterno.findMany({
    where: { moneda: Moneda.USD, asientoId: { not: null } },
    select: {
      id: true,
      principal: true,
      tipoCambio: true,
      asientoId: true,
      cuentaContableId: true,
    },
  });

  for (const p of prestamos) {
    if (!p.asientoId) {
      stats.skipped++;
      continue;
    }
    const lineas = await prisma.lineaAsiento.findMany({
      where: {
        asientoId: p.asientoId,
        cuentaId: p.cuentaContableId,
        haber: { gt: 0 },
        monedaOrigen: null,
      },
    });
    if (lineas.length === 0) continue;
    if (!DRY) {
      await prisma.lineaAsiento.updateMany({
        where: { id: { in: lineas.map((l) => l.id) } },
        data: {
          monedaOrigen: Moneda.USD,
          montoOrigen: new Decimal(p.principal.toString()).toDecimalPlaces(2).toFixed(2),
          tipoCambioOrigen: new Decimal(p.tipoCambio.toString()).toFixed(6),
        },
      });
    }
    stats.prestamos += lineas.length;
  }
}

async function backfillMovimientos() {
  // Movimientos USD ya tienen asiento.moneda=USD. La línea-contrapartida
  // (PAGO/COBRO sobre la cuenta del proveedor) lleva el monto en USD
  // directamente en debe/haber. Replica esos valores en montoOrigen.
  const movs = await prisma.movimientoTesoreria.findMany({
    where: { moneda: Moneda.USD, asientoId: { not: null } },
    select: {
      id: true,
      monto: true,
      tipoCambio: true,
      asientoId: true,
      cuentaContableId: true,
      tipo: true,
    },
  });

  for (const m of movs) {
    if (!m.asientoId) continue;
    // Para PAGO la línea-contrapartida es DEBE; para COBRO es HABER.
    const lado = m.tipo === "PAGO" ? { debe: { gt: 0 } } : { haber: { gt: 0 } };
    const lineas = await prisma.lineaAsiento.findMany({
      where: {
        asientoId: m.asientoId,
        cuentaId: m.cuentaContableId,
        ...lado,
        monedaOrigen: null,
      },
    });
    if (lineas.length === 0) continue;
    if (!DRY) {
      await prisma.lineaAsiento.updateMany({
        where: { id: { in: lineas.map((l) => l.id) } },
        data: {
          monedaOrigen: Moneda.USD,
          montoOrigen: new Decimal(m.monto.toString()).toDecimalPlaces(2).toFixed(2),
          tipoCambioOrigen: new Decimal(m.tipoCambio.toString()).toFixed(6),
        },
      });
    }
    stats.movimientos += lineas.length;
  }
}

async function main() {
  console.log(`Backfill moneda-origen ${DRY ? "(DRY RUN)" : ""}`);
  console.log("---");

  await backfillCompras();
  await backfillGastos();
  await backfillEmbarqueCostos();
  await backfillEmbarques();
  await backfillPrestamos();
  await backfillMovimientos();

  console.log("Líneas marcadas con monedaOrigen=USD:");
  console.log(`  Compras:         ${stats.compras}`);
  console.log(`  Gastos:          ${stats.gastos}`);
  console.log(`  EmbarqueCostos:  ${stats.embarqueCostos}`);
  console.log(`  Embarques (FOB): ${stats.embarques}`);
  console.log(`  Préstamos:       ${stats.prestamos}`);
  console.log(`  Movimientos:     ${stats.movimientos}`);
  console.log(`  Skipped:         ${stats.skipped}`);
  console.log(
    `  TOTAL:           ${
      stats.compras +
      stats.gastos +
      stats.embarqueCostos +
      stats.embarques +
      stats.prestamos +
      stats.movimientos
    }`,
  );
  if (DRY) {
    console.log("\nDRY RUN — ninguna escritura. Quitá --dry para aplicar.");
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
