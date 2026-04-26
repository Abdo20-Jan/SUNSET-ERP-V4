import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon } from "@hugeicons/core-free-icons";

import { listarPedidosVenta } from "@/lib/actions/pedidos-venta";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

import { PedidosVentaTable } from "./_components/pedidos-venta-table";

export default async function PedidosVentaPage() {
  const rows = await listarPedidosVenta();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Pedidos de venta (OV)
          </h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} pedido{rows.length === 1 ? "" : "s"} · planificación
            de ventas antes de la factura.
          </p>
        </div>
        <Link
          href="/ventas/pedidos/nuevo"
          className={buttonVariants({ variant: "default" })}
        >
          <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
          Nuevo pedido
        </Link>
      </div>

      <Card className="py-0">
        <PedidosVentaTable data={rows} />
      </Card>
    </div>
  );
}
