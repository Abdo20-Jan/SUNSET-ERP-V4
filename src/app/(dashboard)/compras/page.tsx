import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon } from "@hugeicons/core-free-icons";

import { listarCompras } from "@/lib/actions/compras";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Pagination, parsePaginationParams } from "@/components/ui/pagination";

import { ComprasTable } from "./_components/compras-table";

type SearchParams = Promise<{ page?: string; perPage?: string }>;

export default async function ComprasPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const { page, perPage } = parsePaginationParams(params);

  const { rows, total, emitidas, borradores } = await listarCompras({
    page,
    perPage,
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[15px] font-semibold tracking-tight">Compras</h1>
          <p className="text-sm text-muted-foreground">
            {total} compra{total === 1 ? "" : "s"}
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
            href="/compras/pedidos"
            className={buttonVariants({ variant: "outline" })}
          >
            Pedidos (OC)
          </Link>
          <Link
            href="/compras/nueva"
            className={buttonVariants({ variant: "default" })}
          >
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
            Nueva compra
          </Link>
        </div>
      </div>

      <Card className="py-0">
        <ComprasTable data={rows} />
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
