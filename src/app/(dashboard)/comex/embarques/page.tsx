import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon } from "@hugeicons/core-free-icons";

import { listarEmbarques, type EmbarqueListFilters } from "@/lib/actions/embarques";
import { db } from "@/lib/db";
import { EmbarqueEstado, Moneda } from "@/generated/prisma/client";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Pagination } from "@/components/ui/pagination";
import { parsePaginationParams } from "@/components/ui/pagination-params";

import { EmbarquesFilters } from "./embarques-filters";
import { EmbarquesTable } from "./embarques-table";
import { EmbarquesTabs, type EmbarqueTabKey } from "./embarques-tabs";

type SearchParams = Promise<{
  tab?: string;
  moneda?: string;
  page?: string;
  perPage?: string;
}>;

const TAB_ESTADOS: Record<EmbarqueTabKey, EmbarqueEstado[]> = {
  transito: [EmbarqueEstado.EN_TRANSITO],
  porto: [EmbarqueEstado.EN_PUERTO, EmbarqueEstado.EN_ZONA_PRIMARIA, EmbarqueEstado.EN_ADUANA],
  finalizados: [EmbarqueEstado.DESPACHADO, EmbarqueEstado.EN_DEPOSITO, EmbarqueEstado.CERRADO],
  borrador: [EmbarqueEstado.BORRADOR],
};

const TAB_LABELS: Record<EmbarqueTabKey, string> = {
  transito: "en tránsito",
  porto: "en puerto",
  finalizados: "finalizados",
  borrador: "borradores",
};

function parseTab(v: string | undefined): EmbarqueTabKey {
  if (v === "transito" || v === "porto" || v === "finalizados" || v === "borrador") {
    return v;
  }
  return "transito";
}

function parseMoneda(v: string | undefined): Moneda | null {
  if (v === "ARS") return Moneda.ARS;
  if (v === "USD") return Moneda.USD;
  return null;
}

export const dynamic = "force-dynamic";

export default async function EmbarquesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;

  const tab = parseTab(params.tab);
  const moneda = parseMoneda(params.moneda);
  const { page, perPage } = parsePaginationParams(params);

  const filtros: EmbarqueListFilters & { page: number; perPage: number } = {
    estado: TAB_ESTADOS[tab],
    page,
    perPage,
  };
  if (moneda) filtros.moneda = moneda;

  const [{ rows, total }, grouped] = await Promise.all([
    listarEmbarques(filtros),
    db.embarque.groupBy({
      by: ["estado"],
      _count: { _all: true },
    }),
  ]);

  const countByEstado = new Map<EmbarqueEstado, number>(
    grouped.map((g) => [g.estado, g._count._all]),
  );
  const counts = {
    transito: TAB_ESTADOS.transito.reduce((a, e) => a + (countByEstado.get(e) ?? 0), 0),
    porto: TAB_ESTADOS.porto.reduce((a, e) => a + (countByEstado.get(e) ?? 0), 0),
    finalizados: TAB_ESTADOS.finalizados.reduce((a, e) => a + (countByEstado.get(e) ?? 0), 0),
    borrador: TAB_ESTADOS.borrador.reduce((a, e) => a + (countByEstado.get(e) ?? 0), 0),
  };

  const filtroTags: string[] = [TAB_LABELS[tab]];
  if (moneda) filtroTags.push(`moneda ${moneda}`);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[15px] font-semibold tracking-tight">Embarques</h1>
          <p className="text-sm text-muted-foreground">
            {total} embarque{total === 1 ? "" : "s"} · {filtroTags.join(" · ")}
          </p>
        </div>
        <Link href="/comex/embarques/nuevo" className={buttonVariants({ variant: "default" })}>
          <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
          Nuevo embarque
        </Link>
      </div>

      <EmbarquesTabs current={tab} counts={counts} />

      <EmbarquesFilters selectedMoneda={moneda ?? "all"} />

      <Card className="py-0">
        <EmbarquesTable data={rows} />
        <Pagination page={page} perPage={perPage} total={total} className="border-t" />
      </Card>
    </div>
  );
}
