import {
  listarCuentasContablesParaGastoProveedor,
  listarCuentasContablesParaProveedor,
  listarProveedores,
} from "@/lib/actions/proveedores";
import { Card } from "@/components/ui/card";
import { Pagination } from "@/components/ui/pagination";
import { parsePaginationParams } from "@/components/ui/pagination-params";
import { parseSortParams } from "@/lib/table-sort";

import { ProveedoresTable } from "./proveedores-table";

type SearchParams = Promise<{
  q?: string;
  pais?: string;
  page?: string;
  perPage?: string;
  sort?: string;
  dir?: string;
}>;

export const dynamic = "force-dynamic";

export default async function ProveedoresPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { page, perPage } = parsePaginationParams(params);
  const { sort, dir } = parseSortParams(
    { sort: params.sort, dir: params.dir },
    ["nombre", "cuit", "pais"],
    { sort: "nombre", dir: "asc" },
  );
  const q = params.q?.trim() ?? "";
  const pais = params.pais?.trim() ?? "";

  const [{ rows, total, paises }, cuentas, cuentasGasto] = await Promise.all([
    listarProveedores({ q, pais, page, perPage, sort, dir }),
    listarCuentasContablesParaProveedor(),
    listarCuentasContablesParaGastoProveedor(),
  ]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="text-[15px] font-semibold tracking-tight">Proveedores</h1>
        <p className="text-sm text-muted-foreground">
          {total} proveedor
          {total === 1 ? "" : "es"} registrado
          {total === 1 ? "" : "s"}.
        </p>
      </div>

      <Card className="py-0">
        <ProveedoresTable
          proveedores={rows}
          total={total}
          paises={paises}
          q={q}
          pais={pais}
          sort={sort}
          dir={dir}
          page={page}
          perPage={perPage}
          cuentas={cuentas}
          cuentasGasto={cuentasGasto}
        />
        <Pagination page={page} perPage={perPage} total={total} className="border-t" />
      </Card>
    </div>
  );
}
