/**
 * E6 (PE.7) — Validador de invariantes del LEDGER contable.
 *
 * Espejo de `validar-invariantes-stock.ts`, pero para los asientos. El motor
 * (`asiento-automatico.ts`) garantiza partida doble + moneda ARS en la
 * CREACIÓN; este validador audita los asientos YA GRABADOS contra corrupción /
 * drift (un `db push` viejo, un bug, una escritura fuera del motor). Replica la
 * regla canónica del ledger (ver memoria `regra-pago-exterior-usd`):
 *
 *   "el libro diario se registra 100% en ARS (debe/haber); el principal en
 *    moneda extranjera viaja en la metadata de cada línea
 *    (monedaOrigen/montoOrigen/tipoCambioOrigen); el saldo USD = Σ montoOrigen."
 *
 * Invariantes (sobre TODOS los asientos, cualquier estado — balance/moneda/
 * metadata valen para todo asiento creado; ANULADO usa contra-asiento y sus
 * líneas siguen siendo válidas):
 *
 *   A1: Asiento.moneda == ARS.
 *   A2: Asiento.totalDebe == Asiento.totalHaber (partida doble).
 *   A3: Σ(líneas.debe) == totalDebe  y  Σ(líneas.haber) == totalHaber.
 *   A4: cada LineaAsiento tiene EXACTAMENTE un lado > 0 (debe XOR haber) y
 *       ningún valor negativo.
 *   A5: monedaOrigen ∈ {USD, null} (nunca ARS); si USD → montoOrigen > 0 y
 *       tipoCambioOrigen > 0; si null → montoOrigen y tipoCambioOrigen ambos
 *       null. (Garantiza que "saldo USD = Σ montoOrigen" sea siempre derivable:
 *       toda línea USD tiene su montoOrigen.)
 *
 * Diseñado para correr en cron (CI diario contra prod) o manualmente. Hace 3
 * queries (sin N+1). Exit code:
 *   - 0: todas las invariantes satisfechas.
 *   - 1: una o más violaciones encontradas.
 *   - 2: error fatal.
 *
 * Uso:
 *   pnpm db:validar-asientos
 */

import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../src/generated/prisma/client";

export type ViolacionAsiento = {
  invariante: string;
  asientoId: string;
  asientoNumero: number;
  periodoId: number;
  detalle: string;
};

const CERO = new Prisma.Decimal(0);

