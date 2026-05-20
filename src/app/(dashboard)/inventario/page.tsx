import Link from "next/link";

import {
  listarEnProduccion,
  listarEnTransito,
  listarMatrizInventario,
} from "@/lib/actions/inventario";
import { isStockDualEnabled } from "@/lib/features";

import { InventarioTabs } from "./_components/inventario-tabs";

type SearchParams = Promise<{ q?: string; tab?: string }>;

export const dynamic = "force-dynamic";

export default async function InventarioPage({ searchParams }: { searchParams: SearchParams }) {
  const { q, tab } = await searchParams;

  const [{ productos, depositos }, transito, produccion] = await Promise.all([
    listarMatrizInventario({ search: q }),
    listarEnTransito({ search: q }),
    listarEnProduccion({ search: q }),
  ]);

  const flagSuffix = isStockDualEnabled() ? "" : " · stock dual: OFF";

  const tabsValidas = new Set<string>([...depositos.map((d) => d.id), "transito", "produccion"]);
  const initialTab = tab && tabsValidas.has(tab) ? tab : (depositos[0]?.id ?? "transito");

  return (
    <main className="container mx-auto space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Inventario</h1>
          <p className="text-sm text-muted-foreground">
            {productos.length} productos · {depositos.length} depósitos
            {flagSuffix}
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
        {tab ? <input type="hidden" name="tab" value={tab} /> : null}
        <button type="submit" className="rounded-md border px-4 py-2 hover:bg-muted">
          Buscar
        </button>
      </form>

      <InventarioTabs
        productos={productos}
        depositos={depositos}
        enTransito={transito.filas}
        enProduccion={produccion.filas}
        initialTab={initialTab}
      />
    </main>
  );
}
