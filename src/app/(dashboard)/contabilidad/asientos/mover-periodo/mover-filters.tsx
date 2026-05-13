"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

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

import type { PeriodoOption } from "./mover-form";

type Props = {
  periodos: PeriodoOption[];
  selectedPeriodoOrigenId: number | null;
  selectedEstado: string;
  query: string;
};

export function MoverPeriodoFilters({
  periodos,
  selectedPeriodoOrigenId,
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- prop-sync controlled input
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
    searchParams.has("periodoOrigenId") || searchParams.has("estado") || searchParams.has("q");

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Período origen</Label>
        <Select
          value={selectedPeriodoOrigenId ? String(selectedPeriodoOrigenId) : "none"}
          onValueChange={(v) => updateParam("periodoOrigenId", v === "none" ? null : v)}
        >
          <SelectTrigger className="min-w-56">
            <SelectValue>
              {(value) => {
                if (!value || value === "none") return "— Seleccionar —";
                const p = periodos.find((x) => String(x.id) === value);
                return p ? `${p.codigo} · ${p.nombre} (${p.estado})` : (value as string);
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">— Seleccionar —</SelectItem>
            {periodos.map((p) => (
              <SelectItem key={p.id} value={String(p.id)}>
                {p.codigo} · {p.nombre} ({p.estado})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Estado</Label>
        <Select
          value={selectedEstado}
          onValueChange={(v) => updateParam("estado", v === "all" ? null : v)}
        >
          <SelectTrigger className="min-w-40">
            <SelectValue>
              {(value) => {
                const v = value as string;
                if (v === "all" || !v) return "Todos (no anulados)";
                return v;
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos (no anulados)</SelectItem>
            <SelectItem value="BORRADOR">BORRADOR</SelectItem>
            <SelectItem value="CONTABILIZADO">CONTABILIZADO</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-1 flex-col gap-1.5 min-w-60">
        <Label htmlFor="mover-search" className="text-xs text-muted-foreground">
          Buscar por descripción
        </Label>
        <Input
          id="mover-search"
          value={qDraft}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Ej: factura 1234"
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
