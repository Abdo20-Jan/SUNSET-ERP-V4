import { CuentaTipo } from "@/generated/prisma/client";
import { db } from "@/lib/db";

import { AsientoForm } from "./asiento-form";

export default async function NuevoAsientoPage() {
  const cuentas = await db.cuentaContable.findMany({
    where: {
      tipo: CuentaTipo.ANALITICA,
      activa: true,
    },
    select: { id: true, codigo: true, nombre: true },
    orderBy: { codigo: "asc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Nuevo asiento manual
        </h1>
        <p className="text-sm text-muted-foreground">
          Los asientos se crean en estado BORRADOR. Para que afecten saldos
          deben contabilizarse posteriormente.
        </p>
      </div>
      <AsientoForm cuentas={cuentas} />
    </div>
  );
}
