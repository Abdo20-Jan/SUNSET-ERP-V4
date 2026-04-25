"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { PeriodoEstado } from "@/generated/prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ESTADO_LABELS: Record<string, string> = {
  all: "Todos",
  BORRADOR: "BORRADOR",
  CONTABILIZADO: "CONTABILIZADO",
  ANULADO: "ANULADO",
};

export type PeriodoOption = {
  id: number;
  codigo: string;
  estado: PeriodoEstado;
};

type Props = {
  periodos: PeriodoOption[];
  selectedPeriodoId: string;
  selectedEstado: string;
  query: string;
};

export function AsientosFilters({
  periodos,
  selectedPeriodoId,
  selectedEstado,
  query,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const [qDraft, setQDraft] = useState(query);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setQDraft(query);
  }, [query]);

  const push = (next: URLSearchParams) => {
    const qs = next.toString();
    startTransition(() => {
      router.push(qs.length > 0 ? `${pathname}?${qs}` : pathname);
    });
  };

  const updateParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value === null || value.length === 0) {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    push(next);
  };

  const onQueryChange = (value: string) => {
    setQDraft(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      updateParam("q", value.trim().length > 0 ? value.trim() : null);
    }, 300);
  };

  const onClear = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setQDraft("");
    startTransition(() => {
      router.push(pathname);
    });
  };

  const hasFilters =
    searchParams.has("periodoId") ||
    searchParams.has("estado") ||
    searchParams.has("q");

  const periodoLabel = (v: string) => {
    if (v === "all") return "Todos";
    const p = periodos.find((p) => String(p.id) === v);
    return p ? p.codigo : v;
  };

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Período</Label>
        <Select
          value={selectedPeriodoId}
          onValueChange={(v) => updateParam("periodoId", v)}
        >
          <SelectTrigger className="min-w-40">
            <SelectValue>{(value) => periodoLabel(value as string)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {periodos.map((p) => (
              <SelectItem key={p.id} value={String(p.id)}>
                {p.codigo}
                <span className="ml-2 text-xs text-muted-foreground">
                  {p.estado === "ABIERTO" ? "abierto" : "cerrado"}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Estado</Label>
        <Select
          value={selectedEstado}
          onValueChange={(v) =>
            updateParam("estado", v === "all" ? null : v)
          }
        >
          <SelectTrigger className="min-w-40">
            <SelectValue>
              {(value) => ESTADO_LABELS[value as string] ?? value}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="BORRADOR">BORRADOR</SelectItem>
            <SelectItem value="CONTABILIZADO">CONTABILIZADO</SelectItem>
            <SelectItem value="ANULADO">ANULADO</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-1 flex-col gap-1.5 min-w-60">
        <Label htmlFor="asientos-search" className="text-xs text-muted-foreground">
          Buscar por descripción
        </Label>
        <Input
          id="asientos-search"
          value={qDraft}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Ej: depreciación"
        />
      </div>

      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={onClear}>
          Limpiar filtros
        </Button>
      )}
    </div>
  );
}
