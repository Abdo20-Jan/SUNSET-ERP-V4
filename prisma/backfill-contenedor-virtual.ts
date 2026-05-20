import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  type ContenedorEstado,
  type EmbarqueEstado,
  PrismaClient,
} from "../src/generated/prisma/client";

/**
 * PR 2.4 — Backfill LAZY de contenedor virtual (decisión D7).
 *
 * Los embarques legados (anteriores al modelo de contenedores) NO ganan
 * contenedor automáticamente al activar la flag. Este script crea, bajo
 * demanda y por embarque, UN "contenedor virtual" que envuelve todo el
 * packing list del embarque (1 ItemContenedor por ItemEmbarque), para que
 * el flujo nuevo (Fases 2-4) pueda operar sobre embarques históricos
 * cuando son "tocados".
 *
 * Propiedades:
 *  - Idempotente: si el embarque ya tiene contenedores, lo saltea.
 *  - Dry-run por defecto: imprime el plan sin escribir. `--apply` ejecuta.
 *  - Granular: `--embarque <id>` procesa uno; `--all` procesa todos los
 *    embarques sin contenedores (universo pequeño, ~5 históricos).
 *
 * NOTA (deferred a Fase 2/3): los counters (cantidadDisponible /
 * EnDespacho / Despachada) se dejan en 0. La reconciliación de cuánto
 * sigue disponible vs ya despachado en un embarque legado (leyendo
 * StockPorDeposito + despachos existentes) se resuelve cuando el embarque
 * es efectivamente tocado por una operación nueva, no en este backfill
 * estructural. `cantidadFisica` se setea = cantidadDeclarada (sin
 * conferencia de divergencia histórica).
 *
 * Uso:
 *   pnpm tsx prisma/backfill-contenedor-virtual.ts --embarque <id>          # dry-run
 *   pnpm tsx prisma/backfill-contenedor-virtual.ts --embarque <id> --apply
 *   pnpm tsx prisma/backfill-contenedor-virtual.ts --all                    # dry-run de todos
 */

// Mapeo conservador del estado del embarque al estado del contenedor.
const ESTADO_MAP: Record<EmbarqueEstado, ContenedorEstado> = {
  BORRADOR: "BORRADOR",
  EN_TRANSITO: "EN_TRANSITO",
  EN_PUERTO: "ARRIBADO_PUERTO",
  EN_ZONA_PRIMARIA: "EN_ZONA_PRIMARIA",
  EN_ADUANA: "EN_DEPOSITO_FISCAL",
  DESPACHADO: "DESCONSOLIDADO",
  EN_DEPOSITO: "DESCONSOLIDADO",
  CERRADO: "TOTALMENTE_DESPACHADO",
};

function parseArgs() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const all = argv.includes("--all");
  const i = argv.indexOf("--embarque");
  const embarqueId = i !== -1 ? argv[i + 1] : undefined;
  return { apply, all, embarqueId };
}

async function main() {
  const { apply, all, embarqueId } = parseArgs();
  if (!embarqueId && !all) {
    console.error("Uso: --embarque <id> | --all  [--apply]");
    process.exit(1);
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  console.log(
    apply ? "Backfill contenedor virtual (APPLY)\n" : "Backfill contenedor virtual (DRY-RUN — sin --apply)\n",
  );

  try {
    const embarques = await prisma.embarque.findMany({
      where: {
        ...(embarqueId ? { id: embarqueId } : {}),
        contenedores: { none: {} }, // idempotencia: sin contenedores aún
      },
      select: {
        id: true,
        codigo: true,
        estado: true,
        items: {
          select: { id: true, productoId: true, cantidad: true, costoUnitario: true },
        },
      },
    });

    if (embarques.length === 0) {
      console.log("Nada para backfillear (ningún embarque sin contenedores que coincida).");
      return;
    }

    let creados = 0;
    for (const emb of embarques) {
      const estadoContenedor = ESTADO_MAP[emb.estado];
      console.log(
        `Embarque ${emb.codigo} (${emb.estado}) → Contenedor VIRTUAL-${emb.codigo} [${estadoContenedor}], ${emb.items.length} SKUs`,
      );

      if (!apply) continue;

      await prisma.$transaction(async (tx) => {
        const contenedor = await tx.contenedor.create({
          data: {
            embarqueId: emb.id,
            numeroContenedor: `VIRTUAL-${emb.codigo}`,
            estado: estadoContenedor,
            observaciones: "Contenedor virtual generado por backfill (embarque legado, D7).",
          },
        });
        for (const item of emb.items) {
          await tx.itemContenedor.create({
            data: {
              contenedorId: contenedor.id,
              itemEmbarqueId: item.id,
              productoId: item.productoId,
              cantidadDeclarada: item.cantidad,
              cantidadFisica: item.cantidad,
              // counters en 0 — reconciliación deferida a Fase 2/3 (ver cabecera).
              costoFCUnitario: item.costoUnitario,
            },
          });
        }
      });
      creados++;
      console.log(`  ✓ creado (${emb.items.length} ItemContenedor)`);
    }

    console.log(
      apply
        ? `\nListo: ${creados} contenedor(es) virtual(es) creado(s).`
        : `\nDry-run: ${embarques.length} embarque(s) serían backfilleados. Pasar --apply para ejecutar.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
