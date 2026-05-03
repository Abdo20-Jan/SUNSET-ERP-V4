import Link from "next/link";

import { listarMatrizInventario } from "@/lib/actions/inventario";
import { isStockDualEnabled } from "@/lib/features";

type SearchParams = Promise<{ q?: string }>;

export default async function InventarioPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { q } = await searchParams;
  const { productos, depositos } = await listarMatrizInventario({ search: q });
  const flagOn = isStockDualEnabled();

  return (
    <main className="container mx-auto space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Inventario</h1>
          <p className="text-sm text-muted-foreground">
            Stock por depósito · {productos.length} productos · {depositos.length} depósitos
            {!flagOn && " · stock dual: OFF"}
          </p>
        </div>
        <Link
          href="/inventario/transferencias"
          className="rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90"
        >
          Transferencias
        </Link>
      </header>

      <form className="flex gap-2" action="/inventario">
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Buscar por código o nombre…"
          className="flex-1 rounded-md border bg-background px-3 py-2"
        />
        <button
          type="submit"
          className="rounded-md border px-4 py-2 hover:bg-muted"
        >
          Buscar
        </button>
      </form>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left">
            <tr>
              <th className="px-3 py-2">Producto</th>
              <th className="px-3 py-2 text-right">Total</th>
              {depositos.map((d) => (
                <th key={d.id} className="px-3 py-2 text-right" colSpan={3}>
                  {d.nombre}
                </th>
              ))}
            </tr>
            <tr className="text-xs text-muted-foreground">
              <th className="px-3 py-1"></th>
              <th className="px-3 py-1"></th>
              {depositos.map((d) => (
                <SubHeader key={d.id} />
              ))}
            </tr>
          </thead>
          <tbody>
            {productos.map((p) => {
              const byDep = new Map(
                p.stockPorDeposito.map((s) => [s.depositoId, s]),
              );
              return (
                <tr key={p.id} className="border-t">
                  <td className="px-3 py-2">
                    <div className="font-mono text-xs">{p.codigo}</div>
                    <div>{p.nombre}</div>
                  </td>
                  <td className="px-3 py-2 text-right font-medium">
                    {p.stockActual}
                  </td>
                  {depositos.map((d) => {
                    const s = byDep.get(d.id);
                    const fisica = s?.cantidadFisica ?? 0;
                    const reservada = s?.cantidadReservada ?? 0;
                    const disponible = fisica - reservada;
                    return (
                      <Cells
                        key={d.id}
                        fisica={fisica}
                        reservada={reservada}
                        disponible={disponible}
                      />
                    );
                  })}
                </tr>
              );
            })}
            {productos.length === 0 && (
              <tr>
                <td
                  colSpan={2 + depositos.length * 3}
                  className="px-3 py-8 text-center text-muted-foreground"
                >
                  Sin resultados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function SubHeader() {
  return (
    <>
      <th className="px-3 py-1 text-right font-normal">Físico</th>
      <th className="px-3 py-1 text-right font-normal">Reservado</th>
      <th className="px-3 py-1 text-right font-normal">Disponible</th>
    </>
  );
}

function Cells({
  fisica,
  reservada,
  disponible,
}: {
  fisica: number;
  reservada: number;
  disponible: number;
}) {
  return (
    <>
      <td className="px-3 py-2 text-right">{fisica}</td>
      <td className="px-3 py-2 text-right text-amber-700">{reservada || "—"}</td>
      <td className="px-3 py-2 text-right font-medium">{disponible}</td>
    </>
  );
}
