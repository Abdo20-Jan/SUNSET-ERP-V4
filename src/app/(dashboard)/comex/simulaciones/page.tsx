import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon } from "@hugeicons/core-free-icons";

import { listarSimulaciones } from "@/lib/actions/simulaciones-importacion";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

import { SimulacionesTable } from "./simulaciones-table";

export const dynamic = "force-dynamic";

export default async function SimulacionesPage() {
  const rows = await listarSimulaciones();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[15px] font-semibold tracking-tight">Simulaciones de importación</h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} simulación{rows.length === 1 ? "" : "es"} · cálculo sin asientos
          </p>
        </div>
        <Link href="/comex/simulaciones/nueva" className={buttonVariants({ variant: "default" })}>
          <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
          Nueva simulación
        </Link>
      </div>

      <Card className="py-0">
        <SimulacionesTable data={rows} />
      </Card>
    </div>
  );
}
