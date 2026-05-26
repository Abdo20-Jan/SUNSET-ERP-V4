// Diagnóstico ANTES/DEPOIS del backfill moneda-origen.
//
// Lista cada línea que sería marcada con monedaOrigen=USD y muestra el
// impacto consolidado por cuenta de proveedor exterior. Lectura pura.
//
// Uso:
//   DATABASE_URL=$(grep '^DATABASE_URL=' .env.local | cut -d= -f2- | tr -d '"') \
//     pnpm tsx prisma/diag-moneda-origen.ts

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Moneda } from "../src/generated/prisma/client";
import { Decimal } from "decimal.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

type Hit = {
  origen: string;
  refDoc: string;
  asientoId: string;
  asientoNumero: number | null;
  lineaId: number;
  cuentaCodigo: string;
  cuentaNombre: string;
  proveedor: string;
  lado: "DEBE" | "HABER";
  arsActual: Decimal;
  usdNuevo: Decimal;
  tcOrigen: Decimal;
};

function fmt(d: Decimal, decimals = 2): string {
  return d.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

async function recolectarHits(): Promise<Hit[]> {
  const hits: Hit[] = [];

  // ----- Compras USD
  const compras = await prisma.compra.findMany({
    where: { moneda: Moneda.USD, asientoId: { not: null } },
    select: {
      id: true,
      numero: true,
      subtotal: true,
      iva: true,
      iibb: true,
      otros: true,
      tipoCambio: true,
      asientoId: true,
      asiento: { select: { numero: true } },
      proveedor: {
        select: {
          nombre: true,
          cuentaContableId: true,
          cuentaContable: { select: { codigo: true, nombre: true } },
        },
      },
    },
  });
  for (const c of compras) {
    if (!c.asientoId || !c.proveedor.cuentaContableId) continue;
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
    for (const l of lineas) {
      hits.push({
        origen: "Compra",
        refDoc: c.numero,
        asientoId: c.asientoId,
        asientoNumero: c.asiento?.numero ?? null,
        lineaId: l.id,
        cuentaCodigo: c.proveedor.cuentaContable!.codigo,
        cuentaNombre: c.proveedor.cuentaContable!.nombre,
        proveedor: c.proveedor.nombre,
        lado: "HABER",
        arsActual: new Decimal(l.haber.toString()),
        usdNuevo: totalSrc.toDecimalPlaces(2),
        tcOrigen: new Decimal(c.tipoCambio.toString()),
      });
    }
  }

  // ----- Gastos USD
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
      asiento: { select: { numero: true } },
      proveedor: {
        select: {
          nombre: true,
          cuentaContableId: true,
          cuentaContable: { select: { codigo: true, nombre: true } },
        },
      },
      lineas: { select: { subtotal: true } },
    },
  });
  for (const g of gastos) {
    if (!g.asientoId || !g.proveedor.cuentaContableId) continue;
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
    for (const l of lineas) {
      hits.push({
        origen: "Gasto",
        refDoc: g.numero,
        asientoId: g.asientoId,
        asientoNumero: g.asiento?.numero ?? null,
        lineaId: l.id,
        cuentaCodigo: g.proveedor.cuentaContable!.codigo,
        cuentaNombre: g.proveedor.cuentaContable!.nombre,
        proveedor: g.proveedor.nombre,
        lado: "HABER",
        arsActual: new Decimal(l.haber.toString()),
        usdNuevo: totalSrc.toDecimalPlaces(2),
        tcOrigen: new Decimal(g.tipoCambio.toString()),
      });
    }
  }

  // ----- EmbarqueCostos USD
  const costos = await prisma.embarqueCosto.findMany({
    where: { moneda: Moneda.USD, asientoId: { not: null } },
    select: {
      id: true,
      facturaNumero: true,
      iva: true,
      iibb: true,
      otros: true,
      tipoCambio: true,
      asientoId: true,
      asiento: { select: { numero: true } },
      proveedor: {
        select: {
          nombre: true,
          cuentaContableId: true,
          cuentaContable: { select: { codigo: true, nombre: true } },
        },
      },
      embarque: { select: { codigo: true } },
      lineas: { select: { subtotal: true } },
    },
  });
  for (const c of costos) {
    if (!c.asientoId || !c.proveedor.cuentaContableId) continue;
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
    for (const l of lineas) {
      hits.push({
        origen: "EmbarqueCosto",
        refDoc: `${c.embarque.codigo} / ${c.facturaNumero ?? `#${c.id}`}`,
        asientoId: c.asientoId,
        asientoNumero: c.asiento?.numero ?? null,
        lineaId: l.id,
        cuentaCodigo: c.proveedor.cuentaContable!.codigo,
        cuentaNombre: c.proveedor.cuentaContable!.nombre,
        proveedor: c.proveedor.nombre,
        lado: "HABER",
        arsActual: new Decimal(l.haber.toString()),
        usdNuevo: totalSrc.toDecimalPlaces(2),
        tcOrigen: new Decimal(c.tipoCambio.toString()),
      });
    }
  }

  // ----- Embarques FOB
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
      proveedor: {
        select: {
          nombre: true,
          cuentaContableId: true,
          cuentaContable: { select: { codigo: true, nombre: true } },
        },
      },
    },
  });
  for (const e of embarques) {
    if (!e.proveedor.cuentaContableId) continue;
    const asientoId = e.asientoZonaPrimariaId ?? e.asientoId;
    if (!asientoId) continue;
    const totalSrc = new Decimal(e.fobTotal.toString())
      .plus((e.valorFleteOrigen ?? 0).toString())
      .plus((e.valorSeguroOrigen ?? 0).toString());
    const lineas = await prisma.lineaAsiento.findMany({
      where: {
        asientoId,
        cuentaId: e.proveedor.cuentaContableId,
        haber: { gt: 0 },
        monedaOrigen: null,
      },
      include: { asiento: { select: { numero: true } } },
    });
    for (const l of lineas) {
      hits.push({
        origen: "Embarque (FOB)",
        refDoc: e.codigo,
        asientoId,
        asientoNumero: l.asiento.numero,
        lineaId: l.id,
        cuentaCodigo: e.proveedor.cuentaContable!.codigo,
        cuentaNombre: e.proveedor.cuentaContable!.nombre,
        proveedor: e.proveedor.nombre,
        lado: "HABER",
        arsActual: new Decimal(l.haber.toString()),
        usdNuevo: totalSrc.toDecimalPlaces(2),
        tcOrigen: new Decimal(e.tipoCambio.toString()),
      });
    }
  }

  // ----- Préstamos
  const prestamos = await prisma.prestamoExterno.findMany({
    where: { moneda: Moneda.USD, asientoId: { not: null } },
    select: {
      id: true,
      prestamista: true,
      principal: true,
      tipoCambio: true,
      asientoId: true,
      cuentaContableId: true,
      cuentaContable: { select: { codigo: true, nombre: true } },
      asiento: { select: { numero: true } },
    },
  });
  for (const p of prestamos) {
    if (!p.asientoId) continue;
    const lineas = await prisma.lineaAsiento.findMany({
      where: {
        asientoId: p.asientoId,
        cuentaId: p.cuentaContableId,
        haber: { gt: 0 },
        monedaOrigen: null,
      },
    });
    for (const l of lineas) {
      hits.push({
        origen: "Préstamo",
        refDoc: p.prestamista,
        asientoId: p.asientoId,
        asientoNumero: p.asiento?.numero ?? null,
        lineaId: l.id,
        cuentaCodigo: p.cuentaContable.codigo,
        cuentaNombre: p.cuentaContable.nombre,
        proveedor: p.prestamista,
        lado: "HABER",
        arsActual: new Decimal(l.haber.toString()),
        usdNuevo: new Decimal(p.principal.toString()).toDecimalPlaces(2),
        tcOrigen: new Decimal(p.tipoCambio.toString()),
      });
    }
  }

  // ----- Movimientos USD (pagos/cobros)
  const movs = await prisma.movimientoTesoreria.findMany({
    where: { moneda: Moneda.USD, asientoId: { not: null } },
    select: {
      id: true,
      tipo: true,
      monto: true,
      tipoCambio: true,
      asientoId: true,
      cuentaContableId: true,
      cuentaContable: { select: { codigo: true, nombre: true } },
      descripcion: true,
      asiento: { select: { numero: true } },
    },
  });
  for (const m of movs) {
    if (!m.asientoId) continue;
    const ladoPrisma = m.tipo === "PAGO" ? { debe: { gt: 0 } } : { haber: { gt: 0 } };
    const lado: "DEBE" | "HABER" = m.tipo === "PAGO" ? "DEBE" : "HABER";
    const lineas = await prisma.lineaAsiento.findMany({
      where: {
        asientoId: m.asientoId,
        cuentaId: m.cuentaContableId,
        ...ladoPrisma,
        monedaOrigen: null,
      },
    });
    for (const l of lineas) {
      const ars = lado === "DEBE" ? l.debe : l.haber;
      hits.push({
        origen: `Mov ${m.tipo}`,
        refDoc: m.descripcion?.slice(0, 40) ?? `mov#${m.id}`,
        asientoId: m.asientoId,
        asientoNumero: m.asiento?.numero ?? null,
        lineaId: l.id,
        cuentaCodigo: m.cuentaContable?.codigo ?? "?",
        cuentaNombre: m.cuentaContable?.nombre ?? "?",
        proveedor: m.cuentaContable?.nombre ?? "?",
        lado,
        arsActual: new Decimal(ars.toString()),
        usdNuevo: new Decimal(m.monto.toString()).toDecimalPlaces(2),
        tcOrigen: new Decimal(m.tipoCambio.toString()),
      });
    }
  }

  return hits;
}

