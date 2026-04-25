import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url }),
});

async function main() {
  const embarques = await db.embarque.findMany({
    select: { id: true, codigo: true, estado: true, asientoId: true },
  });
  console.log(`Found ${embarques.length} embarque(s):`);
  for (const e of embarques) {
    console.log(
      `  - ${e.codigo} estado=${e.estado} asiento=${e.asientoId ?? "—"}`,
    );
  }

  if (embarques.length === 0) {
    console.log("Nothing to delete.");
    return;
  }

  const asientoIds = embarques
    .map((e) => e.asientoId)
    .filter((id): id is string => id !== null);

  await db.$transaction(async (tx) => {
    // 1. Detach asiento from embarque so we can safely delete it
    if (asientoIds.length > 0) {
      await tx.embarque.updateMany({
        where: { asientoId: { in: asientoIds } },
        data: { asientoId: null },
      });
      // 2. Delete lineas first (FK is RESTRICT, not CASCADE)
      const lineasDel = await tx.lineaAsiento.deleteMany({
        where: { asientoId: { in: asientoIds } },
      });
      console.log(`Deleted ${lineasDel.count} linea(s).`);
      // 3. Delete asientos
      const asientoDel = await tx.asiento.deleteMany({
        where: { id: { in: asientoIds } },
      });
      console.log(`Deleted ${asientoDel.count} asiento(s).`);
    }
    // 3. Delete items + embarques (items cascade)
    await tx.itemEmbarque.deleteMany({});
    const embDel = await tx.embarque.deleteMany({});
    console.log(`Deleted ${embDel.count} embarque(s) + items.`);
  });

  console.log("\nCleanup completo.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
