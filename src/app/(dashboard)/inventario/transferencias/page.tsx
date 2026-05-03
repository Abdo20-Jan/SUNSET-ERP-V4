import Link from "next/link";

import { listarTransferencias } from "@/lib/actions/transferencias";
import { isStockDualEnabled } from "@/lib/features";
import { fmtDate } from "@/lib/format";

import { TransferenciaActions } from "./_components/transferencia-actions";

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
                <tr key={t.id} className="border-t">
                  <td className="px-3 py-2 font-mono text-xs">{t.numero}</td>
                  <td className="px-3 py-2">{fmtDate(t.fecha)}</td>
                  <td className="px-3 py-2">
                    <div className="font-mono text-xs">{t.producto.codigo}</div>
                    <div>{t.producto.nombre}</div>
                  </td>
                  <td className="px-3 py-2 text-right font-medium">
                    {t.cantidad}
                  </td>
                  <td className="px-3 py-2">
                    {t.origen.nombre} → {t.destino.nombre}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={
                        t.estado === "CONFIRMADA"
                          ? "font-medium text-green-700"
                          : "text-red-700"
                      }
                    >
                      {t.estado}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <TransferenciaActions
                      transferenciaId={t.id}
                      estado={t.estado}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
