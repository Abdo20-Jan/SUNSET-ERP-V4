import Link from "next/link";

import { listarProductosConStock } from "@/lib/actions/inventario";
import { db } from "@/lib/db";
import { isStockDualEnabled } from "@/lib/features";

import { NuevaTransferenciaForm } from "./_components/nueva-transferencia-form";

export default async function NuevaTransferenciaPage() {
  if (!isStockDualEnabled()) {
    return (
      <main className="container mx-auto p-6">
        <h1 className="text-2xl font-semibold">Nueva transferencia</h1>
        <p className="mt-4 text-muted-foreground">
          Stock dual no habilitado.
        </p>
        <Link
          href="/inventario/transferencias"
          className="mt-4 inline-block text-primary underline"
        >
          ← Volver
        </Link>
      </main>
    );
  }

  const [productos, depositos] = await Promise.all([
    listarProductosConStock(),
    db.deposito.findMany({
      where: { activo: true },
      orderBy: { nombre: "asc" },
      select: { id: true, nombre: true },
    }),
  ]);

  return (
    <main className="container mx-auto space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Nueva transferencia</h1>
        <p className="text-sm text-muted-foreground">
          Mueve stock físico entre depósitos. No genera asiento contable.
        </p>
      </header>
      <NuevaTransferenciaForm productos={productos} depositos={depositos} />
    </main>
  );
}
