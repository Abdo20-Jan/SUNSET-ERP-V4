import Link from "next/link";

import { listarMatrizInventario } from "@/lib/actions/inventario";
import { isStockDualEnabled } from "@/lib/features";

import { InventarioMatrix } from "./_components/inventario-matrix";

type SearchParams = Promise<{ q?: string }>;

export default async function InventarioPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { q } = await searchParams;
  const { productos, depositos } = await listarMatrizInventario({ search: q });
  const flagSuffix = isStockDualEnabled() ? "" : " · stock dual: OFF";

  return (
    <main className="container mx-auto space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Inventario</h1>
          <p className="text-sm text-muted-foreground">
            Stock por depósito · {productos.length} productos · {depositos.length} depósitos{flagSuffix}
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

      <InventarioMatrix productos={productos} depositos={depositos} />
    </main>
  );
}
