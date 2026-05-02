import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon } from "@hugeicons/core-free-icons";

import { listarVentas } from "@/lib/actions/ventas";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Pagination, parsePaginationParams } from "@/components/ui/pagination";

import { VentasTable } from "./_components/ventas-table";

type SearchParams = Promise<{ page?: string; perPage?: string }>;

export default async function VentasPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const { page, perPage } = parsePaginationParams(params);

  const { rows, total, emitidas, borradores } = await listarVentas({
    page,
    perPage,
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[15px] font-semibold tracking-tight">Ventas</h1>
          <p className="text-sm text-muted-foreground">
            {total} venta{total === 1 ? "" : "s"}
            {total > 0 && (
              <span>
                {" "}
                · {emitidas} emitida{emitidas === 1 ? "" : "s"} · {borradores}{" "}
                borrador{borradores === 1 ? "" : "es"}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/ventas/pedidos"
            className={buttonVariants({ variant: "outline" })}
          >
            Pedidos (OV)
          </Link>
          <Link
            href="/ventas/nueva"
            className={buttonVariants({ variant: "default" })}
          >
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
            Nueva venta
          </Link>
        </div>
      </div>

      <Card className="py-0">
        <VentasTable data={rows} />
        <Pagination
          page={page}
          perPage={perPage}
          total={total}
          className="border-t"
        />
      </Card>
    </div>
  );
}
