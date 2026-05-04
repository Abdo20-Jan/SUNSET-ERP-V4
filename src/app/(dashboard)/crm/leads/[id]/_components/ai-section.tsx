"use client";

import { useState, useTransition } from "react";

import {
  recalcularScoringLeadAction,
  resumirLeadAction,
} from "@/lib/actions/crm-ai";

type Resumen = { resumen: string; proximaAccion: string };

export function AiSection({ leadId }: { leadId: string }) {
  const [pending, start] = useTransition();
  const [scoring, startScoring] = useTransition();
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const [scoreError, setScoreError] = useState<string | null>(null);

  function handleResumir() {
    setError(null);
    setResumen(null);
    start(async () => {
      const r = await resumirLeadAction(leadId);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setResumen(r.data);
    });
  }

  function handleRecalcularScore() {
    setScoreError(null);
    setScore(null);
    startScoring(async () => {
      const r = await recalcularScoringLeadAction(leadId);
      if (!r.ok) {
        setScoreError(r.error);
        return;
      }
      setScore(r.data.score);
    });
  }

  return (
    <section className="space-y-3 rounded-md border bg-muted/30 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-medium">Asistente IA</h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleResumir}
            disabled={pending}
            className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {pending ? "Pensando..." : "Resumir con IA"}
          </button>
          <button
            type="button"
            onClick={handleRecalcularScore}
            disabled={scoring}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
          >
            {scoring ? "Calculando..." : "Recalcular score"}
          </button>
        </div>
      </header>

      {error && <p className="text-sm text-red-700">{error}</p>}
      {scoreError && <p className="text-sm text-red-700">{scoreError}</p>}

      {score !== null && (
        <p className="text-sm">
          Score recalculado: <span className="font-medium">{score}</span> puntos.
        </p>
      )}

      {resumen && (
        <div className="space-y-2 rounded-md border bg-background p-3 text-sm">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Resumen
            </div>
            <p className="mt-1">{resumen.resumen}</p>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Próxima acción
            </div>
            <p className="mt-1">{resumen.proximaAccion}</p>
          </div>
        </div>
      )}
    </section>
  );
}
