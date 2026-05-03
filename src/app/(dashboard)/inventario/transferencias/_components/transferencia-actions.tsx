"use client";

import { useTransition } from "react";

import { anularTransferenciaAction } from "@/lib/actions/transferencias";
import type { TransferenciaEstado } from "@/generated/prisma/client";

export function TransferenciaActions({
  transferenciaId,
  estado,
}: {
  transferenciaId: string;
  estado: TransferenciaEstado;
}) {
  const [pending, start] = useTransition();
  if (estado === "ANULADA") return null;

  const onAnular = () => {
    if (
      !confirm(
        "Anular esta transferencia? Restaurará el stock al depósito origen.",
      )
    ) {
      return;
    }
    start(async () => {
      const result = await anularTransferenciaAction(transferenciaId);
      if (!result.ok) alert(`Error: ${result.error}`);
    });
  };

  return (
    <button
      type="button"
      onClick={onAnular}
      disabled={pending}
      className="rounded-md border border-red-600 px-3 py-1 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
    >
      {pending ? "..." : "Anular"}
    </button>
  );
}
