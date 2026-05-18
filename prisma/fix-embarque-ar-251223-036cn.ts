/**
 * Fix puntual: el embarque AR-251223-036CN tuvo su asiento de Zona Primaria
 * anulado vía /contabilidad/asientos. Esa ruta no propaga la anulación al
 * embarque — deja `asientoZonaPrimariaId` apuntando a un asiento ANULADO y
 * el estado del embarque en EN_ZONA_PRIMARIA. Resultado: el producto sigue
 * apareciendo en /inventario → tab "En tránsito".
 *
 * Este script:
 *   1. Carga el embarque y valida que el asiento ZP está ANULADO.
 *   2. Limpia `asientoZonaPrimariaId = null` y `fechaZonaPrimaria = null`.
 *   3. Vuelve `estado` a EN_PUERTO (mismo target que revertirZonaPrimariaAction).
 *
 * El fix preventivo en código (bloquear anulación directa desde
 * /contabilidad/asientos) se aplica en una segunda mudanza.
 *
 * Uso:
 *   pnpm tsx prisma/fix-embarque-ar-251223-036cn.ts            # dry-run
 *   pnpm tsx prisma/fix-embarque-ar-251223-036cn.ts --apply    # aplica
 */
import { config as dotenvConfig } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { EmbarqueEstado, PrismaClient } from "../src/generated/prisma/client";

dotenvConfig({ path: ".env.local" });
dotenvConfig({ path: ".env" });

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const CODIGO = "AR-251223-036CN";
const APPLY = process.argv.includes("--apply");

async function main() {
  const embarque = await prisma.embarque.findFirst({
    where: { codigo: CODIGO },
    select: {
      id: true,
      codigo: true,
      estado: true,
      asientoId: true,
      asientoZonaPrimariaId: true,
      fechaZonaPrimaria: true,
      asientoZonaPrimaria: { select: { id: true, numero: true, estado: true } },
      _count: {
        select: {
          despachos: { where: { estado: { not: "ANULADO" } } },
        },
      },
    },
  });

  if (!embarque) {
    console.error(`Embarque ${CODIGO} no encontrado.`);
    process.exit(1);
  }

  console.log("Estado actual del embarque:");
  console.log(`  codigo                 : ${embarque.codigo}`);
  console.log(`  estado                 : ${embarque.estado}`);
  console.log(`  asientoId (cierre)     : ${embarque.asientoId ?? "—"}`);
  console.log(`  asientoZonaPrimariaId  : ${embarque.asientoZonaPrimariaId ?? "—"}`);
  console.log(`  fechaZonaPrimaria      : ${embarque.fechaZonaPrimaria?.toISOString() ?? "—"}`);
  console.log(
    `  asientoZP.estado       : ${embarque.asientoZonaPrimaria?.estado ?? "—"} (nº ${
      embarque.asientoZonaPrimaria?.numero ?? "—"
    })`,
  );
  console.log(`  despachos activos      : ${embarque._count.despachos}`);
  console.log();

  // Validaciones de seguridad
  if (embarque.asientoId) {
    console.error(
      "Embarque tiene asiento de cierre monolítico — no aplica este fix. Use 'Reverter cierre' primero.",
    );
    process.exit(1);
  }

  if (!embarque.asientoZonaPrimariaId) {
    console.log("El embarque ya no tiene asientoZonaPrimariaId — nada que hacer.");
    return;
  }

  if (!embarque.asientoZonaPrimaria) {
    console.error("Inconsistencia: asientoZonaPrimariaId apunta a asiento inexistente.");
    process.exit(1);
  }

  if (embarque.asientoZonaPrimaria.estado !== "ANULADO") {
    console.error(
      `El asiento ZP está en estado ${embarque.asientoZonaPrimaria.estado}, no ANULADO. Abortando para evitar romper datos contables.`,
    );
    process.exit(1);
  }

  if (embarque._count.despachos > 0) {
    console.error(
      `El embarque tiene ${embarque._count.despachos} despacho(s) activo(s). Anule los despachos primero — limpiar la ZP dejaría los despachos huérfanos.`,
    );
    process.exit(1);
  }

  console.log("Cambios propuestos:");
  console.log(`  asientoZonaPrimariaId  : ${embarque.asientoZonaPrimariaId} → null`);
  console.log(`  fechaZonaPrimaria      : ${embarque.fechaZonaPrimaria?.toISOString() ?? "—"} → null`);
  console.log(`  estado                 : ${embarque.estado} → EN_PUERTO`);
  console.log();

  if (!APPLY) {
    console.log("Dry-run. Re-ejecutar con --apply para confirmar los cambios.");
    return;
  }

  await prisma.embarque.update({
    where: { id: embarque.id },
    data: {
      asientoZonaPrimariaId: null,
      fechaZonaPrimaria: null,
      estado: EmbarqueEstado.EN_PUERTO,
    },
  });

  console.log("Cambios aplicados.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
