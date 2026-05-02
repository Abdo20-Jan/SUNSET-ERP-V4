"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function BalanceFechaFilter({
  initialDesde,
  initialHasta,
}: {
  initialDesde: string;
  initialHasta: string;
}) {
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
    setDesde("");
    setHasta(today);
    applyFilter("", today);
  }

  function setEsteMes() {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1)
      .toISOString()
      .slice(0, 10);
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
          Desde (opcional)
        </Label>
        <DatePicker
          id="fecha-desde"
          value={desde}
          onChange={setDesde}
          max={hasta || undefined}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="fecha-hasta" className="text-xs">
          Hasta
        </Label>
        <DatePicker
          id="fecha-hasta"
          value={hasta}
          onChange={setHasta}
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
      <div className="flex gap-1.5">
        <Button variant="outline" size="sm" onClick={setHoy} disabled={isPending}>
          Saldo al día de hoy
        </Button>
        <Button variant="outline" size="sm" onClick={setEsteMes} disabled={isPending}>
          Mes en curso
        </Button>
        <Button variant="outline" size="sm" onClick={setHistorico} disabled={isPending}>
          Histórico completo
        </Button>
      </div>
    </div>
  );
}
