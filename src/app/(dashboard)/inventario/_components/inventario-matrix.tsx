"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";

type Deposito = { id: string; nombre: string };

type StockPorDep = {
  depositoId: string;
  cantidadFisica: number;
  cantidadReservada: number;
};

type Producto = {
  id: string;
  codigo: string;
  nombre: string;
  stockActual: number;
  stockPorDeposito: StockPorDep[];
};

const ROW_HEIGHT = 56;
const VIRTUALIZE_THRESHOLD = 100;
const VIEWPORT_HEIGHT = 640;

export function InventarioMatrix({
  productos,
  depositos,
}: {
  productos: Producto[];
  depositos: Deposito[];
}) {
  const colspan = 2 + depositos.length * 3;

  if (productos.length === 0) {
    return (
      <div className="rounded-md border">
        <table className="w-full text-sm">
          <Thead depositos={depositos} />
          <tbody>
            <tr>
              <td colSpan={colspan} className="px-3 py-8 text-center text-muted-foreground">
                Sin resultados.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  if (productos.length < VIRTUALIZE_THRESHOLD) {
    return (
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <Thead depositos={depositos} />
          <tbody>
            {productos.map((p) => (
              <ProductoRow key={p.id} producto={p} depositos={depositos} />
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return <VirtualMatrix productos={productos} depositos={depositos} colspan={colspan} />;
}

function VirtualMatrix({
  productos,
  depositos,
  colspan,
}: {
  productos: Producto[];
  depositos: Deposito[];
  colspan: number;
}) {
  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: productos.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  const totalSize = rowVirtualizer.getTotalSize();
  const items = rowVirtualizer.getVirtualItems();
  const offsetTop = items[0]?.start ?? 0;
  const offsetBottom = totalSize - (items.at(-1)?.end ?? 0);

  return (
    <div
      ref={parentRef}
      className="rounded-md border"
      style={{ height: VIEWPORT_HEIGHT, overflow: "auto" }}
    >
      <table className="w-full text-sm">
        <Thead depositos={depositos} sticky />
        <tbody>
          {offsetTop > 0 && (
            <tr>
              <td colSpan={colspan} style={{ height: offsetTop }} />
            </tr>
          )}
          {items.map((virtualRow) => {
            const p = productos[virtualRow.index];
            return (
              <ProductoRow
                key={p.id}
                producto={p}
                depositos={depositos}
                style={{ height: ROW_HEIGHT }}
              />
            );
          })}
          {offsetBottom > 0 && (
            <tr>
              <td colSpan={colspan} style={{ height: offsetBottom }} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Thead({
  depositos,
  sticky = false,
}: {
  depositos: Deposito[];
  sticky?: boolean;
}) {
  return (
    <thead className={`bg-muted text-left ${sticky ? "sticky top-0 z-10" : ""}`}>
      <tr>
        <th className="px-3 py-2">Producto</th>
        <th className="px-3 py-2 text-right">Total</th>
        {depositos.map((d) => (
          <th key={d.id} className="px-3 py-2 text-right" colSpan={3}>
            {d.nombre}
          </th>
        ))}
      </tr>
      <tr className="text-xs text-muted-foreground">
        <th className="px-3 py-1" />
        <th className="px-3 py-1" />
        {depositos.map((d) => (
          <SubHeader key={d.id} />
        ))}
      </tr>
    </thead>
  );
}

function SubHeader() {
  return (
    <>
      <th className="px-3 py-1 text-right font-normal">Físico</th>
      <th className="px-3 py-1 text-right font-normal">Reservado</th>
      <th className="px-3 py-1 text-right font-normal">Disponible</th>
    </>
  );
}

function ProductoRow({
  producto,
  depositos,
  style,
}: {
  producto: Producto;
  depositos: Deposito[];
  style?: React.CSSProperties;
}) {
  const byDep = new Map(producto.stockPorDeposito.map((s) => [s.depositoId, s]));
  return (
    <tr className="border-t" style={style}>
      <td className="px-3 py-2">
        <div className="font-mono text-xs">{producto.codigo}</div>
        <div>{producto.nombre}</div>
      </td>
      <td className="px-3 py-2 text-right font-medium">{producto.stockActual}</td>
      {depositos.map((d) => {
        const s = byDep.get(d.id);
        const fisica = s?.cantidadFisica ?? 0;
        const reservada = s?.cantidadReservada ?? 0;
        return (
          <Cells key={d.id} fisica={fisica} reservada={reservada} disponible={fisica - reservada} />
        );
      })}
    </tr>
  );
}

function Cells({
  fisica,
  reservada,
  disponible,
}: {
  fisica: number;
  reservada: number;
  disponible: number;
}) {
  return (
    <>
      <td className="px-3 py-2 text-right">{fisica}</td>
      <td className="px-3 py-2 text-right text-amber-700">{reservada || "—"}</td>
      <td className="px-3 py-2 text-right font-medium">{disponible}</td>
    </>
  );
}
