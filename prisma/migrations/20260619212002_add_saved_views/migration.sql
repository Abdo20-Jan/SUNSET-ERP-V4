-- CreateTable
CREATE TABLE "SavedView" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ruta" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "esPredeterminada" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SavedView_userId_ruta_idx" ON "SavedView"("userId", "ruta");

-- CreateIndex
CREATE UNIQUE INDEX "SavedView_userId_ruta_nombre_key" ON "SavedView"("userId", "ruta", "nombre");

-- AddForeignKey
ALTER TABLE "SavedView" ADD CONSTRAINT "SavedView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
