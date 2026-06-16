import Link from "next/link";
import { notFound } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { saldoPendientePorItemVenta } from "@/lib/actions/entregas";
import { db } from "@/lib/db";
import { isStockDualEnabled } from "@/lib/features";
import { getDefaultFecha } from "@/lib/server/fecha-default";
import { TipoDeposito } from "@/generated/prisma/client";

import { NuevaEntregaForm } from "./_components/nueva-entrega-form";

type PageParams = Promise<{ id: string }>;

export const dynamic = "force-dynamic";

function Aviso({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <main className="container mx-auto space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Nueva entrega</h1>
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">{children}</CardContent>
      </Card>
      <Link
        href={`/ventas/${id}/entregas`}
        className={buttonVariants({ variant: "outline", size: "sm" })}
      >
        ← Volver a entregas
      </Link>
    </main>
  );
}

export default async function NuevaEntregaPage({ params }: { params: PageParams }) {
  const { id } = await params;

  if (!isStockDualEnabled()) {
    return (
      <Aviso id={id}>
        Stock dual no habilitado. Setear <code>STOCK_DUAL_ENABLED=true</code>.
      </Aviso>
    );
  }

  const venta = await db.venta.findUnique({
    where: { id },
    select: { id: true, numero: true, estado: true },
  });
  if (!venta) notFound();
  if (venta.estado !== "EMITIDA") {
    return (
      <Aviso id={id}>
        La venta {venta.numero.trim()} debe estar EMITIDA para registrar entregas (estado actual:{" "}
        {venta.estado}).
      </Aviso>
    );
  }

  const [pendientes, depositos, defaultFecha] = await Promise.all([
    saldoPendientePorItemVenta(id),
    db.deposito.findMany({
      // Excluye ZPA — mercadería en custodia aduanera, no disponible
      // para entregar al cliente hasta nacionalizarse.
      where: { activo: true, tipo: TipoDeposito.NACIONAL },
      orderBy: { nombre: "asc" },
      select: { id: true, nombre: true },
    }),
    getDefaultFecha(),
  ]);

  const conSaldo = pendientes.filter((p) => p.pendiente > 0);
  if (conSaldo.length === 0) {
    return (
      <Aviso id={id}>
        No quedan items pendientes de entrega para la venta {venta.numero.trim()}.
      </Aviso>
    );
  }

  return (
    <main className="container mx-auto space-y-6 p-6">
      <header className="flex flex-col gap-1">
        <Link
          href={`/ventas/${id}/entregas`}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← Entregas de la venta {venta.numero.trim()}
        </Link>
        <h1 className="text-2xl font-semibold">Nueva entrega</h1>
      </header>
      <NuevaEntregaForm
        ventaId={id}
        depositos={depositos}
        pendientes={conSaldo}
        defaultFecha={defaultFecha}
      />
    </main>
  );
}
