import Link from "next/link";
import { notFound } from "next/navigation";

import { listarEntregasDeVenta } from "@/lib/actions/entregas";
import { db } from "@/lib/db";
import { isStockDualEnabled } from "@/lib/features";
import { fmtDate } from "@/lib/format";

import { EntregaActions } from "./_components/entrega-actions";

type PageParams = Promise<{ id: string }>;

export default async function EntregasPage({
  params,
}: {
  params: PageParams;
}) {
  const { id } = await params;

  const venta = await db.venta.findUnique({
    where: { id },
    select: { id: true, numero: true, estado: true },
  });
  if (!venta) notFound();

  if (!isStockDualEnabled()) {
    return (
      <main className="container mx-auto p-6">
        <h1 className="text-2xl font-semibold">Entregas — Venta {venta.numero}</h1>
        <p className="mt-4 text-muted-foreground">
          El módulo de entregas (stock dual) no está habilitado en este
          ambiente. Setear <code>STOCK_DUAL_ENABLED=true</code> para activarlo.
        </p>
      </main>
    );
  }

  const entregas = await listarEntregasDeVenta(id);

  return (
    <main className="container mx-auto space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Entregas</h1>
          <p className="text-sm text-muted-foreground">
            Venta {venta.numero} · {entregas.length} entrega(s)
          </p>
        </div>
        {venta.estado === "EMITIDA" && (
          <Link
            href={`/ventas/${id}/entregas/nueva`}
            className="rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90"
          >
            Nueva entrega
          </Link>
        )}
      </header>

      {entregas.length === 0 ? (
        <p className="text-muted-foreground">Aún no hay entregas registradas.</p>
      ) : (
        <ul className="space-y-3">
          {entregas.map((e) => (
            <li
              key={e.id}
              className="rounded-md border bg-card p-4 shadow-sm"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium">
                    {e.numero} · {e.deposito.nombre} ·{" "}
                    <span className="text-sm text-muted-foreground">
                      {fmtDate(e.fecha)}
                    </span>
                  </p>
                  <p className="text-sm">
                    Estado:{" "}
                    <span
                      className={
                        e.estado === "CONFIRMADA"
                          ? "font-medium text-green-700"
                          : e.estado === "ANULADA"
                            ? "text-red-700"
                            : "text-amber-700"
                      }
                    >
                      {e.estado}
                    </span>
                  </p>
                  {e.observacion && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {e.observacion}
                    </p>
                  )}
                  <ul className="mt-2 space-y-1 text-sm">
                    {e.items.map((it) => (
                      <li key={it.id}>
                        {it.cantidad} ×{" "}
                        <span className="font-mono">
                          {it.itemVenta.producto.codigo}
                        </span>{" "}
                        — {it.itemVenta.producto.nombre}
                      </li>
                    ))}
                  </ul>
                </div>
                <EntregaActions entregaId={e.id} estado={e.estado} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