export async function validarAsientos(prisma: PrismaClient): Promise<ViolacionAsiento[]> {
  const violaciones: ViolacionAsiento[] = [];

  // (1) Asientos con campos baratos → A1 (moneda) y A2 (partida doble).
  const asientos = await prisma.asiento.findMany({
    select: {
      id: true,
      numero: true,
      periodoId: true,
      moneda: true,
      totalDebe: true,
      totalHaber: true,
    },
    orderBy: [{ periodoId: "asc" }, { numero: "asc" }],
  });
  const porId = new Map<string, (typeof asientos)[number]>();
  for (const a of asientos) {
    porId.set(a.id, a);
    if (a.moneda !== "ARS") {
      violaciones.push({
        invariante: "A1: Asiento.moneda == ARS",
        asientoId: a.id,
        asientoNumero: a.numero,
        periodoId: a.periodoId,
        detalle: `moneda=${a.moneda}`,
      });
    }
    if (!new Prisma.Decimal(a.totalDebe).equals(a.totalHaber)) {
      violaciones.push({
        invariante: "A2: totalDebe == totalHaber (partida doble)",
        asientoId: a.id,
        asientoNumero: a.numero,
        periodoId: a.periodoId,
        detalle: `totalDebe=${a.totalDebe} totalHaber=${a.totalHaber}`,
      });
    }
  }

  // (2) Σ líneas por asiento → A3 (totales == suma de líneas). groupBy evita
  // N+1; un asiento sin líneas no aparece acá → Σ tratada como 0.
  const sumas = await prisma.lineaAsiento.groupBy({
    by: ["asientoId"],
    _sum: { debe: true, haber: true },
  });
  const sumPorId = new Map<string, { debe: Prisma.Decimal; haber: Prisma.Decimal }>();
  for (const s of sumas) {
    sumPorId.set(s.asientoId, { debe: s._sum.debe ?? CERO, haber: s._sum.haber ?? CERO });
  }
  for (const a of asientos) {
    const s = sumPorId.get(a.id) ?? { debe: CERO, haber: CERO };
    const debeOk = s.debe.equals(a.totalDebe);
    const haberOk = s.haber.equals(a.totalHaber);
    if (!debeOk || !haberOk) {
      violaciones.push({
        invariante: "A3: Σ líneas == totales del asiento",
        asientoId: a.id,
        asientoNumero: a.numero,
        periodoId: a.periodoId,
        detalle: `Σdebe=${s.debe.toFixed(2)} (totalDebe=${a.totalDebe}) Σhaber=${s.haber.toFixed(2)} (totalHaber=${a.totalHaber})`,
      });
    }
  }

  // (3) Líneas → A4 (XOR debe/haber + no-negativo) y A5 (metadata USD). Una
  // sola findMany; el asiento se resuelve vía `porId` para numerar la violación.
  const lineas = await prisma.lineaAsiento.findMany({
    select: {
      id: true,
      asientoId: true,
      debe: true,
      haber: true,
      monedaOrigen: true,
      montoOrigen: true,
      tipoCambioOrigen: true,
    },
    orderBy: { id: "asc" },
  });
  for (const l of lineas) {
    const a = porId.get(l.asientoId);
    const numero = a?.numero ?? -1;
    const periodo = a?.periodoId ?? -1;
    const debe = new Prisma.Decimal(l.debe);
    const haber = new Prisma.Decimal(l.haber);

    // A4 — no-negativo.
    if (debe.isNegative() || haber.isNegative()) {
      violaciones.push({
        invariante: "A4: debe/haber no pueden ser negativos",
        asientoId: l.asientoId,
        asientoNumero: numero,
        periodoId: periodo,
        detalle: `línea=${l.id} debe=${l.debe} haber=${l.haber}`,
      });
    }
    // A4 — XOR: exactamente un lado > 0.
    const debePos = debe.gt(0);
    const haberPos = haber.gt(0);
    if (debePos === haberPos) {
      violaciones.push({
        invariante: "A4: cada línea tiene exactamente un lado > 0 (debe XOR haber)",
        asientoId: l.asientoId,
        asientoNumero: numero,
        periodoId: periodo,
        detalle: `línea=${l.id} debe=${l.debe} haber=${l.haber}`,
      });
    }

    // A5 — metadata USD.
    const mo = l.monedaOrigen;
    if (mo !== null && mo !== "USD") {
      violaciones.push({
        invariante: "A5: monedaOrigen ∈ {USD, null}",
        asientoId: l.asientoId,
        asientoNumero: numero,
        periodoId: periodo,
        detalle: `línea=${l.id} monedaOrigen=${mo}`,
      });
    } else if (mo === "USD") {
      const montoOk = l.montoOrigen !== null && new Prisma.Decimal(l.montoOrigen).gt(0);
      const tcOk = l.tipoCambioOrigen !== null && new Prisma.Decimal(l.tipoCambioOrigen).gt(0);
      if (!montoOk || !tcOk) {
        violaciones.push({
          invariante: "A5: línea USD requiere montoOrigen>0 y tipoCambioOrigen>0",
          asientoId: l.asientoId,
          asientoNumero: numero,
          periodoId: periodo,
          detalle: `línea=${l.id} montoOrigen=${l.montoOrigen ?? "null"} tipoCambioOrigen=${l.tipoCambioOrigen ?? "null"}`,
        });
      }
    } else {
      // monedaOrigen === null → no debe haber metadata USD huérfana.
      if (l.montoOrigen !== null || l.tipoCambioOrigen !== null) {
        violaciones.push({
          invariante: "A5: monedaOrigen=null requiere montoOrigen/tipoCambioOrigen null",
          asientoId: l.asientoId,
          asientoNumero: numero,
          periodoId: periodo,
          detalle: `línea=${l.id} montoOrigen=${l.montoOrigen ?? "null"} tipoCambioOrigen=${l.tipoCambioOrigen ?? "null"}`,
        });
      }
    }
  }

  return violaciones;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  try {
    const violaciones = await validarAsientos(prisma);
    if (violaciones.length === 0) {
      console.log("✓ Todas las invariantes del ledger contable están satisfechas.");
      process.exit(0);
    }
    console.error(`✗ ${violaciones.length} violación(es) encontrada(s):\n`);
    for (const v of violaciones) {
      console.error(
        `  [${v.invariante}] asiento=${v.asientoNumero} (período=${v.periodoId}, id=${v.asientoId}) → ${v.detalle}`,
      );
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Sólo auto-ejecuta cuando se corre como script (tsx/CLI), no al importarse
// desde un test — así `validarAsientos` se puede probar sin disparar process.exit.
const ejecutadoComoScript =
  typeof process.argv[1] === "string" && import.meta.url === `file://${process.argv[1]}`;
if (ejecutadoComoScript) {
  main().catch((err: unknown) => {
    console.error("✗ Error fatal:", err instanceof Error ? err.message : err);
    process.exit(2);
  });
}
