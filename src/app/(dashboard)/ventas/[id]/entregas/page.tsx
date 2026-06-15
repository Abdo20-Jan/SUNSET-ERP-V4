import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { listarEntregasDeVenta } from "@/lib/actions/entregas";
import { db } from "@/lib/db";
import { isStockDualEnabled } from "@/lib/features";
import { fmtDate } from "@/lib/format";
import type { EntregaEstado } from "@/generated/prisma/client";

import { EntregaActions } from "./_components/entrega-actions";

type PageParams = Promise<{ id: string }>;

export const dynamic = "force-dynamic";

function estadoVariant(estado: EntregaEstado): "default" | "secondary" | "destructive" {
  switch (estado) {
    case "CONFIRMADA":
      return "default";
    case "ANULADA":
      return "destructive";
    default:
      return "secondary";
  }
}

export default async function EntregasPage({ params }: { params: PageParams }) {
  const { id } = await params;

  const venta = await db.venta.findUnique({
    where: { id },
    select: { id: true, numero: true, estado: true },
  });
  if (!venta) notFound();

  if (!isStockDualEnabled()) {
    return (
      <main className="container mx-auto space-y-4 p-6">
        <h1 className="text-2xl font-semibold">Entregas — Venta {venta.numero.trim()}</h1>
        <p className="text-muted-foreground">
          El módulo de entregas (stock dual) no está habilitado en este ambiente. Setear{" "}
          <code>STOCK_DUAL_ENABLED=true</code> para activarlo.
        </p>
      </main>
    );
  }

  const entregas = await listarEntregasDeVenta(id);
  const confirmadas = entregas.filter((e) => e.estado === "CONFIRMADA").length;
  const borradores = entregas.filter((e) => e.estado === "BORRADOR").length;

  return (
    <main className="container mx-auto space-y-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Link
            href={`/ventas/${id}`}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ← Venta {venta.numero.trim()}
          </Link>
          <h1 className="text-2xl font-semibold">Entregas</h1>
          <p className="text-sm text-muted-foreground">
            {entregas.length} remito(s)
            {borradores > 0 ? ` · ${borradores} borrador` : ""}
            {confirmadas > 0 ? ` · ${confirmadas} confirmado(s)` : ""}
          </p>
        </div>
        {venta.estado === "EMITIDA" && (
          <Link
            href={`/ventas/${id}/entregas/nueva`}
            className={buttonVariants({ variant: "default" })}
          >
            Nueva entrega
          </Link>
        )}
      </header>

      {entregas.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Aún no hay remitos para esta venta. Usá “Nueva entrega” para registrar un despacho
            (total o parcial).
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {entregas.map((e) => (
            <Card key={e.id}>
              <CardContent className="flex items-start justify-between gap-4">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{e.numero}</span>
                    <Badge variant={estadoVariant(e.estado)}>{e.estado}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {e.deposito.nombre} · {fmtDate(e.fecha)}
                  </p>
                  {e.observacion && (
                    <p className="text-sm text-muted-foreground">{e.observacion}</p>
                  )}
                  <ul className="mt-1 space-y-1 text-sm">
                    {e.items.map((it) => (
                      <li key={it.id}>
                        {it.cantidad} ×{" "}
                        <span className="font-mono text-xs">{it.itemVenta.producto.codigo}</span> —{" "}
                        {it.itemVenta.producto.nombre}
                      </li>
                    ))}
                  </ul>
                </div>
                <EntregaActions entregaId={e.id} numero={e.numero} estado={e.estado} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
