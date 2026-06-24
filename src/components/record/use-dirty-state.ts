"use client";

import { type RefObject, useEffect, useRef } from "react";

/*
 * useDirtyState (PR-004) — espelha um flag booleano de "mudanças não salvas" num
 * `ref` sempre atualizado, para que gates de fechamento e handlers de eventos
 * (ESC/clique-fora da FloatingWorkWindow) leiam o valor mais recente SEM stale
 * closure. No piloto o `isDirty` vem do `react-hook-form formState.isDirty`; o
 * hook também serve a consumidores sem RHF que já calculem o seu próprio dirty.
 */
export function useDirtyState(isDirty: boolean): {
  isDirty: boolean;
  isDirtyRef: RefObject<boolean>;
} {
  const isDirtyRef = useRef(isDirty);
  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);
  return { isDirty, isDirtyRef };
}
