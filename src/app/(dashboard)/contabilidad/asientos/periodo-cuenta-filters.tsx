"use client";

/**
 * Filtros server-driven por URL de la worklist de asientos (CONT-01 · PR-028):
 * Período (el filtro MÁS usado en contabilidad — OD-07 Q&A 3) + Cuenta
 * (asientos que tocan una cuenta analítica — Q&A 4, single-select; el patrón
 * del selector es `MayorFilters` de /reportes/libro-mayor). Ambos disparan un
 * fetch server-side nuevo (presets de URL, lección PR-010) — no son chips
 * client del grid.
 */

import { useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeftRightIcon } from "@hugeicons/core-free-icons";

import { PERMISOS } from "@/lib/permisos-catalog";
import { CuentaCombobox, type CuentaOption } from "@/components/cuenta-combobox";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useHasPermission } from "@/components/auth/permissions-provider";

import type { PeriodoOption } from "./asientos-presentacion";

type Props = {
  periodos: PeriodoOption[];
  /** Período efectivo (default server-side cuando la URL no trae `?periodo=`). */
  selectedPeriodoId: number | "todos";
  cuentas: CuentaOption[];
  selectedCuentaId: number | null;
};

function periodoLabel(p: PeriodoOption): string {
  if (p.estado === "CERRADO") return `${p.codigo} · Cerrado`;
  return p.codigo;
}

export function PeriodoCuentaFilters({
  periodos,
  selectedPeriodoId,
  cuentas,
  selectedCuentaId,
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

  const labelByValue = new Map<string, string>([["todos", "Todos los períodos"]]);
  for (const p of periodos) {
    labelByValue.set(String(p.id), periodoLabel(p));
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Período</Label>
        <Select value={String(selectedPeriodoId)} onValueChange={(v) => updateParam("periodo", v)}>
          <SelectTrigger className="min-w-44">
            <SelectValue>{(value) => labelByValue.get(value as string) ?? value}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos los períodos</SelectItem>
            {periodos.map((p) => (
              <SelectItem key={p.id} value={String(p.id)}>
                {periodoLabel(p)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex min-w-72 flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Cuenta (asientos que la tocan)</Label>
        <CuentaCombobox
          value={selectedCuentaId}
          onChange={(id) => updateParam("cuentaId", String(id))}
          cuentas={cuentas}
          placeholder="Todas las cuentas"
        />
      </div>

      {selectedCuentaId !== null && (
        <Button variant="ghost" size="sm" onClick={() => updateParam("cuentaId", null)}>
          Quitar cuenta
        </Button>
      )}
    </div>
  );
}

/**
 * Link "Mover de período" con reflejo FE de `ASIENTOS_MOVER` (deshabilitado
 * con tooltip, layout estable — precedente PermissionGate variant="button").
 * El control real sigue siendo `requireAdmin` en las actions del flujo
 * mover-periodo (intocado). Con RBAC OFF el snapshot es undefined ⇒ permitido
 * (cero regresión).
 */
export function MoverPeriodoLink() {
  const puedeMover = useHasPermission(PERMISOS.ASIENTOS_MOVER);

  if (puedeMover) {
    return (
      <Link
        href="/contabilidad/asientos/mover-periodo"
        className={buttonVariants({ variant: "outline" })}
      >
        <HugeiconsIcon icon={ArrowLeftRightIcon} strokeWidth={2} />
        Mover de período
      </Link>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: span wrapper necesario para tooltip sobre control deshabilitado (mismo patrón que PermissionGate variant="button") */}
        <TooltipTrigger render={<span tabIndex={0} className="inline-flex" />}>
          <Button variant="outline" disabled>
            <HugeiconsIcon icon={ArrowLeftRightIcon} strokeWidth={2} />
            Mover de período
          </Button>
        </TooltipTrigger>
        <TooltipContent>Sin permiso (asientos.mover)</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
