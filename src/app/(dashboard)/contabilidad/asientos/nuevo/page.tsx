import { CuentaTipo } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { getDefaultFecha } from "@/lib/server/fecha-default";

import { AsientoForm } from "./asiento-form";

export default async function NuevoAsientoPage() {
  const [cuentas, defaultFecha] = await Promise.all([
    db.cuentaContable.findMany({
      where: {
        tipo: CuentaTipo.ANALITICA,
        activa: true,
      },
      select: { id: true, codigo: true, nombre: true },
      orderBy: { codigo: "asc" },
    }),
    getDefaultFecha(),
  ]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="text-[15px] font-semibold tracking-tight">Nuevo asiento manual</h1>
        <p className="text-sm text-muted-foreground">
          Los asientos se crean en estado BORRADOR. Para que afecten saldos deben contabilizarse
          posteriormente.
        </p>
      </div>
      <AsientoForm cuentas={cuentas} defaultFecha={defaultFecha} />
    </div>
  );
}
