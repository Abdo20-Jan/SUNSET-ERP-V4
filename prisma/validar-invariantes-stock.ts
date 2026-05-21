/**
 * W3.3 — Validador de invariantes stock dual.
 *
 * Verifica que los datos de stock estén consistentes después del
 * backfill (W3.3) y de cualquier movimento posterior:
 *
 *   Invariante 1: SUM(StockPorDeposito.cantidadFisica) por producto
 *                 == Producto.stockActual
 *
 *   Invariante 2: Para cada StockPorDeposito,
 *                 cantidadReservada >= 0 y cantidadFisica >= cantidadReservada
 *                 (no se puede reservar más de lo que hay físicamente).
 *
 *   Invariante 3: Para cada StockPorDeposito,
 *                 cantidadFisica >= 0
 *
 * PR 6.2 — invariantes comex (flujo contenedor/desconsolidación):
 *
 *   Invariante 4 (counters ItemContenedor): para cada ItemContenedor ya
 *                 desconsolidado (cantidadFisica != null) cuyo contenedor
 *                 NO está AGUARDANDO_INVESTIGACAO (counts aún sin trabar),
 *                 cantidadDisponible + cantidadEnDespacho + cantidadDespachada
 *                 == cantidadFisica. Detecta divergencia silenciosa entre los
 *                 counters lazy (D1-bis) y el físico registrado en la
 *                 conferencia / MovimientoStock.
 *
 *   Invariante 5 (borrador trabado vencido): ningún DespachoBorrador con
 *                 expiresAt < now sigue en CONFIRMADO_TRABA_COUNTS con
 *                 countsTrabados pendientes — eso significa que el cron de
 *                 expiración (P0-4) no revirtió los counters y el stock en
 *                 cantidadEnDespacho quedó trabado indefinidamente.
 *
 *   Invariante 6 (investigación parada): ninguna Desconsolidacion cuyo
 *                 contenedor sigue AGUARDANDO_INVESTIGACAO (D9) hace más de
 *                 7 días — alerta de divergencia formal sin cerrar.
 *
 * Diseñado para correr en cron (CI diario) o manualmente. Exit code:
 *  - 0: todas las invariantes satisfechas.
 *  - 1: una o más violaciones encontradas.
 *
 * Uso:
 *   pnpm db:validar-stock
 *   pnpm db:validar-stock --recalcular-reservas   (S3.3: reconstruye
 *     SPD.cantidadReservada desde ventas EMITIDA pendientes antes de
 *     validar — útil después de un replay de movimientos.)
 */

import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { recalcularReservasPorProducto } from "../src/lib/services/stock-recalc";

export type Violacion = {
  invariante: string;
  productoCodigo: string;
  productoId: string;
  depositoId?: string;
  detalle: string;
};

// Estado del contenedor que trabajaba los counts a 0 a propósito (gate D9):
// mientras la divergencia se investiga, los counters NO reflejan el físico.
const ESTADO_AGUARDANDO_INVESTIGACAO = "AGUARDANDO_INVESTIGACAO";
// Borrador con counters trabados (cantidadEnDespacho reservada) — debe
// revertirse al expirar (P0-4).
const ESTADO_BORRADOR_CONFIRMADO = "CONFIRMADO_TRABA_COUNTS";
// Umbral de alerta para una investigación de divergencia parada.
const DIAS_LIMITE_INVESTIGACION = 7;

/**
 * Invariantes comex sobre el flujo de contenedores (PR 6.2). Devuelve las
 * violaciones en el mismo formato que `validar` para reusar el reporte.
 * `productoCodigo`/`productoId` se reaprovechan como entidad afectada
 * (contenedor/borrador) cuando no aplica un producto puntual.
 */
export async function validarComex(prisma: PrismaClient): Promise<Violacion[]> {
  const violaciones: Violacion[] = [];

  // Invariante 4: Σ counters == cantidadFisica para items ya desconsolidados
  // cuyo contenedor no está AGUARDANDO_INVESTIGACAO.
  const items = await prisma.itemContenedor.findMany({
    where: {
      cantidadFisica: { not: null },
      contenedor: { estado: { not: ESTADO_AGUARDANDO_INVESTIGACAO } },
    },
    select: {
      id: true,
      contenedorId: true,
      cantidadFisica: true,
      cantidadDisponible: true,
      cantidadEnDespacho: true,
      cantidadDespachada: true,
      producto: { select: { codigo: true } },
      productoId: true,
    },
  });
  for (const it of items) {
    const fisica = it.cantidadFisica ?? 0;
    const suma = it.cantidadDisponible + it.cantidadEnDespacho + it.cantidadDespachada;
    if (suma !== fisica) {
      violaciones.push({
        invariante: "4: ItemContenedor disponible+enDespacho+despachada == cantidadFisica",
        productoCodigo: it.producto.codigo,
        productoId: it.productoId,
        detalle: `itemContenedor=${it.id} contenedor=${it.contenedorId} fisica=${fisica} disponible=${it.cantidadDisponible} enDespacho=${it.cantidadEnDespacho} despachada=${it.cantidadDespachada} (suma=${suma})`,
      });
    }
  }

  // Invariante 5: borrador vencido aún CONFIRMADO_TRABA_COUNTS con counts
  // pendientes → el cron de expiración no liberó los counters.
  const borradoresTrabados = await prisma.despachoBorrador.findMany({
    where: { estadoActual: ESTADO_BORRADOR_CONFIRMADO, expiresAt: { lt: new Date() } },
    select: { id: true, embarqueId: true, countsTrabados: true, expiresAt: true },
  });
  for (const b of borradoresTrabados) {
    const counts = b.countsTrabados;
    const tieneCounts =
      counts !== null && typeof counts === "object" && Object.keys(counts).length > 0;
    if (tieneCounts) {
      violaciones.push({
        invariante: "5: DespachoBorrador vencido sin revertir counters trabados",
        productoCodigo: "(borrador)",
        productoId: b.id,
        detalle: `borrador=${b.id} embarque=${b.embarqueId ?? "?"} expiró=${b.expiresAt.toISOString()} countsTrabados=${JSON.stringify(counts)}`,
      });
    }
  }

  // Invariante 6: Desconsolidacion cuyo contenedor sigue AGUARDANDO_INVESTIGACAO
  // hace más de 7 días.
  const limite = new Date(Date.now() - DIAS_LIMITE_INVESTIGACION * 24 * 60 * 60 * 1000);
  const investigacionesParadas = await prisma.desconsolidacion.findMany({
    where: {
      contenedor: { estado: ESTADO_AGUARDANDO_INVESTIGACAO },
      fecha: { lt: limite },
    },
    select: {
      id: true,
      contenedorId: true,
      fecha: true,
      contenedor: { select: { numeroContenedor: true } },
    },
  });
  for (const d of investigacionesParadas) {
    const dias = Math.floor((Date.now() - d.fecha.getTime()) / (24 * 60 * 60 * 1000));
    violaciones.push({
      invariante: `6: Desconsolidacion AGUARDANDO_INVESTIGACAO > ${DIAS_LIMITE_INVESTIGACION} días`,
      productoCodigo: "(contenedor)",
      productoId: d.contenedorId,
      detalle: `desconsolidacion=${d.id} contenedor=${d.contenedor.numeroContenedor} fecha=${d.fecha.toISOString()} (${dias} días sin cerrar)`,
    });
  }

  return violaciones;
}

