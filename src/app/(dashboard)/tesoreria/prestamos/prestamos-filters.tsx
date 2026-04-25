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

const CLASIFICACION_LABELS: Record<string, string> = {
  all: "Todas",
  CORTO_PLAZO: "Corto plazo",
  LARGO_PLAZO: "Largo plazo",
};

const MONEDA_LABELS: Record<string, string> = {
  all: "Todas",
  ARS: "ARS",
  USD: "USD",
};

const ESTADO_LABELS: Record<string, string> = {
  all: "Todos",
  CONTABILIZADO: "Contabilizado",
  ANULADO: "Anulado",
  SIN_ASIENTO: "Sin asiento",
};

type Props = {
  selectedClasificacion: string;
  selectedMoneda: string;
  selectedEstado: string;
};

export function PrestamosFilters({
  selectedClasificacion,
  selectedMoneda,
  selectedEstado,
}: Props) {
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
    searchParams.has("clasificacion") ||
    searchParams.has("moneda") ||
    searchParams.has("estado");

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Clasificación</Label>
        <Select
          value={selectedClasificacion}
          onValueChange={(v) => updateParam("clasificacion", v)}
        >
          <SelectTrigger className="min-w-40">
            <SelectValue>
              {(value) =>
                CLASIFICACION_LABELS[value as string] ?? (value as string)
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            <SelectItem value="CORTO_PLAZO">Corto plazo</SelectItem>
            <SelectItem value="LARGO_PLAZO">Largo plazo</SelectItem>
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
            <SelectItem value="CONTABILIZADO">Contabilizado</SelectItem>
            <SelectItem value="ANULADO">Anulado</SelectItem>
            <SelectItem value="SIN_ASIENTO">Sin asiento</SelectItem>
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
