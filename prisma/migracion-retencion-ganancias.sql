-- ============================================================================
-- Migración FOCADA: Retención Impuesto a las Ganancias (RG 830)
-- ============================================================================
-- 100% ADITIVA (sin DROP/ALTER destructivos): 3 enums nuevos, 5 columnas
-- nullable/con-default en "Proveedor", y 2 tablas nuevas (ParametroRetencion,
-- RetencionPracticada). No toca datos existentes.
--
-- Alternativa simple si el schema local NO divergió de prod:
--     pnpm db:push          # aplica todo el schema (Prisma decide el diff)
--     pnpm db:seed-retenciones
--
-- Usar este SQL focado cuando se prefiera aplicar SÓLO este delta a Railway
-- (evita que un `db push` toque columnas no relacionadas). Generado con
-- `prisma migrate diff` desde el schema previo al de este PR.
--
--     psql "$DATABASE_URL" -f prisma/migracion-retencion-ganancias.sql
--
-- Después: pnpm db:seed-retenciones   (parámetros RG 830) y luego
-- RETENCION_GANANCIAS_ENABLED=true para activar la feature.
-- ============================================================================

BEGIN;

-- CreateEnum
CREATE TYPE "CondicionGanancias" AS ENUM ('INSCRIPTO', 'NO_INSCRIPTO', 'MONOTRIBUTO', 'EXENTO');

-- CreateEnum
CREATE TYPE "TipoRetencion" AS ENUM ('GANANCIAS');

-- CreateEnum
CREATE TYPE "RetencionEstado" AS ENUM ('PENDIENTE_ARCA', 'PAGADA_ARCA', 'ANULADA');

-- AlterTable
ALTER TABLE "Proveedor" ADD COLUMN     "alicuotaRetencionGananciasOverride" DECIMAL(8,4),
ADD COLUMN     "certificadoExclusionGanancias" TEXT,
ADD COLUMN     "condicionGanancias" "CondicionGanancias" NOT NULL DEFAULT 'INSCRIPTO',
ADD COLUMN     "sujetoRetencionGanancias" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "vigenciaCertExclusionGanancias" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ParametroRetencion" (
    "id" SERIAL NOT NULL,
    "tipo" "TipoRetencion" NOT NULL DEFAULT 'GANANCIAS',
    "regimen" TEXT NOT NULL DEFAULT 'RG_830',
    "concepto" "ConceptoRG830" NOT NULL,
    "condicion" "CondicionGanancias" NOT NULL,
    "minimoNoSujeto" DECIMAL(18,2) NOT NULL,
    "montoFijo" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "alicuota" DECIMAL(8,4) NOT NULL,
    "vigenciaDesde" TIMESTAMP(3) NOT NULL,
    "vigenciaHasta" TIMESTAMP(3),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParametroRetencion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetencionPracticada" (
    "id" TEXT NOT NULL,
    "tipo" "TipoRetencion" NOT NULL DEFAULT 'GANANCIAS',
    "regimen" TEXT NOT NULL DEFAULT 'RG_830',
    "concepto" "ConceptoRG830" NOT NULL,
    "proveedorId" TEXT NOT NULL,
    "movimientoTesoreriaId" TEXT NOT NULL,
    "base" DECIMAL(18,2) NOT NULL,
    "baseAcumuladaMesPrevio" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "minimoNoSujeto" DECIMAL(18,2) NOT NULL,
    "alicuota" DECIMAL(8,4) NOT NULL,
    "montoFijo" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "importeRetenido" DECIMAL(18,2) NOT NULL,
    "condicionGanancias" "CondicionGanancias" NOT NULL,
    "fechaRetencion" TIMESTAMP(3) NOT NULL,
    "fechaVencimientoArca" TIMESTAMP(3) NOT NULL,
    "estado" "RetencionEstado" NOT NULL DEFAULT 'PENDIENTE_ARCA',
    "certificadoNumero" TEXT NOT NULL,
    "parametrosSnapshot" JSONB,
    "detalleCalculo" TEXT,
    "motivoAnulacion" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetencionPracticada_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ParametroRetencion_tipo_concepto_condicion_activo_idx" ON "ParametroRetencion"("tipo", "concepto", "condicion", "activo");

-- CreateIndex
CREATE UNIQUE INDEX "ParametroRetencion_tipo_concepto_condicion_vigenciaDesde_key" ON "ParametroRetencion"("tipo", "concepto", "condicion", "vigenciaDesde");

-- CreateIndex
CREATE UNIQUE INDEX "RetencionPracticada_movimientoTesoreriaId_key" ON "RetencionPracticada"("movimientoTesoreriaId");

-- CreateIndex
CREATE UNIQUE INDEX "RetencionPracticada_certificadoNumero_key" ON "RetencionPracticada"("certificadoNumero");

-- CreateIndex
CREATE INDEX "RetencionPracticada_proveedorId_fechaRetencion_idx" ON "RetencionPracticada"("proveedorId", "fechaRetencion");

-- CreateIndex
CREATE INDEX "RetencionPracticada_estado_idx" ON "RetencionPracticada"("estado");

-- CreateIndex
CREATE INDEX "RetencionPracticada_concepto_fechaRetencion_idx" ON "RetencionPracticada"("concepto", "fechaRetencion");

-- AddForeignKey
ALTER TABLE "RetencionPracticada" ADD CONSTRAINT "RetencionPracticada_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "Proveedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetencionPracticada" ADD CONSTRAINT "RetencionPracticada_movimientoTesoreriaId_fkey" FOREIGN KEY ("movimientoTesoreriaId") REFERENCES "MovimientoTesoreria"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetencionPracticada" ADD CONSTRAINT "RetencionPracticada_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


COMMIT;
