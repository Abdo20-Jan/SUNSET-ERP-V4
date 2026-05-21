"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import type { StockAduaneroFila } from "@/lib/actions/inventario";

// PR 5.1 — drill-down del stock en depósito fiscal: producto → contenedor →
// estado aduanero. Expandir una fila muestra los contenedores que aportan el
// saldo, con su estado (DESCONSOLIDADO / PARCIALMENTE_DESPACHADO / …) y los
// counters disponible / en despacho / despachado.

const ESTADO_LABEL: Record<string, string> = {
  DESCONSOLIDADO: "Desconsolidado",
  PARCIALMENTE_DESPACHADO: "Parcial",
  TOTALMENTE_DESPACHADO: "Total",
  AGUARDANDO_INVESTIGACAO: "Investigación",
  EN_DEPOSITO_FISCAL: "En DF",
};

export function StockAduaneroTable({ filas }: { filas: StockAduaneroFila[] }) {
  if (filas.length === 0) {
    return (
      <div className="rounded-md border px-3 py-8 text-center text-sm text-muted-foreground">
        Sin stock en depósito fiscal. Desconsolidá un contenedor para verlo acá.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted text-left">
          <tr>
            <th className="px-3 py-2">Producto</th>
            <th className="px-3 py-2 text-right">Disponible</th>
            <th className="px-3 py-2 text-right">En despacho</th>
            <th className="px-3 py-2 text-right">Despachado</th>
            <th className="px-3 py-2 text-right">Contenedores</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((fila) => (
            <ProductoRow key={fila.productoId} fila={fila} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProductoRow({ fila }: { fila: StockAduaneroFila }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <tr className="cursor-pointer border-t hover:bg-muted/40" onClick={() => setOpen((v) => !v)}>
        <td className="px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">{open ? "▾" : "▸"}</span>
            <span>
              <span className="block font-mono text-xs">{fila.codigo}</span>
              <span>{fila.nombre}</span>
            </span>
          </div>
        </td>
        <td className="px-3 py-2 text-right font-medium">{fila.totalDisponible}</td>
        <td className="px-3 py-2 text-right text-amber-700">{fila.totalEnDespacho || "—"}</td>
        <td className="px-3 py-2 text-right text-muted-foreground">
          {fila.totalDespachada || "—"}
        </td>
        <td className="px-3 py-2 text-right text-muted-foreground">{fila.contenedores.length}</td>
      </tr>
      {open &&
        fila.contenedores.map((c) => (
          <tr key={c.contenedorId} className="border-t bg-muted/20 text-xs">
            <td className="py-1.5 pl-9 pr-3">
              <span className="font-mono">{c.numeroContenedor}</span>
              <Badge
                variant={c.estado === "PARCIALMENTE_DESPACHADO" ? "secondary" : "outline"}
                className="ml-2"
              >
                {ESTADO_LABEL[c.estado] ?? c.estado}
              </Badge>
              {c.depositoFiscalNombre ? (
                <span className="ml-2 text-muted-foreground">· {c.depositoFiscalNombre}</span>
              ) : null}
            </td>
            <td className="px-3 py-1.5 text-right">{c.cantidadDisponible}</td>
            <td className="px-3 py-1.5 text-right text-amber-700">{c.cantidadEnDespacho || "—"}</td>
            <td className="px-3 py-1.5 text-right text-muted-foreground">
              {c.cantidadDespachada || "—"}
            </td>
            <td className="px-3 py-1.5" />
          </tr>
        ))}
    </>
  );
}
