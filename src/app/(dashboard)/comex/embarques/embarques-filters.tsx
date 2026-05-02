"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
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
  BORRADOR: "Borrador",
  EN_TRANSITO: "En tránsito",
  EN_PUERTO: "En puerto",
  EN_ADUANA: "En aduana",
  DESPACHADO: "Despachado",
  EN_DEPOSITO: "En depósito",
  CERRADO: "Cerrado",
};

const MONEDA_LABELS: Record<string, string> = {
  all: "Todas",
  ARS: "ARS",
  USD: "USD",
};

type Props = {
  selectedEstado: string;
  selectedMoneda: string;
};

export function EmbarquesFilters({ selectedEstado, selectedMoneda }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const updateParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value === null || value === "all" || value.length === 0) {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    next.delete("page");
    const qs = next.toString();
    startTransition(() => {
      router.push(qs.length > 0 ? `${pathname}?${qs}` : pathname);
    });
  };

  const onClear = () => {
    startTransition(() => {
      router.push(pathname);
    });
  };

  const hasFilters =
    searchParams.has("estado") || searchParams.has("moneda");

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Estado</Label>
        <Select
          value={selectedEstado}
          onValueChange={(v) => updateParam("estado", v)}
        >
          <SelectTrigger className="min-w-44">
            <SelectValue>
              {(value) => ESTADO_LABELS[value as string] ?? (value as string)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="BORRADOR">Borrador</SelectItem>
            <SelectItem value="EN_TRANSITO">En tránsito</SelectItem>
            <SelectItem value="EN_PUERTO">En puerto</SelectItem>
            <SelectItem value="EN_ADUANA">En aduana</SelectItem>
            <SelectItem value="DESPACHADO">Despachado</SelectItem>
            <SelectItem value="EN_DEPOSITO">En depósito</SelectItem>
            <SelectItem value="CERRADO">Cerrado</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Moneda</Label>
        <Select
          value={selectedMoneda}
          onValueChange={(v) => updateParam("moneda", v)}
        >
          <SelectTrigger className="min-w-32">
            <SelectValue>
              {(value) => MONEDA_LABELS[value as string] ?? (value as string)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            <SelectItem value="ARS">ARS</SelectItem>
            <SelectItem value="USD">USD</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={onClear}>
          Limpiar filtros
        </Button>
      )}
    </div>
  );
}
