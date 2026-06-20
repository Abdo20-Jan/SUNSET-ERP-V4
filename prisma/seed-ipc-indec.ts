// Seed del índice de precios INDEC (IPC Nacional) → activa el model IndiceIPC
// (dead-code hasta ahora). Es la base del coeficiente de reexpresión (RECPAM
// apagado / deflación de series). No tiene efecto en ningún reporte: sólo infra.
//
// ⚠️ VALORES PLACEHOLDER SINTÉTICOS — NO oficiales. Índice base 100,0000 en
// 2023-01, acumulado con tasas mensuales aproximadas. REEMPLAZAR por la serie
// oficial del INDEC (IPC Nacional empalmado) antes de cualquier uso fiscal/RECPAM.
// Sirven sólo para destrabar la infraestructura, no para cálculo contable.
//
// Uso: DATABASE_URL="postgresql://..." pnpm db:seed-ipc   (tsx NO lee .env)
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const FUENTE = "INDEC IPC Nacional — valores placeholder a confirmar con fuente oficial";

// [periodo YYYY-MM, tasa de inflación mensual]. El primer mes es la base (tasa 0).
// Tasas aproximadas/sintéticas de la economía argentina 2023-2025 — a reemplazar.
const TASAS_MENSUALES: ReadonlyArray<readonly [string, number]> = [
  ["2023-01", 0],
  ["2023-02", 0.066],
  ["2023-03", 0.077],
  ["2023-04", 0.084],
  ["2023-05", 0.078],
  ["2023-06", 0.06],
  ["2023-07", 0.063],
  ["2023-08", 0.124],
  ["2023-09", 0.122],
  ["2023-10", 0.083],
  ["2023-11", 0.128],
  ["2023-12", 0.254],
  ["2024-01", 0.206],
  ["2024-02", 0.131],
  ["2024-03", 0.11],
  ["2024-04", 0.088],
  ["2024-05", 0.042],
  ["2024-06", 0.046],
  ["2024-07", 0.04],
  ["2024-08", 0.042],
  ["2024-09", 0.035],
  ["2024-10", 0.027],
  ["2024-11", 0.024],
  ["2024-12", 0.027],
  ["2025-01", 0.022],
  ["2025-02", 0.024],
  ["2025-03", 0.037],
  ["2025-04", 0.028],
  ["2025-05", 0.015],
  ["2025-06", 0.016],
];

function serieAcumulada(): { periodo: string; valor: number }[] {
  const out: { periodo: string; valor: number }[] = [];
  let idx = 100;
  for (const [periodo, tasa] of TASAS_MENSUALES) {
    idx = idx * (1 + tasa);
    out.push({ periodo, valor: Math.round(idx * 10000) / 10000 });
  }
  return out;
}

async function main() {
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });
  try {
    const serie = serieAcumulada();
    for (const { periodo, valor } of serie) {
      await db.indiceIPC.upsert({
        where: { periodo },
        update: { valor, fuente: FUENTE },
        create: { periodo, valor, fuente: FUENTE },
      });
    }
    const primero = serie[0];
    const ultimo = serie[serie.length - 1];
    console.log(
      `✓ ${serie.length} períodos de IPC sembrados (${primero.periodo} .. ${ultimo.periodo}). ⚠️ Valores placeholder — reemplazar por INDEC oficial.`,
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
