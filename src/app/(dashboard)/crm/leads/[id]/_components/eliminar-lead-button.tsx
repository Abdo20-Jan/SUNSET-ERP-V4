"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { eliminarLeadAction } from "@/lib/actions/leads";

export function EliminarLeadButton({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handle() {
    if (!confirm("¿Eliminar este lead? Esta acción es irreversible.")) return;
    setError(null);
    start(async () => {
      const r = await eliminarLeadAction(leadId);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.push("/crm/leads");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handle}
        disabled={pending}
        className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
      >
        {pending ? "Eliminando..." : "Eliminar"}
      </button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </div>
  );
}
