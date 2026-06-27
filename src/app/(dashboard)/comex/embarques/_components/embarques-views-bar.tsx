"use client";

/**
 * Barra de vistas + filtro de moneda server-driven (PR-020 / CX-02). Cada control
 * escribe en la URL (`?vista` / `?moneda`) → el server component re-consulta. Las
 * vistas canónicas reconcilian las antiguas tabs; las deshabilitadas (Documentos
 * pendientes / Cancelados) requieren datos inexistentes en Fase 1. Compartible por
 * URL y reproducible por el export auditado. Espelha `AuditoriaFilterBar`.
 */

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { VISTAS } from "@/lib/services/comex-worklist-derivaciones";

type Patch = Record<string, string | null>;
const TODOS = "all";

// Helper PURO de módulo — mantiene baja la complejidad del componente.
function construirQuery(current: URLSearchParams, patch: Patch): string {
  const next = new URLSearchParams(current.toString());
  for (const [key, value] of Object.entries(patch)) {
    if (value) next.set(key, value);
    else next.delete(key);
  }
  return next.toString();
}

export function EmbarquesViewsBar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startNav] = useTransition();

  const vistaActiva = searchParams.get("vista") ?? "todos";
  const monedaActiva = searchParams.get("moneda") ?? TODOS;

  const updateUrl = (patch: Patch) => {
    const qs = construirQuery(searchParams, patch);
    startNav(() => router.push(qs.length > 0 ? `${pathname}?${qs}` : pathname));
  };

  return (
    <div className="flex flex-col gap-3 border-b p-4">
      <div className="flex flex-wrap gap-1">
        {VISTAS.map((v) => (
          <Button
            key={v.id}
            variant={vistaActiva === v.id ? "default" : "outline"}
            size="sm"
            disabled={v.disabled}
            title={v.hint}
            onClick={() => updateUrl({ vista: v.id === "todos" ? null : v.id })}
          >
            {v.label}
          </Button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Select
          value={monedaActiva}
          onValueChange={(v) => updateUrl({ moneda: v === TODOS ? null : v })}
        >
          <SelectTrigger size="sm" className="w-auto min-w-36">
            <SelectValue placeholder="Moneda" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Moneda: todas</SelectItem>
            <SelectItem value="ARS">ARS</SelectItem>
            <SelectItem value="USD">USD</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
