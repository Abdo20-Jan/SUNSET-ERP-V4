"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { convertirLeadEnClienteAction } from "@/lib/actions/leads";

export function ConvertirClienteButton({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handle() {
    if (!confirm("¿Convertir este lead en cliente?")) return;
    setError(null);
    start(async () => {
      const r = await convertirLeadEnClienteAction(leadId);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.push(`/maestros/clientes/${r.data.clienteId}`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handle}
        disabled={pending}
        className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {pending ? "Convirtiendo..." : "Convertir a cliente"}
      </button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </div>
  );
}
