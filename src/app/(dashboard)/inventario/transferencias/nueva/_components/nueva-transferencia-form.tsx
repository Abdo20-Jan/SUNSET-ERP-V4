"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { crearTransferenciaAction } from "@/lib/actions/transferencias";

type Producto = { id: string; codigo: string; nombre: string; stockActual: number };
type Deposito = { id: string; nombre: string };

export function NuevaTransferenciaForm({
  productos,
  depositos,
}: {
  productos: Producto[];
  depositos: Deposito[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [productoId, setProductoId] = useState(productos[0]?.id ?? "");
  const [origenId, setOrigenId] = useState(depositos[0]?.id ?? "");
  const [destinoId, setDestinoId] = useState(depositos[1]?.id ?? "");
  const [cantidad, setCantidad] = useState(1);
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [observacion, setObservacion] = useState("");
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (origenId === destinoId) {
      setError("El depósito origen y destino deben ser distintos.");
      return;
    }
    start(async () => {
      const result = await crearTransferenciaAction({
        productoId,
        depositoOrigenId: origenId,
        depositoDestinoId: destinoId,
        cantidad,
        fecha: new Date(fecha),
        observacion: observacion.trim() || undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push("/inventario/transferencias");
      router.refresh();
    });
  };

  if (productos.length === 0) {
    return (
      <p className="text-muted-foreground">
        No hay productos con stock disponible.
      </p>
    );
  }
  if (depositos.length < 2) {
    return (
      <p className="text-muted-foreground">
        Se requieren al menos 2 depósitos activos para transferir.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block">
        <span className="text-sm font-medium">Producto</span>
        <select
          value={productoId}
          onChange={(e) => setProductoId(e.target.value)}
          className="mt-1 w-full rounded-md border bg-background px-3 py-2"
          required
        >
          {productos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.codigo} — {p.nombre} (stock total: {p.stockActual})
            </option>
          ))}
        </select>
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium">Origen</span>
          <select
            value={origenId}
            onChange={(e) => setOrigenId(e.target.value)}
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
          <span className="text-sm font-medium">Destino</span>
          <select
            value={destinoId}
            onChange={(e) => setDestinoId(e.target.value)}
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
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium">Cantidad</span>
          <input
            type="number"
            min={1}
            value={cantidad}
            onChange={(e) =>
              setCantidad(Math.max(1, Number.parseInt(e.target.value, 10) || 0))
            }
            className="mt-1 w-full rounded-md border bg-background px-3 py-2"
            required
          />
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

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {pending ? "Guardando..." : "Crear transferencia"}
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
