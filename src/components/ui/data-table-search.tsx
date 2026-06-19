"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { SearchIcon } from "@hugeicons/core-free-icons";

import { Input } from "@/components/ui/input";

/**
 * Búsqueda server-side con debounce (300ms) que escribe el término en la URL
 * (`paramName`, default "q") y resetea `page`. Generaliza el patrón de
 * `asientos-filters`: el input es controlado y se sincroniza con `initialValue`
 * (la URL es la fuente de verdad) cuando navega hacia atrás/adelante.
 */
export function DataTableSearch({
  paramName = "q",
  placeholder,
  initialValue = "",
}: {
  paramName?: string;
  placeholder?: string;
  initialValue?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const [qDraft, setQDraft] = useState(initialValue);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // TODO(fase-5): refatorar pra `key={initialValue}` ou `useState` lazy com ref-based comparison.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- prop-sync de input controlled com URL state
    setQDraft(initialValue);
  }, [initialValue]);

  const updateParam = (value: string | null) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value === null || value.length === 0) {
      next.delete(paramName);
    } else {
      next.set(paramName, value);
    }
    next.delete("page");
    const qs = next.toString();
    startTransition(() => {
      router.push(qs.length > 0 ? `${pathname}?${qs}` : pathname);
    });
  };

  const onQueryChange = (value: string) => {
    setQDraft(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      updateParam(value.trim().length > 0 ? value.trim() : null);
    }, 300);
  };

  return (
    <div className="relative flex-1">
      <HugeiconsIcon
        icon={SearchIcon}
        strokeWidth={2}
        className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        value={qDraft}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder={placeholder}
        className="pl-9"
      />
    </div>
  );
}
