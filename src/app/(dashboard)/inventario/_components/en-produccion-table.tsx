"use client";

import { Fragment, useState } from "react";

import { Badge } from "@/components/ui/badge";
import type { EnProduccionFila } from "@/lib/actions/inventario";

function formatDate(d: Date | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

const ESTADO_LABEL: Record<string, string> = {
  ENVIADO: "Enviado",
  CONFIRMADO: "Confirmado",
  PARCIAL: "Parcial",
};

export function EnProduccionTable({ filas }: { filas: EnProduccionFila[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (filas.length === 0) {
    return (
      <div className="rounded-md border p-8 text-center text-sm text-muted-foreground">
        Sin items en producción.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted text-left">
          <tr>
            <th className="px-3 py-2 w-8" />
            <th className="px-3 py-2">Producto</th>
            <th className="px-3 py-2 text-right">En producción</th>
            <th className="px-3 py-2 text-right">Pedida</th>
            <th className="px-3 py-2 text-right">Embarcada</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => {
            const isOpen = expanded.has(f.productoId);
            return (
              <Fragment key={f.productoId}>
                <tr className="border-t">
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => toggle(f.productoId)}
                      className="text-muted-foreground hover:text-foreground"
                      aria-label={isOpen ? "Cerrar" : "Expandir"}
                    >
                      {isOpen ? "▾" : "▸"}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-mono text-xs">{f.codigo}</div>
                    <div>{f.nombre}</div>
                  </td>
                  <td className="px-3 py-2 text-right font-medium">{f.cantidadEnProduccion}</td>
                  <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">
                    {f.cantidadPedida}
                  </td>
                  <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">
                    {f.cantidadEmbarcada}
                  </td>
                </tr>
                {isOpen &&
                  f.detalles.map((d, i) => (
                    <tr key={`${f.productoId}-${d.pedidoId}-${i}`} className="bg-muted/30">
                      <td />
                      <td className="px-3 py-1.5 text-xs" colSpan={4}>
                        <div className="flex flex-wrap items-center gap-3">
                          <a
                            href={`/compras/pedidos/${d.pedidoId}`}
                            className="font-mono text-primary hover:underline"
                          >
                            {d.pedidoNumero}
                          </a>
                          <Badge variant="secondary">{ESTADO_LABEL[d.estado] ?? d.estado}</Badge>
                          <span className="text-muted-foreground">{d.proveedorNombre}</span>
                          <span className="ml-auto tabular-nums">
                            Cant: <strong>{d.cantidad}</strong>
                          </span>
                          <span className="text-muted-foreground">
                            Prevista: {formatDate(d.fechaPrevista)}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
