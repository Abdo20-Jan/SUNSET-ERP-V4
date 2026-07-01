"use client";

/**
 * PR-023c (CX-06) — Botón [Simular] (read-only). Re-invoca `simularMemoriaAction`
 * sobre los datos ACTUALES (re-preview): sin input editable, sin escenario, sin
 * escritura. Devuelve el resultado a la ventana vía `onResult`.
 */

import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { simularMemoriaAction, type VerMemoriaResult } from "@/lib/actions/comex-despacho-memoria";

export function MemoriaSimular({
  despachoId,
  onResult,
}: {
  despachoId: string;
  onResult: (r: VerMemoriaResult) => void;
}) {
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => start(async () => onResult(await simularMemoriaAction(despachoId)))}
      title="Re-previsualiza la memoria sobre los datos actuales — no graba nada."
    >
      {pending ? "Simulando…" : "Simular"}
    </Button>
  );
}
