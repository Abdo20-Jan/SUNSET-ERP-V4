"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { Moneda, PeriodoEstado } from "@/generated/prisma/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const TIPO_LABELS: Record<string, string> = {
  all: "Todos",
  COBRO: "COBRO",
  PAGO: "PAGO",
  TRANSFERENCIA: "TRANSFERENCIA",
};

export type PeriodoOption = {
  id: number;
  codigo: string;
  estado: PeriodoEstado;
};

export type CuentaBancariaOption = {
  id: string;
  banco: string;
  moneda: Moneda;
  numero: string | null;
};

type Props = {
  periodos: PeriodoOption[];
  cuentas: CuentaBancariaOption[];
  selectedPeriodoId: string;
  selectedCuentaId: string;
  selectedTipo: string;
};

export function MovimientosFilters({
  periodos,
  cuentas,
  selectedPeriodoId,
  selectedCuentaId,
  selectedTipo,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

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

  const onClear = () => {
    startTransition(() => {
      router.push(pathname);
    });
  };

  const hasFilters =
    searchParams.has("periodoId") ||
    searchParams.has("cuentaId") ||
    searchParams.has("tipo");

  const periodoLabel = (v: string) => {
    if (v === "all") return "Todos";
    const p = periodos.find((p) => String(p.id) === v);
    return p ? p.codigo : v;
  };

  const cuentaLabel = (v: string) => {
    if (v === "all") return "Todas";
    const c = cuentas.find((c) => c.id === v);
    return c ? `${c.banco} · ${c.moneda}` : v;
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
        <Label className="text-xs text-muted-foreground">Cuenta bancaria</Label>
        <Select
          value={selectedCuentaId}
          onValueChange={(v) =>
            updateParam("cuentaId", v === "all" ? null : v)
          }
        >
          <SelectTrigger className="min-w-56">
            <SelectValue>{(value) => cuentaLabel(value as string)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            {cuentas.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.banco}
                <span className="ml-2 text-xs text-muted-foreground">
                  {c.moneda} · {c.numero}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Tipo</Label>
        <Select
          value={selectedTipo}
          onValueChange={(v) =>
            updateParam("tipo", v === "all" ? null : v)
          }
        >
          <SelectTrigger className="min-w-44">
            <SelectValue>
              {(value) => TIPO_LABELS[value as string] ?? value}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="COBRO">COBRO</SelectItem>
            <SelectItem value="PAGO">PAGO</SelectItem>
            <SelectItem value="TRANSFERENCIA">TRANSFERENCIA</SelectItem>
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