async function validar(prisma: PrismaClient): Promise<Violacion[]> {
  const violaciones: Violacion[] = [];

  // Invariante 1: SUM(SPD.fisica) por producto == Producto.stockActual
  const productos = await prisma.producto.findMany({
    select: { id: true, codigo: true, stockActual: true },
    orderBy: { codigo: "asc" },
  });
  for (const p of productos) {
    const agg = await prisma.stockPorDeposito.aggregate({
      where: { productoId: p.id },
      _sum: { cantidadFisica: true },
    });
    const sum = agg._sum.cantidadFisica ?? 0;
    if (sum !== p.stockActual) {
      violaciones.push({
        invariante: "1: SUM(SPD.fisica) == Producto.stockActual",
        productoCodigo: p.codigo,
        productoId: p.id,
        detalle: `esperado=${p.stockActual} actual=${sum}`,
      });
    }
  }

  // Invariantes 2 y 3: por (producto, depósito)
  const todos = await prisma.stockPorDeposito.findMany({
    select: {
      productoId: true,
      depositoId: true,
      cantidadFisica: true,
      cantidadReservada: true,
      producto: { select: { codigo: true } },
    },
  });
  for (const spd of todos) {
    if (spd.cantidadFisica < 0) {
      violaciones.push({
        invariante: "3: cantidadFisica >= 0",
        productoCodigo: spd.producto.codigo,
        productoId: spd.productoId,
        depositoId: spd.depositoId,
        detalle: `cantidadFisica=${spd.cantidadFisica}`,
      });
    }
    if (spd.cantidadReservada < 0) {
      violaciones.push({
        invariante: "2a: cantidadReservada >= 0",
        productoCodigo: spd.producto.codigo,
        productoId: spd.productoId,
        depositoId: spd.depositoId,
        detalle: `cantidadReservada=${spd.cantidadReservada}`,
      });
    }
    if (spd.cantidadFisica < spd.cantidadReservada) {
      violaciones.push({
        invariante: "2b: cantidadFisica >= cantidadReservada",
        productoCodigo: spd.producto.codigo,
        productoId: spd.productoId,
        depositoId: spd.depositoId,
        detalle: `fisica=${spd.cantidadFisica} reservada=${spd.cantidadReservada}`,
      });
    }
  }

  return violaciones;
}

async function recalcularReservas(prisma: PrismaClient): Promise<void> {
  const productos = await prisma.producto.findMany({
    select: { id: true, codigo: true },
    orderBy: { codigo: "asc" },
  });
  console.log(`→ Recalculando reservas para ${productos.length} producto(s)...`);
  let n = 0;
  for (const p of productos) {
    await prisma.$transaction(async (tx) => {
      await recalcularReservasPorProducto(tx, p.id);
    });
    n++;
  }
  console.log(`✓ Reservas recalculadas (${n} productos procesados).`);
}

async function main(): Promise<void> {
  const recalcular = process.argv.includes("--recalcular-reservas");

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  try {
    if (recalcular) {
      await recalcularReservas(prisma);
    }
    const violaciones = [...(await validar(prisma)), ...(await validarComex(prisma))];
    if (violaciones.length === 0) {
      console.log("✓ Todas las invariantes de stock dual + comex están satisfechas.");
      process.exit(0);
    }
    console.error(`✗ ${violaciones.length} violación(es) encontrada(s):\n`);
    for (const v of violaciones) {
      const dep = v.depositoId ? ` deposito=${v.depositoId}` : "";
      console.error(
        `  [${v.invariante}] producto=${v.productoCodigo} (${v.productoId})${dep} → ${v.detalle}`,
      );
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Sólo auto-ejecuta cuando se corre como script (tsx/CLI), no al importarse
// desde un test — así `validarComex` se puede probar sin disparar process.exit.
const ejecutadoComoScript =
  typeof process.argv[1] === "string" && import.meta.url === `file://${process.argv[1]}`;
if (ejecutadoComoScript) {
  main().catch((err: unknown) => {
    console.error("✗ Error fatal:", err instanceof Error ? err.message : err);
    process.exit(2);
  });
}
