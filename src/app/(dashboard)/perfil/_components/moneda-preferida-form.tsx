"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { actualizarMonedaPreferidaAction } from "@/lib/actions/perfil";

type Moneda = "ARS" | "USD";

export function MonedaPreferidaForm({ initial }: { initial: Moneda }) {
  const router = useRouter();
  const [moneda, setMoneda] = useState<Moneda>(initial);
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  const dirty = moneda !== initial;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    startTransition(async () => {
      const result = await actualizarMonedaPreferidaAction({
        monedaPreferida: moneda,
      });
      if (!result.ok) {
        setFeedback(`Error: ${result.error}`);
        return;
      }
      setFeedback(`Guardado · default ahora es ${result.data.monedaPreferida}.`);
      router.refresh();
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 max-w-md">
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Moneda por defecto</legend>
        <p className="text-xs text-muted-foreground">
          Aplica a Balance General y Estado de Resultados cuando no especificás moneda en la URL.
        </p>
        <div className="inline-flex rounded-md border bg-muted/30 p-0.5 w-fit">
          {(["ARS", "USD"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMoneda(m)}
              disabled={isPending}
              className={`rounded-sm px-3 py-1 text-xs font-medium transition-colors ${
                moneda === m
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={!dirty || isPending}
          className="rounded-md bg-primary px-3 py-1 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          {isPending ? "Guardando..." : "Guardar"}
        </button>
        {feedback ? <span className="text-xs text-muted-foreground">{feedback}</span> : null}
      </div>
    </form>
  );
}
