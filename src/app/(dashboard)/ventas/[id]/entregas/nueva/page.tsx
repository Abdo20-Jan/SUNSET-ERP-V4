import Link from "next/link";
import { notFound } from "next/navigation";

import { saldoPendientePorItemVenta } from "@/lib/actions/entregas";
import { db } from "@/lib/db";
import { isStockDualEnabled } from "@/lib/features";

import { NuevaEntregaForm } from "./_components/nueva-entrega-form";

type PageParams = Promise<{ id: string }>;

export default async function NuevaEntregaPage({
  params,
}: {
  params: PageParams;
}) {
  const { id } = await params;

  if (!isStockDualEnabled()) {
    return (
      <main className="container mx-auto p-6">
        <h1 className="text-2xl font-semibold">Nueva entrega</h1>
        <p className="mt-4 text-muted-foreground">
          Stock dual no habilitado. Setear <code>STOCK_DUAL_ENABLED=true</code>.
        </p>
        <Link
          href={`/ventas/${id}/entregas`}
          className="mt-4 inline-block text-primary underline"
        >
          ← Volver
        </Link>
      </main>
    );
  }

  const venta = await db.venta.findUnique({
    where: { id },
    select: { id: true, numero: true, estado: true },
  });
  if (!venta) notFound();
  if (venta.estado !== "EMITIDA") {
    return (
      <main className="container mx-auto p-6">
        <h1 className="text-2xl font-semibold">Nueva entrega</h1>
        <p className="mt-4 text-muted-foreground">
          La venta {venta.numero} debe estar EMITIDA para registrar entregas
          (estado actual: {venta.estado}).
        </p>
        <Link
          href={`/ventas/${id}/entregas`}
          className="mt-4 inline-block text-primary underline"
        >
          ← Volver
        </Link>
      </main>
    );
  }

  const [pendientes, depositos] = await Promise.all([
    saldoPendientePorItemVenta(id),
    db.deposito.findMany({
      where: { activo: true },
      orderBy: { nombre: "asc" },
      select: { id: true, nombre: true },
    }),
  ]);

  const conSaldo = pendientes.filter((p) => p.pendiente > 0);
  if (conSaldo.length === 0) {
    return (
      <main className="container mx-auto p-6">
        <h1 className="text-2xl font-semibold">Nueva entrega</h1>
        <p className="mt-4 text-muted-foreground">
          No quedan items pendientes de entrega para la venta {venta.numero}.
        </p>
        <Link
          href={`/ventas/${id}/entregas`}
          className="mt-4 inline-block text-primary underline"
        >
          ← Volver
        </Link>
      </main>
    );
  }

  return (
    <main className="container mx-auto space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Nueva entrega</h1>
        <p className="text-sm text-muted-foreground">
          Venta {venta.numero}
        </p>
      </header>
      <NuevaEntregaForm
        ventaId={id}
        depositos={depositos}
        pendientes={conSaldo}
      />
    </main>
  );
}
