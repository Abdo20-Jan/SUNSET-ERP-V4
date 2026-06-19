import { listarClientes, listarCuentasContablesParaCliente } from "@/lib/actions/clientes";
import { listarProvincias } from "@/lib/actions/provincias";
import { Card } from "@/components/ui/card";
import { Pagination } from "@/components/ui/pagination";
import { parsePaginationParams } from "@/components/ui/pagination-params";
import { parseSortParams } from "@/lib/table-sort";

import { ClientesTable } from "./clientes-table";

type SearchParams = Promise<{
  q?: string;
  estado?: string;
  page?: string;
  perPage?: string;
  sort?: string;
  dir?: string;
}>;

export const dynamic = "force-dynamic";

export default async function ClientesPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { page, perPage } = parsePaginationParams(params);
  const { sort, dir } = parseSortParams(
    { sort: params.sort, dir: params.dir },
    ["nombre", "cuit"],
    { sort: "nombre", dir: "asc" },
  );
  const q = params.q?.trim() ?? "";
  const estado = params.estado?.trim() ?? "";

  const [{ rows, total }, cuentas, provincias] = await Promise.all([
    listarClientes({ q, estado, page, perPage, sort, dir }),
    listarCuentasContablesParaCliente(),
    listarProvincias(),
  ]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="text-[15px] font-semibold tracking-tight">Clientes</h1>
        <p className="text-sm text-muted-foreground">
          {total} cliente{total === 1 ? "" : "s"} registrado{total === 1 ? "" : "s"}.
        </p>
      </div>

      <Card className="py-0">
        <ClientesTable
          clientes={rows}
          total={total}
          cuentas={cuentas}
          provincias={provincias}
          q={q}
          estado={estado}
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
