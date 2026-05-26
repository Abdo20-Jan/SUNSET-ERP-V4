"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import type { StockAduaneroFila } from "@/lib/actions/inventario";

// PR 5.1 + 5.2 — pipeline comex/aduanero: producto → contenedor → fase. La fila
// reparte la cantidad viva en cuatro columnas (EN_TRANSITO / EN_ZPA / EN_DF /
// EN_DESPACHO) derivadas de Contenedor.estado + cantidadEnDespacho. Expandir
// muestra los contenedores que aportan el saldo, con su estado y sus counters.

const ESTADO_LABEL: Record<string, string> = {
  EN_TRANSITO: "En tránsito",
  ARRIBADO_PUERTO: "Arribado",
  EN_ZONA_PRIMARIA: "Zona primaria",
  TRASLADO_DEPOSITO_FISCAL: "Traslado a DF",
  EN_DEPOSITO_FISCAL: "En DF",
  AGUARDANDO_INVESTIGACAO: "Investigación",
  DESCONSOLIDADO: "Desconsolidado",
  PARCIALMENTE_DESPACHADO: "Parcial",
};

const cell = (n: number) => (n > 0 ? n : "—");

export function StockAduaneroTable({ filas }: { filas: StockAduaneroFila[] }) {
  if (filas.length === 0) {
    return (
      <div className="rounded-md border px-3 py-8 text-center text-sm text-muted-foreground">
        Sin stock en el pipeline aduanero. Cargá un packing list o desconsolidá un contenedor para
        verlo acá.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted text-left">
          <tr>
            <th className="px-3 py-2">Producto</th>
            <th className="px-3 py-2 text-right">En tránsito</th>
            <th className="px-3 py-2 text-right">En ZPA</th>
            <th className="px-3 py-2 text-right">En DF</th>
            <th className="px-3 py-2 text-right">En despacho</th>
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
        <td className="px-3 py-2 text-right text-muted-foreground">{cell(fila.enTransito)}</td>
        <td className="px-3 py-2 text-right text-muted-foreground">{cell(fila.enZpa)}</td>
        <td className="px-3 py-2 text-right font-medium">{cell(fila.enDf)}</td>
        <td className="px-3 py-2 text-right text-amber-700">{cell(fila.enDespacho)}</td>
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
              {c.cantidadDespachada > 0 ? (
                <span className="ml-2 text-muted-foreground">
                  · {c.cantidadDespachada} despachado
                </span>
              ) : null}
            </td>
            <td className="px-3 py-1.5 text-right text-muted-foreground">{cell(c.enTransito)}</td>
            <td className="px-3 py-1.5 text-right text-muted-foreground">{cell(c.enZpa)}</td>
            <td className="px-3 py-1.5 text-right">{cell(c.enDf)}</td>
            <td className="px-3 py-1.5 text-right text-amber-700">{cell(c.enDespacho)}</td>
          </tr>
        ))}
    </>
  );
}
