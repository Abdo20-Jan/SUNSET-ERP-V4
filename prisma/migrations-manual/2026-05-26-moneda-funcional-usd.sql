-- Migration focada: moneda funcional para pasivos USD
-- ADR: 2026-05-26-moneda-funcional-pasivos-usd
--
-- Aplica APENAS las 4 columnas nuevas. NO toca tablas/columnas legacy
-- pendientes de cleanup (Producto.categoria, AplicacionPago*, Contenedor*,
-- etc). Esos drops requieren su propia auditoria.
--
-- Uso (ejecutar contra Railway):
--   psql "$(grep '^DATABASE_URL=' .env.local | cut -d= -f2- | tr -d '"')" \
--     -f prisma/migrations-manual/2026-05-26-moneda-funcional-usd.sql
--
-- O via prisma:
--   DATABASE_URL=... pnpm prisma db execute \
--     --file prisma/migrations-manual/2026-05-26-moneda-funcional-usd.sql \
--     --schema prisma/schema.prisma
--
-- Idempotente: usa IF NOT EXISTS donde Postgres lo soporta.

BEGIN;

-- 1) LineaAsiento: 3 columnas opcionales para moneda funcional
ALTER TABLE "LineaAsiento"
  ADD COLUMN IF NOT EXISTS "monedaOrigen" "Moneda",
  ADD COLUMN IF NOT EXISTS "montoOrigen" DECIMAL(18, 2),
  ADD COLUMN IF NOT EXISTS "tipoCambioOrigen" DECIMAL(18, 6);

-- 2) Proveedor: moneda funcional del pasivo (default ARS no afecta a nadie)
ALTER TABLE "Proveedor"
  ADD COLUMN IF NOT EXISTS "monedaOperacion" "Moneda" NOT NULL DEFAULT 'ARS';

COMMIT;

-- Verificación
SELECT
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name IN ('LineaAsiento', 'Proveedor')
  AND column_name IN ('monedaOrigen', 'montoOrigen', 'tipoCambioOrigen', 'monedaOperacion')
ORDER BY table_name, column_name;
