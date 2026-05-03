"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { crearEntregaAction } from "@/lib/actions/entregas";

type Pendiente = {
  itemVentaId: number;
  productoCodigo: string;
  productoNombre: string;
  vendido: number;
  entregado: number;
  pendiente: number;
};

type Deposito = { id: string; nombre: string };

export function NuevaEntregaForm({
  ventaId,
  depositos,
  pendientes,
}: {
  ventaId: string;
  depositos: Deposito[];
  pendientes: Pendiente[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [depositoId, setDepositoId] = useState(depositos[0]?.id ?? "");
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [observacion, setObservacion] = useState("");
  const [cantidades, setCantidades] = useState<Record<number, number>>(
    Object.fromEntries(pendientes.map((p) => [p.itemVentaId, p.pendiente])),
  );
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const items = pendientes
      .map((p) => ({
        itemVentaId: p.itemVentaId,
        cantidad: cantidades[p.itemVentaId] ?? 0,
      }))
      .filter((it) => it.cantidad > 0);

    if (items.length === 0) {
      setError("Debe entregar al menos 1 unidad.");
      return;
    }

    start(async () => {
      const result = await crearEntregaAction({
        ventaId,
        depositoId,
        fecha: new Date(fecha),
        observacion: observacion.trim() || undefined,
        items,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/ventas/${ventaId}/entregas`);
      router.refresh();
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium">Depósito</span>
          <select
            value={depositoId}
            onChange={(e) => setDepositoId(e.target.value)}
            className="mt-1 w-full rounded-md border bg-background px-3 py-2"
            required
          >
            {depositos.map((d) => (
              <option key={d.id} value={d.id}>
                {d.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-medium">Fecha</span>
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className="mt-1 w-full rounded-md border bg-background px-3 py-2"
            required
          />
        </label>
      </div>

      <label className="block">
        <span className="text-sm font-medium">Observación</span>
        <textarea
          value={observacion}
          onChange={(e) => setObservacion(e.target.value)}
          className="mt-1 w-full rounded-md border bg-background px-3 py-2"
          rows={2}
        />
      </label>

      <div>
        <h2 className="mb-2 text-sm font-medium">Items pendientes</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="px-2 py-1">Producto</th>
              <th className="px-2 py-1 text-right">Vendido</th>
              <th className="px-2 py-1 text-right">Entregado</th>
              <th className="px-2 py-1 text-right">Pendiente</th>
              <th className="px-2 py-1 text-right">A entregar</th>
            </tr>
          </thead>
          <tbody>
            {pendientes.map((p) => (
              <tr key={p.itemVentaId} className="border-t">
                <td className="px-2 py-1">
                  <div className="font-mono text-xs">{p.productoCodigo}</div>
                  <div>{p.productoNombre}</div>
                </td>
                <td className="px-2 py-1 text-right">{p.vendido}</td>
                <td className="px-2 py-1 text-right">{p.entregado}</td>
                <td className="px-2 py-1 text-right font-medium">{p.pendiente}</td>
                <td className="px-2 py-1 text-right">
                  <input
                    type="number"
                    min={0}
                    max={p.pendiente}
                    value={cantidades[p.itemVentaId] ?? 0}
                    onChange={(e) =>
                      setCantidades((cur) => ({
                        ...cur,
                        [p.itemVentaId]: Math.max(
                          0,
                          Math.min(p.pendiente, Number(e.target.value)),
                        ),
                      }))
                    }
                    className="w-20 rounded-md border bg-background px-2 py-1 text-right"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {pending ? "Guardando..." : "Crear entrega (BORRADOR)"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-md border px-4 py-2 hover:bg-muted"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
