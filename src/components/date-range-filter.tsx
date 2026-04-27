"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function firstOfMonthIso(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .slice(0, 10);
}

function firstOfYearIso(): string {
  const now = new Date();
  return new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
}

export type DateRangeFilterProps = {
  initialDesde: string;
  initialHasta: string;
  /** Si true, "Desde" es opcional (saldo acumulado al "Hasta"). */
  desdeOptional?: boolean;
  /** Si true, oculta el botón "Histórico completo" (sin filtro). */
  hideHistorico?: boolean;
  /** Etiqueta del botón "hoy" — ej: "Saldo al día de hoy" o "Hoy". */
  hoyLabel?: string;
};

export function DateRangeFilter({
  initialDesde,
  initialHasta,
  desdeOptional = false,
  hideHistorico = false,
  hoyLabel = "Hoy",
}: DateRangeFilterProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [desde, setDesde] = useState(initialDesde);
  const [hasta, setHasta] = useState(initialHasta || todayIso());

  function applyFilter(d: string, h: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (d) params.set("desde", d);
    else params.delete("desde");
    if (h) params.set("hasta", h);
    else params.delete("hasta");
    startTransition(() => {
      router.push(`?${params.toString()}`);
    });
  }

  function setHoy() {
    const today = todayIso();
    const newDesde = desdeOptional ? "" : today;
    setDesde(newDesde);
    setHasta(today);
    applyFilter(newDesde, today);
  }

  function setEsteMes() {
    const first = firstOfMonthIso();
    const today = todayIso();
    setDesde(first);
    setHasta(today);
    applyFilter(first, today);
  }

  function setEsteAnio() {
    const first = firstOfYearIso();
    const today = todayIso();
    setDesde(first);
    setHasta(today);
    applyFilter(first, today);
  }

  function setHistorico() {
    setDesde("");
    setHasta("");
    applyFilter("", "");
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="fecha-desde" className="text-xs">
          Desde{desdeOptional ? " (opcional)" : ""}
        </Label>
        <Input
          id="fecha-desde"
          type="date"
          value={desde}
          onChange={(e) => setDesde(e.target.value)}
          className="w-44"
          max={hasta || undefined}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="fecha-hasta" className="text-xs">
          Hasta
        </Label>
        <Input
          id="fecha-hasta"
          type="date"
          value={hasta}
          onChange={(e) => setHasta(e.target.value)}
          className="w-44"
          min={desde || undefined}
        />
      </div>
      <Button
        variant="default"
        disabled={isPending}
        onClick={() => applyFilter(desde, hasta)}
      >
        Aplicar
      </Button>
      <div className="flex flex-wrap gap-1.5">
        <Button variant="outline" size="sm" onClick={setHoy} disabled={isPending}>
          {hoyLabel}
        </Button>
        <Button variant="outline" size="sm" onClick={setEsteMes} disabled={isPending}>
          Mes en curso
        </Button>
        <Button variant="outline" size="sm" onClick={setEsteAnio} disabled={isPending}>
          Año en curso
        </Button>
        {!hideHistorico ? (
          <Button
            variant="outline"
            size="sm"
            onClick={setHistorico}
            disabled={isPending}
          >
            Histórico completo
          </Button>
        ) : null}
      </div>
    </div>
  );
}
