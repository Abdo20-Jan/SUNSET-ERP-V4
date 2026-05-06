"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { actualizarModoRetroactivoAction } from "@/lib/actions/perfil";

export function ModoRetroactivoForm({ initial }: { initial: boolean }) {
  const router = useRouter();
  const [activo, setActivo] = useState<boolean>(initial);
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  const toggle = () => {
    const next = !activo;
    setActivo(next);
    setFeedback(null);
    startTransition(async () => {
      const result = await actualizarModoRetroactivoAction({ modoRetroactivo: next });
      if (!result.ok) {
        setFeedback(`Error: ${result.error}`);
        setActivo(!next);
        return;
      }
      setFeedback(next ? "Activado · las fechas no se autocompletan." : "Desactivado.");
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-3 max-w-md">
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Modo retroactivo</legend>
        <p className="text-xs text-muted-foreground">
          Cuando está activo, los formularios (Compra, Gasto, Tesorería, Despacho, VEP, cierre de
          embarque) no rellenan la fecha con hoy. Útil al cargar facturas históricas en lote para no
          contaminar la fecha del documento físico.
        </p>
        <button
          type="button"
          onClick={toggle}
          disabled={isPending}
          aria-pressed={activo}
          className={`inline-flex w-fit items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
            activo
              ? "border-amber-300 bg-amber-100 text-amber-900 hover:bg-amber-200"
              : "border-border bg-background text-muted-foreground hover:bg-muted"
          } ${isPending ? "opacity-60" : ""}`}
        >
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              activo ? "bg-amber-600" : "bg-muted-foreground/40"
            }`}
          />
          {activo ? "Activo" : "Inactivo"}
        </button>
      </fieldset>
      {feedback ? <span className="text-xs text-muted-foreground">{feedback}</span> : null}
    </div>
  );
}
