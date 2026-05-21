/**
 * DDL raw de los índices UNIQUE PARCIALES + CHECK de `ItemDespacho`
 * (decisión 2026-05-21, Abordagem A+F — ver
 * 04-decisions/2026-05-20-itemdespacho-unique-constraint-decision.md).
 *
 * Prisma `@@unique` no soporta cláusula WHERE, así que la unicidad del
 * despacho parcial cruzado se materializa con dos índices parciales disjuntos:
 *
 *   - LEGACY:  (despachoId, itemEmbarqueId)   WHERE contenedorId IS NULL
 *   - CRUZADO: (despachoId, itemContenedorId) WHERE contenedorId IS NOT NULL
 *
 * + un CHECK que garantiza que `contenedorId` e `itemContenedorId` son ambos
 *   NULL (legacy) o ambos setados (cruzado).
 *
 * Fuente única: la consume el script `add-partial-indexes-despacho.ts` (prod)
 * y el bootstrap de Testcontainers (`test/db.ts`) para que la BD de prueba
 * tenga la MISMA unicidad que producción (si no, los tests de unicidad dan
 * falso-positivo). Todos los statements son idempotentes.
 */
export const ITEM_DESPACHO_PARTIAL_DDL: { nombre: string; sql: string }[] = [
  {
    nombre: "ItemDespacho_legacy_uq",
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS "ItemDespacho_legacy_uq" ON "ItemDespacho" ("despachoId", "itemEmbarqueId") WHERE "contenedorId" IS NULL;`,
  },
  {
    nombre: "ItemDespacho_cruzado_uq",
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS "ItemDespacho_cruzado_uq" ON "ItemDespacho" ("despachoId", "itemContenedorId") WHERE "contenedorId" IS NOT NULL;`,
  },
  {
    nombre: "ItemDespacho_origen_coherente_chk (drop)",
    sql: `ALTER TABLE "ItemDespacho" DROP CONSTRAINT IF EXISTS "ItemDespacho_origen_coherente_chk";`,
  },
  {
    nombre: "ItemDespacho_origen_coherente_chk (add)",
    sql: `ALTER TABLE "ItemDespacho" ADD CONSTRAINT "ItemDespacho_origen_coherente_chk" CHECK (("contenedorId" IS NULL) = ("itemContenedorId" IS NULL)) NOT VALID;`,
  },
  {
    nombre: "ItemDespacho_origen_coherente_chk (validate)",
    sql: `ALTER TABLE "ItemDespacho" VALIDATE CONSTRAINT "ItemDespacho_origen_coherente_chk";`,
  },
];
