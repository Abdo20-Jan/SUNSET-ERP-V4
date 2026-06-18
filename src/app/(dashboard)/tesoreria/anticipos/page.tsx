import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon } from "@hugeicons/core-free-icons";

import { listarAnticiposProveedor } from "@/lib/actions/anticipos-proveedor";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

import { AnticiposTable } from "./anticipos-table";

type SearchParams = Promise<{ anticipoId?: string }>;

export const dynamic = "force-dynamic";

export default async function AnticiposPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;

  const rows = await listarAnticiposProveedor();

  const anticipoIdParam =
    params.anticipoId && /^[0-9a-f-]{36}$/i.test(params.anticipoId) ? params.anticipoId : null;
  const anticipoInicial = anticipoIdParam
    ? (rows.find((r) => r.id === anticipoIdParam) ?? null)
    : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[15px] font-semibold tracking-tight">Anticipos a proveedor</h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} anticipo{rows.length === 1 ? "" : "s"} · adelantos a proveedores locales
            (bienes 1.1.7.07 / servicios 1.1.5.01)
          </p>
        </div>
        <Link href="/tesoreria/anticipos/nuevo" className={buttonVariants({ variant: "default" })}>
          <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
          Nuevo anticipo
        </Link>
      </div>

      <Card className="py-0">
        <AnticiposTable data={rows} anticipoInicial={anticipoInicial} />
      </Card>
    </div>
  );
}
