import Link from "next/link";
import {
  Building03Icon,
  FactoryIcon,
  PackageIcon,
  TruckDeliveryIcon,
} from "@hugeicons/core-free-icons";

import {
  listarEnProduccion,
  listarEnTransito,
  listarMatrizInventario,
  listarStockAduanero,
} from "@/lib/actions/inventario";
import { isContenedorDesconsolidacionEnabled, isStockDualEnabled } from "@/lib/features";
import { fmtInt } from "@/lib/format";

import { KpiCard } from "../dashboard/_components/kpi-card";
import { InventarioTabs } from "./_components/inventario-tabs";

type SearchParams = Promise<{ q?: string; tab?: string }>;

export const dynamic = "force-dynamic";

export default async function InventarioPage({ searchParams }: { searchParams: SearchParams }) {
  const { q, tab } = await searchParams;

  const flagAduana = isContenedorDesconsolidacionEnabled();

  const [{ productos, depositos }, transito, produccion, aduana] = await Promise.all([
    listarMatrizInventario({ search: q }),
    listarEnTransito({ search: q }),
    listarEnProduccion({ search: q }),
    flagAduana ? listarStockAduanero({ search: q }) : Promise.resolve(null),
  ]);

  const flagSuffix = isStockDualEnabled() ? "" : " · stock dual: OFF";

  const tabsValidas = new Set<string>([
    ...depositos.map((d) => d.id),
    "transito",
    "produccion",
    ...(flagAduana ? ["aduana"] : []),
  ]);
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

      <section className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <KpiCard
          label="Productos"
          value={fmtInt(productos.length)}
          icon={PackageIcon}
          accent="info"
          hint="SKUs con stock físico"
        />
        <KpiCard
          label="Depósitos"
          value={fmtInt(depositos.length)}
          icon={Building03Icon}
          accent="neutral"
          hint="Activos"
        />
        <KpiCard
          label="En tránsito"
          value={fmtInt(transito.filas.length)}
          icon={TruckDeliveryIcon}
          accent="neutral"
          hint="Productos en embarques no nacionalizados"
        />
        <KpiCard
          label="En producción"
          value={fmtInt(produccion.filas.length)}
          icon={FactoryIcon}
          accent="neutral"
          hint="Productos pedidos a fábrica sin embarcar"
        />
      </section>

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
        stockAduanero={aduana?.filas ?? null}
        initialTab={initialTab}
      />
    </main>
  );
}
