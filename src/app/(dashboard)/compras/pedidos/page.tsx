import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon } from "@hugeicons/core-free-icons";

import { listarPedidosCompra } from "@/lib/actions/pedidos-compra";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

import { PedidosCompraTable } from "./_components/pedidos-compra-table";

export default async function PedidosCompraPage() {
  const rows = await listarPedidosCompra();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[15px] font-semibold tracking-tight">
            Pedidos de compra (OC)
          </h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} pedido{rows.length === 1 ? "" : "s"} · planificación
            de compras antes de la factura.
          </p>
        </div>
        <Link
          href="/compras/pedidos/nuevo"
          className={buttonVariants({ variant: "default" })}
        >
          <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
          Nuevo pedido
        </Link>
      </div>

      <Card className="py-0">
        <PedidosCompraTable data={rows} />
      </Card>
    </div>
  );
}