async function impactoPorCuenta(hits: Hit[]) {
  // Agrupa por cuenta y muestra:
  //   - Total HABER USD que será marcado (lo facturado a USD)
  //   - Total DEBE USD que será marcado (los pagos USD-natos ya hechos)
  //   - Saldo USD pós-backfill (haber - debe) — esto es lo que el dashboard mostrará
  //   - Saldo ARS contable actual (sin cambios)
  //   - "Pagos en pesos" = saldo ARS / TC_origem médio - lo que NO está rastreable como USD

  const cuentaIds = [...new Set(hits.map((h) => `${h.cuentaCodigo}|${h.cuentaNombre}`))];

  console.log("\n========================================");
  console.log("Impacto consolidado por cuenta");
  console.log("========================================\n");

  for (const key of cuentaIds) {
    const [codigo, nombre] = key.split("|");
    const cuentaHits = hits.filter((h) => `${h.cuentaCodigo}|${h.cuentaNombre}` === key);
    if (cuentaHits.length === 0) continue;

    const haberUsdNuevo = cuentaHits
      .filter((h) => h.lado === "HABER")
      .reduce((acc, h) => acc.plus(h.usdNuevo), new Decimal(0));
    const debeUsdNuevo = cuentaHits
      .filter((h) => h.lado === "DEBE")
      .reduce((acc, h) => acc.plus(h.usdNuevo), new Decimal(0));
    const saldoUsdNuevo = haberUsdNuevo.minus(debeUsdNuevo);

    // Saldo ARS contable actual (sin cambios después del backfill)
    const cuentaRow = await prisma.cuentaContable.findFirst({
      where: { codigo, nombre },
      select: { id: true },
    });
    const cuentaId = cuentaRow?.id;

    let saldoArsAct = new Decimal(0);
    let totalLineas = 0;
    let lineasSinUsdHaber = new Decimal(0);
    let lineasSinUsdDebe = new Decimal(0);
    if (cuentaId) {
      const sums = await prisma.lineaAsiento.aggregate({
        where: { cuentaId, asiento: { estado: "CONTABILIZADO" } },
        _sum: { debe: true, haber: true },
        _count: true,
      });
      const haberArs = new Decimal((sums._sum.haber ?? 0).toString());
      const debeArs = new Decimal((sums._sum.debe ?? 0).toString());
      saldoArsAct = haberArs.minus(debeArs);
      totalLineas = sums._count;

      // Líneas que NO serán marcadas (probablemente pagos en pesos)
      const lineasARS = await prisma.lineaAsiento.findMany({
        where: {
          cuentaId,
          asiento: { estado: "CONTABILIZADO" },
          monedaOrigen: null,
        },
        select: { debe: true, haber: true, id: true },
      });
      const hitsLineaIds = new Set(cuentaHits.map((h) => h.lineaId));
      for (const l of lineasARS) {
        if (hitsLineaIds.has(l.id)) continue; // será marcada, ignorar acá
        lineasSinUsdHaber = lineasSinUsdHaber.plus(l.haber.toString());
        lineasSinUsdDebe = lineasSinUsdDebe.plus(l.debe.toString());
      }
    }

    console.log(`▸ ${codigo} ${nombre}`);
    console.log(`   Líneas totales en la cuenta: ${totalLineas}`);
    console.log(`   ─ A marcar USD-nato ─`);
    console.log(`   HABER USD (facturado):           US$ ${fmt(haberUsdNuevo)}`);
    console.log(`   DEBE  USD (pagos USD ya hechos): US$ ${fmt(debeUsdNuevo)}`);
    console.log(`   ▶ SALDO USD pós-backfill:         US$ ${fmt(saldoUsdNuevo)}`);
    console.log(`   ─ Líneas sin marca (probablemente pagos/ajustes en pesos) ─`);
    console.log(`   DEBE  ARS no-marcados:  $ ${fmt(lineasSinUsdDebe)}`);
    console.log(`   HABER ARS no-marcados:  $ ${fmt(lineasSinUsdHaber)}`);
    console.log(`   ─ Saldo contable ARS (sin cambio) ─`);
    console.log(`   ▶ SALDO ARS actual:               $ ${fmt(saldoArsAct)}`);
    console.log();
  }
}

