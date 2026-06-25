-- CreateEnum
CREATE TYPE "AuditOrigen" AS ENUM ('MANUAL', 'IMPORTACION', 'AUTOMACION', 'API', 'MASTER_OVERRIDE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAccion" ADD VALUE 'CAMBIO_ESTADO';
ALTER TYPE "AuditAccion" ADD VALUE 'APROBACION';
ALTER TYPE "AuditAccion" ADD VALUE 'CANCELACION';
ALTER TYPE "AuditAccion" ADD VALUE 'EXPORTACION';
ALTER TYPE "AuditAccion" ADD VALUE 'VISUALIZACION_SENSIBLE';
ALTER TYPE "AuditAccion" ADD VALUE 'MASTER_OVERRIDE';

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "documentoId" TEXT,
ADD COLUMN     "ip" TEXT,
ADD COLUMN     "motivo" TEXT,
ADD COLUMN     "origen" "AuditOrigen" NOT NULL DEFAULT 'MANUAL';
