import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon } from "@hugeicons/core-free-icons";

import { listarCompras } from "@/lib/actions/compras";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

import { ComprasTable } from "./_components/compras-table";

export default async function ComprasPage() {
  const rows = await listarCompras();

  const emitidas = rows.filter((r) => r.estado === "EMITIDA").length;
  const borradores = rows.filter((r) => r.estado === "BORRADOR").length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Compras</h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} compra{rows.length === 1 ? "" : "s"}
            {rows.length > 0 && (
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
      </Card>
    </div>
  );
}
