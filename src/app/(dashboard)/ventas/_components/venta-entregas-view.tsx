import Link from "next/link";

import type { listarEntregasDeVenta } from "@/lib/actions/entregas";
import { fmtDate } from "@/lib/format";
import type { VentaDetalle } from "@/lib/actions/ventas";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";

import { EntregaActions } from "../[id]/entregas/_components/entrega-actions";

type Entregas = Awaited<ReturnType<typeof listarEntregasDeVenta>>;

type Props = {
  ventaId: string;
  numero: string;
  estado: VentaDetalle["estado"];
  entregas: Entregas;
};

// Tab "Entregas" del detalle de venta: remitos de la venta + alta de remito.
// Reemplaza la antigua ruta órfã /ventas/[id]/entregas (que tenía layout propio
// con container/text-2xl). Reusa EntregaActions.
export function VentaEntregasView({ ventaId, numero, estado, entregas }: Props) {
  const confirmadas = entregas.filter((e) => e.estado === "CONFIRMADA").length;
  const borradores = entregas.filter((e) => e.estado === "BORRADOR").length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {entregas.length} remito{entregas.length === 1 ? "" : "s"}
          {borradores > 0 ? ` · ${borradores} borrador` : ""}
          {confirmadas > 0 ? ` · ${confirmadas} confirmado${confirmadas === 1 ? "" : "s"}` : ""}
        </p>
        {estado === "EMITIDA" && (
          <Link
            href={`/ventas/${ventaId}/entregas/nueva`}
            className={buttonVariants({ variant: "default", size: "sm" })}
          >
            Nueva entrega
          </Link>
        )}
      </div>

      {entregas.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Aún no hay remitos para la venta {numero}. Usá “Nueva entrega” para registrar un
            despacho (total o parcial).
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {entregas.map((e) => (
            <Card key={e.id}>
              <CardContent className="flex items-start justify-between gap-4">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{e.numero}</span>
                    <StatusBadge estado={e.estado} />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {e.deposito.nombre} · {fmtDate(e.fecha)}
                  </p>
                  {e.observacion && (
                    <p className="text-sm text-muted-foreground">{e.observacion}</p>
                  )}
                  <ul className="mt-1 space-y-1 text-sm">
                    {e.items.map((it) => (
                      <li key={it.id}>
                        {it.cantidad} ×{" "}
                        <span className="font-mono text-xs">{it.itemVenta.producto.codigo}</span> —{" "}
                        {it.itemVenta.producto.nombre}
                      </li>
                    ))}
                  </ul>
                </div>
                <EntregaActions entregaId={e.id} numero={e.numero} estado={e.estado} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
