"use client";

import { useTransition } from "react";

import {
  anularEntregaAction,
  confirmarEntregaAction,
} from "@/lib/actions/entregas";
import type { EntregaEstado } from "@/generated/prisma/client";

export function EntregaActions({
  entregaId,
  estado,
}: {
  entregaId: string;
  estado: EntregaEstado;
}) {
  const [pending, start] = useTransition();

  if (estado === "ANULADA") return null;

  const onConfirmar = () => {
    if (!confirm("Confirmar esta entrega? Generará movimiento de stock + asiento.")) return;
    start(async () => {
      const result = await confirmarEntregaAction(entregaId);
      if (!result.ok) alert(`Error: ${result.error}`);
    });
  };

  const onAnular = () => {
    const ok = confirm(
      estado === "CONFIRMADA"
        ? "Anular entrega CONFIRMADA? Revertirá stock + asiento."
        : "Borrar este borrador de entrega?",
    );
    if (!ok) return;
    start(async () => {
      const result = await anularEntregaAction(entregaId);
      if (!result.ok) alert(`Error: ${result.error}`);
    });
  };

  return (
    <div className="flex gap-2">
      {estado === "BORRADOR" && (
        <button
          type="button"
          onClick={onConfirmar}
          disabled={pending}
          className="rounded-md bg-green-600 px-3 py-1 text-sm text-white hover:bg-green-700 disabled:opacity-50"
        >
          {pending ? "..." : "Confirmar"}
        </button>
      )}
      <button
        type="button"
        onClick={onAnular}
        disabled={pending}
        className="rounded-md border border-red-600 px-3 py-1 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
      >
        {pending ? "..." : estado === "BORRADOR" ? "Borrar" : "Anular"}
      </button>
    </div>
  );
}
