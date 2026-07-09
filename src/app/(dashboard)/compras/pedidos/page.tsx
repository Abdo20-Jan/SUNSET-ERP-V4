import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon } from "@hugeicons/core-free-icons";

import { CompraEstado } from "@/generated/prisma/client";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { listarPedidosCompra } from "@/lib/actions/pedidos-compra";
import { getCotizacionParaFecha } from "@/lib/services/cotizacion";
import { buttonVariants } from "@/components/ui/button";

import { MonedaToggle, type Moneda } from "../../reportes/_components/moneda-toggle";

import {
  filtrarPorVista,
  flattenPedidos,
  type PedidosCompraVista,
  resolverVista,
  VISTA_LABELS,
} from "./_components/pedidos-compra-presentacion";
import { PedidosCompraWorklist } from "./_components/pedidos-compra-worklist";

type SearchParams = Promise<{ vista?: string; moneda?: string }>;

export const dynamic = "force-dynamic";

const BASE_HREF = "/compras/pedidos";

const VISTAS: PedidosCompraVista[] = ["todas", "abiertas", "completadas", "canceladas"];

// Preset como LINK server-side (espejo fin-cxc page): preserva `?moneda`.
function buildHref(vista: PedidosCompraVista, moneda: string | undefined): string {
  const qp = new URLSearchParams();
  if (vista !== "todas") qp.set("vista", vista);
  if (moneda) qp.set("moneda", moneda);
  const qs = qp.toString();
  return qs ? `${BASE_HREF}?${qs}` : BASE_HREF;
}

function resolverMoneda(param: string | undefined, preferida: string | null | undefined): Moneda {
  if (param === "ARS" || param === "USD") return param;
  return preferida === "ARS" ? "ARS" : "USD";
}

type Cotizacion = Awaited<ReturnType<typeof getCotizacionParaFecha>>;

function buildTcInfo(cotizacion: Cotizacion) {
  if (!cotizacion) return null;
  return {
    valor: cotizacion.valor.toString(),
    fecha: cotizacion.fecha.toISOString().slice(0, 10),
    fuente: cotizacion.fuente,
  };
}

function mapearComprasPorPedido(
  grupos: Array<{ pedidoCompraId: number | null; _count: { _all: number } }>,
): Map<number, number> {
  const map = new Map<number, number>();
  for (const g of grupos) {
    if (g.pedidoCompraId != null) map.set(g.pedidoCompraId, g._count._all);
  }
  return map;
}

export default async function PedidosCompraPage({ searchParams }: { searchParams: SearchParams }) {
  const [params, session, cotizacion, pedidos, comprasVinculadas] = await Promise.all([
    searchParams,
    auth(),
    getCotizacionParaFecha(new Date()),
    listarPedidosCompra(),
    // Compras reales (EMITIDA/RECIBIDA) por pedido — misma query que la
    // export action re-corre server-side.
    db.compra.groupBy({
      by: ["pedidoCompraId"],
      where: {
        pedidoCompraId: { not: null },
        estado: { in: [CompraEstado.EMITIDA, CompraEstado.RECIBIDA] },
      },
      _count: { _all: true },
    }),
  ]);

  const moneda = resolverMoneda(params.moneda, session?.user.monedaPreferida);
  const tcInfo = buildTcInfo(cotizacion);
  const tc = tcInfo?.valor ?? null;

  // Presets server-side (lección PR-010): la vista filtra sólo el grid; la
  // contagem del header usa todas las filas (paridad FIN-01).
  const vista = resolverVista(params.vista);
  const rows = flattenPedidos(pedidos, mapearComprasPorPedido(comprasVinculadas));
  const rowsVista = filtrarPorVista(rows, vista);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[15px] font-semibold tracking-tight">Pedidos de compra (OC)</h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} pedido{rows.length === 1 ? "" : "s"} · planificación de compras antes de
            la factura.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <MonedaToggle current={moneda} tcInfo={tcInfo} />
          <div className="flex items-center gap-2">
            {VISTAS.map((v) => (
              <Link
                key={v}
                href={buildHref(v, params.moneda)}
                className={buttonVariants({
                  variant: vista === v ? "secondary" : "outline",
                  size: "sm",
                })}
              >
                {VISTA_LABELS[v]}
              </Link>
            ))}
          </div>
          <Link href="/compras/pedidos/nuevo" className={buttonVariants({ variant: "default" })}>
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
            Nuevo pedido
          </Link>
        </div>
      </div>

      <PedidosCompraWorklist
        rows={rowsVista}
        moneda={moneda}
        tc={tc}
        emptyMessage={
          vista === "todas"
            ? "No hay pedidos de compra registrados todavía."
            : "Sin pedidos para la vista seleccionada."
        }
      />
    </div>
  );
}
