import { listarProductos } from "@/lib/actions/productos";
import { listarVistas } from "@/lib/actions/saved-views";
import { Card } from "@/components/ui/card";
import { Pagination } from "@/components/ui/pagination";
import { parsePaginationParams } from "@/components/ui/pagination-params";
import { parseSortParams } from "@/lib/table-sort";

import { ProductosTable } from "./productos-table";

type SearchParams = Promise<{
  q?: string;
  marca?: string;
  page?: string;
  perPage?: string;
  sort?: string;
  dir?: string;
}>;

export const dynamic = "force-dynamic";

export default async function ProductosPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { page, perPage } = parsePaginationParams(params);
  const { sort, dir } = parseSortParams(
    { sort: params.sort, dir: params.dir },
    ["codigo", "nombre", "marca", "stock", "precio", "estado"],
    { sort: "codigo", dir: "asc" },
  );
  const q = params.q?.trim() ?? "";
  const marca = params.marca?.trim() ?? "";

  const [{ rows, total, marcas }, vistas] = await Promise.all([
    listarProductos({ q, marca, page, perPage, sort, dir }),
    listarVistas("/maestros/productos"),
  ]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="text-[15px] font-semibold tracking-tight">Productos</h1>
        <p className="text-sm text-muted-foreground">
          {total} producto{total === 1 ? "" : "s"} en el catálogo.
        </p>
      </div>

      <Card className="py-0">
        <ProductosTable
          productos={rows}
          total={total}
          marcas={marcas}
          vistas={vistas}
          q={q}
          marca={marca}
          sort={sort}
          dir={dir}
          page={page}
          perPage={perPage}
        />
        <Pagination page={page} perPage={perPage} total={total} className="border-t" />
      </Card>
    </div>
  );
}
