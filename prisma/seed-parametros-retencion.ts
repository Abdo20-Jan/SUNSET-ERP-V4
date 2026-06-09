import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  type CondicionGanancias,
  type ConceptoRG830,
  PrismaClient,
} from "../src/generated/prisma/client";

// Seed idempotente de los parámetros de retención de Ganancias (RG 830).
// Una fila por (concepto, condición) con vigencia desde 2024-01-01. La
// retención usa la fila ACTIVA cuya vigencia contiene la fecha de pago.
//
// ⚠️  Los valores son los de referencia del vault (mínimos congelados +
//     alícuotas RG 830). VERIFICAR / AJUSTAR con el contador antes de
//     prender la flag en producción — para eso son parámetros editables.
//     La escala progresiva de honorarios (Anexo VIII) se aproxima con un
//     mínimo no sujeto + alícuota plana; el monto fijo se setea en 0.
//
// Uso:
//   pnpm tsx prisma/seed-parametros-retencion.ts
//   # Contra Railway production:
//   DATABASE_URL="<railway-url>" pnpm tsx prisma/seed-parametros-retencion.ts

const VIGENCIA_DESDE = new Date("2024-01-01T00:00:00.000Z");

type Regla = {
  concepto: ConceptoRG830;
  condicion: CondicionGanancias;
  minimoNoSujeto: string;
  montoFijo: string;
  alicuota: string; // porcentaje
};

// (concepto, condición) → mínimo mensual + alícuota. Sólo INSCRIPTO y
// NO_INSCRIPTO: monotributistas y exentos no sufren retención (cortocircuito
// en el cálculo, sin fila).
const REGLAS: Regla[] = [
  // Bienes (mercadería de reventa) — alícuota plana.
  {
    concepto: "BIENES_DE_CAMBIO",
    condicion: "INSCRIPTO",
    minimoNoSujeto: "224000.00",
    montoFijo: "0",
    alicuota: "2",
  },
  {
    concepto: "BIENES_DE_CAMBIO",
    condicion: "NO_INSCRIPTO",
    minimoNoSujeto: "224000.00",
    montoFijo: "0",
    alicuota: "10",
  },

  // Honorarios profesionales — RG 830 Anexo VIII (escala). Aproximación plana.
  {
    concepto: "HONORARIOS",
    condicion: "INSCRIPTO",
    minimoNoSujeto: "67170.00",
    montoFijo: "0",
    alicuota: "6",
  },
  {
    concepto: "HONORARIOS",
    condicion: "NO_INSCRIPTO",
    minimoNoSujeto: "67170.00",
    montoFijo: "0",
    alicuota: "28",
  },

  // Alquileres (inmuebles / cosas muebles).
  {
    concepto: "ALQUILERES",
    condicion: "INSCRIPTO",
    minimoNoSujeto: "30000.00",
    montoFijo: "0",
    alicuota: "6",
  },
  {
    concepto: "ALQUILERES",
    condicion: "NO_INSCRIPTO",
    minimoNoSujeto: "30000.00",
    montoFijo: "0",
    alicuota: "28",
  },

  // Servicios generales / locaciones de servicios — alícuota de servicios.
  {
    concepto: "SERVICIOS_GENERALES",
    condicion: "INSCRIPTO",
    minimoNoSujeto: "224000.00",
    montoFijo: "0",
    alicuota: "2",
  },
  {
    concepto: "SERVICIOS_GENERALES",
    condicion: "NO_INSCRIPTO",
    minimoNoSujeto: "224000.00",
    montoFijo: "0",
    alicuota: "28",
  },
  {
    concepto: "LOCACIONES_SERVICIOS",
    condicion: "INSCRIPTO",
    minimoNoSujeto: "224000.00",
    montoFijo: "0",
    alicuota: "2",
  },
  {
    concepto: "LOCACIONES_SERVICIOS",
    condicion: "NO_INSCRIPTO",
    minimoNoSujeto: "224000.00",
    montoFijo: "0",
    alicuota: "28",
  },
];

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

function maskUrl(url: string | undefined): string {
  if (!url) return "<unset>";
  return url.replace(/:[^:@/]+@/, ":***@");
}

async function main() {
  console.log(`DB: ${maskUrl(process.env.DATABASE_URL)}`);
  let creados = 0;
  let existentes = 0;

  for (const r of REGLAS) {
    const ya = await prisma.parametroRetencion.findFirst({
      where: {
        tipo: "GANANCIAS",
        concepto: r.concepto,
        condicion: r.condicion,
        vigenciaDesde: VIGENCIA_DESDE,
      },
      select: { id: true },
    });
    if (ya) {
      existentes++;
      continue;
    }
    await prisma.parametroRetencion.create({
      data: {
        tipo: "GANANCIAS",
        regimen: "RG_830",
        concepto: r.concepto,
        condicion: r.condicion,
        minimoNoSujeto: r.minimoNoSujeto,
        montoFijo: r.montoFijo,
        alicuota: r.alicuota,
        vigenciaDesde: VIGENCIA_DESDE,
        activo: true,
      },
    });
    creados++;
    console.log(`  + ${r.concepto} / ${r.condicion} → mín ${r.minimoNoSujeto}, ${r.alicuota}%`);
  }

  console.log(`\nListo. ${creados} creados, ${existentes} ya existían.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
