"use client";

/**
 * Polish read-only (PR-022d): "busca rápida" del Cockpit Comex.
 *
 * Filtra in-place las filas YA cargadas de los bloques de pendencias (sin nueva
 * consulta, sin tocar la URL → NO la reproduce la exportación, que sólo refleja
 * los filtros de servidor). Progressive enhancement: alterna `hidden` sobre las
 * filas marcadas con `data-cockpit-row` / `data-busca` en `cockpit-bloque.tsx`.
 * 100% client, read-only; sin JS las filas se ven todas (sin regresión).
 */

import { useState } from "react";

import { Input } from "@/components/ui/input";

function filtrarFilas(q: string): void {
  const term = q.trim().toLowerCase();
  document.querySelectorAll<HTMLElement>("[data-cockpit-row]").forEach((fila) => {
    const hay = fila.dataset.busca ?? "";
    fila.hidden = term.length > 0 && !hay.includes(term);
  });
}

export function CockpitBuscaRapida() {
  const [q, setQ] = useState("");

  return (
    <Input
      type="search"
      value={q}
      onChange={(e) => {
        setQ(e.target.value);
        filtrarFilas(e.target.value);
      }}
      placeholder="Buscar en pendencias…"
      aria-label="Búsqueda rápida en pendencias"
      className="h-8 w-full sm:w-52"
    />
  );
}
