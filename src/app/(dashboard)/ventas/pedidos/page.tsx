import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon } from "@hugeicons/core-free-icons";

import { auth } from "@/lib/auth";
import { listarPedidosVenta } from "@/lib/actions/pedidos-venta";
import { getCotizacionParaFecha } from "@/lib/services/cotizacion";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

import { MonedaToggle, type Moneda } from "../../reportes/_components/moneda-toggle";

import { PedidosVentaTable } from "./_components/pedidos-venta-table";

type SearchParams = Promise<{ moneda?: string }>;

export const dynamic = "force-dynamic";

export default async function PedidosVentaPage({ searchParams }: { searchParams: SearchParams }) {
  const [params, session, cotizacion, rows] = await Promise.all([
    searchParams,
    auth(),
    getCotizacionParaFecha(new Date()),
    listarPedidosVenta(),
  ]);

  const monedaPreferida: Moneda = session?.user.monedaPreferida === "ARS" ? "ARS" : "USD";
  const moneda: Moneda =
    params.moneda === "ARS" ? "ARS" : params.moneda === "USD" ? "USD" : monedaPreferida;
  const tc = cotizacion ? cotizacion.valor.toString() : null;
  const tcInfo = cotizacion
    ? {
        valor: cotizacion.valor.toString(),
        fecha: cotizacion.fecha.toISOString().slice(0, 10),
        fuente: cotizacion.fuente,
      }
    : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[15px] font-semibold tracking-tight">Pedidos de venta (OV)</h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} pedido{rows.length === 1 ? "" : "s"} · planificación de ventas antes de la
            factura.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <MonedaToggle current={moneda} tcInfo={tcInfo} />
          <Link href="/ventas/pedidos/nuevo" className={buttonVariants({ variant: "default" })}>
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
            Nuevo pedido
          </Link>
        </div>
      </div>

      <Card className="py-0">
        <PedidosVentaTable data={rows} moneda={moneda} tc={tc} />
      </Card>
    </div>
  );
}
