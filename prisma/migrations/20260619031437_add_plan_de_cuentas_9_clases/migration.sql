-- CreateEnum
CREATE TYPE "ClasificacionCuenta" AS ENUM ('ACTIVO', 'PASIVO', 'CORRIENTE', 'NO_CORRIENTE', 'PATRIMONIO_NETO', 'RESULTADO');

-- CreateEnum
CREATE TYPE "ImputacionCuenta" AS ENUM ('IMPUTABLE', 'NO_IMPUTABLE', 'SOLO_SISTEMA');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Naturaleza" ADD VALUE 'MIXTA';
ALTER TYPE "Naturaleza" ADD VALUE 'SISTEMA_VARIABLE';

-- AlterTable
ALTER TABLE "CuentaContable" ADD COLUMN     "bimonetaria" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "clase" INTEGER,
ADD COLUMN     "clasificacion" "ClasificacionCuenta",
ADD COLUMN     "dinamica" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "enEspecie" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "imputacion" "ImputacionCuenta",
ADD COLUMN     "inventariable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "monedaExtranjera" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "orden" INTEGER,
ADD COLUMN     "regularizadora" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sistema" BOOLEAN NOT NULL DEFAULT false;
