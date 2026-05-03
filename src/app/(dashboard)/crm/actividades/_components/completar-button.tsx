"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { completarActividadAction } from "@/lib/actions/actividades";

export function CompletarButton({ actividadId }: { actividadId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handle() {
    setError(null);
    start(async () => {
      const r = await completarActividadAction(actividadId);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handle}
        disabled={pending}
        className="rounded-md border px-3 py-1 text-xs hover:bg-muted disabled:opacity-50"
      >
        {pending ? "..." : "✓ Completar"}
      </button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </div>
  );
}
