import Link from "next/link";

import { listarTransferencias } from "@/lib/actions/transferencias";
import { isStockDualEnabled } from "@/lib/features";

import { TransferenciaRow } from "./_components/transferencia-row";

export default async function TransferenciasPage() {
  if (!isStockDualEnabled()) {
    return (
      <main className="container mx-auto p-6">
        <h1 className="text-2xl font-semibold">Transferencias entre depósitos</h1>
        <p className="mt-4 text-muted-foreground">
          Stock dual no habilitado. Setear <code>STOCK_DUAL_ENABLED=true</code>.
        </p>
      </main>
    );
  }

  const transferencias = await listarTransferencias();

  return (
    <main className="container mx-auto space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Transferencias</h1>
          <p className="text-sm text-muted-foreground">
            {transferencias.length} transferencia(s)
          </p>
        </div>
        <Link
          href="/inventario/transferencias/nueva"
          className="rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90"
        >
          Nueva transferencia
        </Link>
      </header>

      {transferencias.length === 0 ? (
        <p className="text-muted-foreground">Aún no hay transferencias.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left">
              <tr>
                <th className="px-3 py-2">Número</th>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Producto</th>
                <th className="px-3 py-2 text-right">Cantidad</th>
                <th className="px-3 py-2">Origen → Destino</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {transferencias.map((t) => (
                <TransferenciaRow key={t.id} t={t} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
