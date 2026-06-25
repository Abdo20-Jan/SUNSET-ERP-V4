-- CreateEnum
CREATE TYPE "EstadoSolicitud" AS ENUM ('PENDIENTE', 'APROBADA', 'RECHAZADA', 'EXPIRADA', 'CANCELADA', 'SOLICITANDO_INFO');

-- CreateEnum
CREATE TYPE "TipoAprobacion" AS ENUM ('CLIENTE_BLOQUEADO', 'MARGEN_BAJA_5', 'MARGEN_BAJA_10', 'MARGEN_BAJA_MAYOR_10', 'LIMITE_EXCEDIDO_20', 'LIMITE_EXCEDIDO_MAYOR_20', 'PLAZO_ESPECIAL', 'DESCUENTO_ESPECIAL_10', 'PAGO_NORMAL', 'PAGO_ALTO_VALOR', 'COSTO_COMEX_MAYOR_10', 'AJUSTE_STOCK_5', 'AJUSTE_STOCK_MAYOR_5', 'REAPERTURA_COSTO_COMEX', 'REAPERTURA_PERIODO_CONTABLE', 'LANZAMIENTO_MANUAL_CONTABLE', 'ANULAR_VENTA_FACTURADA', 'CANCELAR_PROCESO_COMEX');

-- CreateEnum
CREATE TYPE "TipoDecisionAprobacion" AS ENUM ('APROBADA', 'RECHAZADA', 'INFO_SOLICITADA');

-- CreateTable
CREATE TABLE "Solicitud" (
    "id" TEXT NOT NULL,
    "tipo" "TipoAprobacion" NOT NULL,
    "estado" "EstadoSolicitud" NOT NULL DEFAULT 'PENDIENTE',
    "tabla" TEXT NOT NULL,
    "registroId" TEXT NOT NULL,
    "solicitanteId" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "valor" DECIMAL(18,2),
    "moneda" "Moneda",
    "slaHoras" INTEGER NOT NULL,
    "venceEn" TIMESTAMP(3) NOT NULL,
    "requiereDupla" BOOLEAN NOT NULL DEFAULT false,
    "nivelEscalonamiento" INTEGER NOT NULL DEFAULT 0,
    "ultimoHitoSla" INTEGER NOT NULL DEFAULT 0,
    "resueltaEn" TIMESTAMP(3),
    "comentarioResolucion" TEXT,
    "anexos" JSONB,
    "datos" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Solicitud_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Aprobacion" (
    "id" TEXT NOT NULL,
    "solicitudId" TEXT NOT NULL,
    "aprobadorId" TEXT NOT NULL,
    "decision" "TipoDecisionAprobacion" NOT NULL,
    "comentario" TEXT,
    "esMasterOverride" BOOLEAN NOT NULL DEFAULT false,
    "nivelEscalonamiento" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Aprobacion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Solicitud_estado_idx" ON "Solicitud"("estado");

-- CreateIndex
CREATE INDEX "Solicitud_tabla_registroId_idx" ON "Solicitud"("tabla", "registroId");

-- CreateIndex
CREATE INDEX "Solicitud_venceEn_idx" ON "Solicitud"("venceEn");

-- CreateIndex
CREATE INDEX "Solicitud_solicitanteId_idx" ON "Solicitud"("solicitanteId");

-- CreateIndex
CREATE INDEX "Aprobacion_solicitudId_idx" ON "Aprobacion"("solicitudId");

-- CreateIndex
CREATE INDEX "Aprobacion_aprobadorId_idx" ON "Aprobacion"("aprobadorId");

-- AddForeignKey
ALTER TABLE "Solicitud" ADD CONSTRAINT "Solicitud_solicitanteId_fkey" FOREIGN KEY ("solicitanteId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Aprobacion" ADD CONSTRAINT "Aprobacion_solicitudId_fkey" FOREIGN KEY ("solicitudId") REFERENCES "Solicitud"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Aprobacion" ADD CONSTRAINT "Aprobacion_aprobadorId_fkey" FOREIGN KEY ("aprobadorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
