"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { PeriodoEstado } from "@/generated/prisma/client";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type PeriodoOption = {
  id: number;
  codigo: string;
  estado: PeriodoEstado;
};

type Props = {
  periodos: PeriodoOption[];
  selectedPeriodoId: string;
};

export function BalanceFilters({ periodos, selectedPeriodoId }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const onChange = (value: string | null) => {
    const next = new URLSearchParams(searchParams.toString());
    if (!value || value.length === 0) {
      next.delete("periodoId");
    } else {
      next.set("periodoId", value);
    }
    const qs = next.toString();
    startTransition(() => {
      router.push(qs.length > 0 ? `${pathname}?${qs}` : pathname);
    });
  };

  const periodoLabel = (v: string) => {
    const p = periodos.find((p) => String(p.id) === v);
    return p ? p.codigo : v;
  };

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Período</Label>
        <Select value={selectedPeriodoId} onValueChange={onChange}>
          <SelectTrigger className="min-w-40">
            <SelectValue>{(value) => periodoLabel(value as string)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
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
    </div>
  );
}
