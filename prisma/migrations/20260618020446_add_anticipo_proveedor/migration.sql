-- CreateEnum
CREATE TYPE "EstadoAnticipo" AS ENUM ('VIGENTE', 'APLICADO_TOTAL', 'ANULADO');

-- CreateTable
CREATE TABLE "AnticipoProveedor" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "proveedorId" TEXT NOT NULL,
    "cuentaContableId" INTEGER NOT NULL,
    "cuentaBancariaId" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "moneda" "Moneda" NOT NULL DEFAULT 'ARS',
    "tipoCambio" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "montoArs" DECIMAL(18,2) NOT NULL,
    "saldoAplicadoArs" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "estado" "EstadoAnticipo" NOT NULL DEFAULT 'VIGENTE',
    "descripcion" TEXT,
    "movimientoTesoreriaId" TEXT,
    "asientoId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnticipoProveedor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AplicacionAnticipoProveedor" (
    "id" SERIAL NOT NULL,
    "anticipoId" TEXT NOT NULL,
    "compraId" TEXT,
    "gastoId" TEXT,
    "montoArs" DECIMAL(18,2) NOT NULL,
    "asientoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AplicacionAnticipoProveedor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AnticipoProveedor_numero_key" ON "AnticipoProveedor"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "AnticipoProveedor_movimientoTesoreriaId_key" ON "AnticipoProveedor"("movimientoTesoreriaId");

-- CreateIndex
CREATE UNIQUE INDEX "AnticipoProveedor_asientoId_key" ON "AnticipoProveedor"("asientoId");

-- CreateIndex
CREATE INDEX "AnticipoProveedor_proveedorId_idx" ON "AnticipoProveedor"("proveedorId");

-- CreateIndex
CREATE INDEX "AnticipoProveedor_estado_idx" ON "AnticipoProveedor"("estado");

-- CreateIndex
CREATE UNIQUE INDEX "AplicacionAnticipoProveedor_asientoId_key" ON "AplicacionAnticipoProveedor"("asientoId");

-- CreateIndex
CREATE INDEX "AplicacionAnticipoProveedor_anticipoId_idx" ON "AplicacionAnticipoProveedor"("anticipoId");

-- CreateIndex
CREATE INDEX "AplicacionAnticipoProveedor_compraId_idx" ON "AplicacionAnticipoProveedor"("compraId");

-- CreateIndex
CREATE INDEX "AplicacionAnticipoProveedor_gastoId_idx" ON "AplicacionAnticipoProveedor"("gastoId");

-- AddForeignKey
ALTER TABLE "AnticipoProveedor" ADD CONSTRAINT "AnticipoProveedor_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "Proveedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnticipoProveedor" ADD CONSTRAINT "AnticipoProveedor_cuentaContableId_fkey" FOREIGN KEY ("cuentaContableId") REFERENCES "CuentaContable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnticipoProveedor" ADD CONSTRAINT "AnticipoProveedor_cuentaBancariaId_fkey" FOREIGN KEY ("cuentaBancariaId") REFERENCES "CuentaBancaria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnticipoProveedor" ADD CONSTRAINT "AnticipoProveedor_movimientoTesoreriaId_fkey" FOREIGN KEY ("movimientoTesoreriaId") REFERENCES "MovimientoTesoreria"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnticipoProveedor" ADD CONSTRAINT "AnticipoProveedor_asientoId_fkey" FOREIGN KEY ("asientoId") REFERENCES "Asiento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnticipoProveedor" ADD CONSTRAINT "AnticipoProveedor_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AplicacionAnticipoProveedor" ADD CONSTRAINT "AplicacionAnticipoProveedor_anticipoId_fkey" FOREIGN KEY ("anticipoId") REFERENCES "AnticipoProveedor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AplicacionAnticipoProveedor" ADD CONSTRAINT "AplicacionAnticipoProveedor_compraId_fkey" FOREIGN KEY ("compraId") REFERENCES "Compra"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AplicacionAnticipoProveedor" ADD CONSTRAINT "AplicacionAnticipoProveedor_gastoId_fkey" FOREIGN KEY ("gastoId") REFERENCES "Gasto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AplicacionAnticipoProveedor" ADD CONSTRAINT "AplicacionAnticipoProveedor_asientoId_fkey" FOREIGN KEY ("asientoId") REFERENCES "Asiento"("id") ON DELETE SET NULL ON UPDATE CASCADE;
