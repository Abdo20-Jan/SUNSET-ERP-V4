"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { moverStageAction } from "@/lib/actions/oportunidades";

type StageOption = { id: string; nombre: string };

export function MoverStageSelect({
  opId,
  stageActual,
  stages,
}: {
  opId: string;
  stageActual: string;
  stages: StageOption[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newStage = e.target.value;
    if (!newStage || newStage === stageActual) return;
    setError(null);
    start(async () => {
      const r = await moverStageAction(opId, newStage);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <label className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Mover a stage:</span>
        <select
          defaultValue={stageActual}
          onChange={handleChange}
          disabled={pending}
          className="rounded-md border px-3 py-1.5 disabled:opacity-50"
        >
          {stages.map((s) => (
            <option key={s.id} value={s.id}>{s.nombre}</option>
          ))}
        </select>
      </label>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </div>
  );
}
