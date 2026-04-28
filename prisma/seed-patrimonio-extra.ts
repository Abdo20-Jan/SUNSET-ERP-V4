import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  PrismaClient,
  CuentaCategoria,
  CuentaTipo,
} from "../src/generated/prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

// Cuentas adicionales de patrimonio neto + dividendos a pagar.
// Idempotente: usa upsert por código. NO toca cuentas ya cargadas
// (ni saldo, ni asientos, ni nada — sólo asegura que existan).
//
// Esquema (Argentina, Ley 19.550 + RT 8/9):
//   2.1.9   DIVIDENDOS A PAGAR (sintetica)
//     2.1.9.01 DIVIDENDOS A PAGAR (analitica)
//   3.1     CAPITAL
//     3.1.1 APORTES (existente)
//     3.1.2 AJUSTES DE CAPITAL (NUEVA sintetica)
//       3.1.2.01 AJUSTE INTEGRAL DE CAPITAL
//       3.1.2.02 PRIMA DE EMISIÓN
//   3.2     RESULTADOS
//     3.2.1 RESULTADOS ACUMULADOS (existente)
//       3.2.1.03 DIVIDENDOS DECLARADOS (nueva analitica)
//   3.3     RESERVAS (NUEVA sintetica nivel 2)
//     3.3.1 RESERVAS DE UTILIDADES (sintetica nivel 3)
//       3.3.1.01 RESERVA LEGAL          (5% util. neta hasta 20% capital)
//       3.3.1.02 RESERVA FACULTATIVA
//       3.3.1.03 RESERVA ESTATUTARIA
//       3.3.1.04 RESERVA POR REVALÚO TÉCNICO

type Sintetica = {
  codigo: string;
  nombre: string;
  categoria: CuentaCategoria;
  nivel: number;
};

type Analitica = {
  codigo: string;
  nombre: string;
  categoria: CuentaCategoria;
};

const SINTETICAS_NUEVAS: Sintetica[] = [
  {
    codigo: "2.1.9",
    nombre: "DIVIDENDOS A PAGAR",
    categoria: CuentaCategoria.PASIVO,
    nivel: 3,
  },
  {
    codigo: "3.1.2",
    nombre: "AJUSTES DE CAPITAL",
    categoria: CuentaCategoria.PATRIMONIO,
    nivel: 3,
  },
  {
    codigo: "3.3",
    nombre: "RESERVAS",
    categoria: CuentaCategoria.PATRIMONIO,
    nivel: 2,
  },
  {
    codigo: "3.3.1",
    nombre: "RESERVAS DE UTILIDADES",
    categoria: CuentaCategoria.PATRIMONIO,
    nivel: 3,
  },
];

const ANALITICAS_NUEVAS: Analitica[] = [
  // Pasivo
  {
    codigo: "2.1.9.01",
    nombre: "DIVIDENDOS A PAGAR",
    categoria: CuentaCategoria.PASIVO,
  },
  // Capital — ajustes
  {
    codigo: "3.1.2.01",
    nombre: "AJUSTE INTEGRAL DE CAPITAL",
    categoria: CuentaCategoria.PATRIMONIO,
  },
  {
    codigo: "3.1.2.02",
    nombre: "PRIMA DE EMISIÓN",
    categoria: CuentaCategoria.PATRIMONIO,
  },
  // Resultados
  {
    codigo: "3.2.1.03",
    nombre: "DIVIDENDOS DECLARADOS",
    categoria: CuentaCategoria.PATRIMONIO,
  },
  // Reservas
  {
    codigo: "3.3.1.01",
    nombre: "RESERVA LEGAL",
    categoria: CuentaCategoria.PATRIMONIO,
  },
  {
    codigo: "3.3.1.02",
    nombre: "RESERVA FACULTATIVA",
    categoria: CuentaCategoria.PATRIMONIO,
  },
  {
    codigo: "3.3.1.03",
    nombre: "RESERVA ESTATUTARIA",
    categoria: CuentaCategoria.PATRIMONIO,
  },
  {
    codigo: "3.3.1.04",
    nombre: "RESERVA POR REVALÚO TÉCNICO",
    categoria: CuentaCategoria.PATRIMONIO,
  },
];

function padre(codigo: string): string | null {
  const i = codigo.lastIndexOf(".");
  return i === -1 ? null : codigo.slice(0, i);
}

async function main() {
  console.log("🔧 Patrimonio + Reservas + Dividendos: agregando cuentas faltantes\n");

  let creadas = 0;
  let yaExistian = 0;

  // 1) SINTETICAs primero (jerarquía)
  for (const s of SINTETICAS_NUEVAS) {
    const existing = await prisma.cuentaContable.findUnique({
      where: { codigo: s.codigo },
      select: { codigo: true, tipo: true, nombre: true },
    });
    if (existing) {
      yaExistian++;
      console.log(
        `  · ${s.codigo} ya existe (${existing.tipo}: "${existing.nombre}") — sin cambios`,
      );
      continue;
    }
    await prisma.cuentaContable.create({
      data: {
        codigo: s.codigo,
        nombre: s.nombre,
        tipo: CuentaTipo.SINTETICA,
        categoria: s.categoria,
        nivel: s.nivel,
        padreCodigo: padre(s.codigo),
        activa: true,
      },
    });
    creadas++;
    console.log(`  ✓ ${s.codigo} ${s.nombre} [SINTETICA]`);
  }

  // 2) ANALITICAs después
  for (const a of ANALITICAS_NUEVAS) {
    const existing = await prisma.cuentaContable.findUnique({
      where: { codigo: a.codigo },
      select: { codigo: true, tipo: true, nombre: true },
    });
    if (existing) {
      yaExistian++;
      console.log(
        `  · ${a.codigo} ya existe (${existing.tipo}: "${existing.nombre}") — sin cambios`,
      );
      continue;
    }
    await prisma.cuentaContable.create({
      data: {
        codigo: a.codigo,
        nombre: a.nombre,
        tipo: CuentaTipo.ANALITICA,
        categoria: a.categoria,
        nivel: a.codigo.split(".").length,
        padreCodigo: padre(a.codigo),
        activa: true,
      },
    });
    creadas++;
    console.log(`  ✓ ${a.codigo} ${a.nombre} [ANALITICA]`);
  }

  console.log(
    `\n✅ Listo. ${creadas} cuentas creadas, ${yaExistian} ya existían (sin cambios).`,
  );
}

main()
  .catch((e) => {
    console.error("Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