async function main() {
  const dbHost = process.env.DATABASE_URL?.match(/@([^/:]+)/)?.[1] ?? "?";
  console.log(`→ DB host: ${dbHost}\n`);

  const hits = await recolectarHits();

  console.log("========================================");
  console.log(`Detalle de las ${hits.length} líneas a marcar`);
  console.log("========================================\n");

  for (const h of hits) {
    console.log(
      `[${h.origen}] ${h.refDoc} ─ Asiento #${h.asientoNumero ?? "?"} ─ Línea #${h.lineaId}`,
    );
    console.log(`   Cuenta: ${h.cuentaCodigo} ${h.cuentaNombre}`);
    console.log(`   ${h.lado} ARS actual:   $ ${fmt(h.arsActual)}`);
    console.log(`   ${h.lado} USD a marcar: US$ ${fmt(h.usdNuevo)}  (TC origem: ${fmt(h.tcOrigen, 4)})`);
    console.log();
  }

  await impactoPorCuenta(hits);

  console.log("========================================");
  console.log("Notas importantes");
  console.log("========================================");
  console.log("• El backfill SOLO marca metadata — NO cambia debe/haber ARS.");
  console.log("• Saldo ARS contable permanece exactamente igual.");
  console.log("• 'Líneas sin marca' = pagos hechos en pesos contra la deuda USD.");
  console.log("  Esos no reducen el saldo USD automáticamente (no hay rastro");
  console.log("  USD en la transacción). Para limpiar, se necesita un asiento");
  console.log("  manual de ajuste o esperar fase 2 (UI fx-aware).");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
