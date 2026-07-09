"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { crearLeadAction, editarLeadAction, type LeadInput } from "@/lib/actions/leads";

type Mode = "create" | "edit";

async function callAction(mode: Mode, leadId: string | undefined, input: LeadInput) {
  if (mode === "create") return crearLeadAction(input);
  return editarLeadAction(leadId as string, input);
}

function buildTargetUrl(mode: Mode, leadId: string | undefined, createdId: string): string {
  const id = mode === "create" ? createdId : leadId;
  return `/crm/leads/${id}`;
}

export function useLeadFormSubmit(
  mode: Mode,
  leadId: string | undefined,
  // PR-030 (aditivo): host embedded (FloatingWorkWindow) cierra/refresca en
  // vez de navegar. Sin `onSuccess`, el flujo original queda INTACTO.
  onSuccess?: (id: string) => void,
) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(input: LeadInput) {
    setError(null);
    start(async () => {
      const result = await callAction(mode, leadId, input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (onSuccess) {
        onSuccess(result.data.id);
        router.refresh();
        return;
      }
      router.push(buildTargetUrl(mode, leadId, result.data.id));
      router.refresh();
    });
  }

  return { submit, pending, error };
}
