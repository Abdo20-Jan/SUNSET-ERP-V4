"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  cerrarGanadaAction,
  cerrarPerdidaAction,
} from "@/lib/actions/oportunidades";

export function CerrarButtons({ opId }: { opId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handle(resultado: "GANADA" | "PERDIDA") {
    const action =
      resultado === "GANADA" ? cerrarGanadaAction : cerrarPerdidaAction;
    const label = resultado === "GANADA" ? "ganada" : "perdida";
    if (!confirm(`¿Cerrar oportunidad como ${label}?`)) return;
    setError(null);
    start(async () => {
      const r = await action(opId);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => handle("GANADA")}
          disabled={pending}
          className="rounded-md bg-green-600 px-3 py-1.5 text-sm text-white hover:bg-green-700 disabled:opacity-50"
        >
          Cerrar ganada
        </button>
        <button
          type="button"
          onClick={() => handle("PERDIDA")}
          disabled={pending}
          className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          Cerrar perdida
        </button>
      </div>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </div>
  );
}
