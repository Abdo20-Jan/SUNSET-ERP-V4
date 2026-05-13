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

type Proveedor = { id: string; nombre: string };
type Banco = { id: string; label: string };

export function PagosHistorialFilters({
  proveedores,
  cuentasBancarias,
  selectedProveedorId,
  selectedMoneda,
  selectedCuentaBancariaId,
  selectedDesde,
  selectedHasta,
}: {
  proveedores: Proveedor[];
  cuentasBancarias: Banco[];
  selectedProveedorId: string;
  selectedMoneda: string;
  selectedCuentaBancariaId: string;
  selectedDesde: string;
  selectedHasta: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  function updateParam(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams.toString());
    if (value === null || value === "" || value === "all") {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    const qs = next.toString();
    startTransition(() => {
      router.push(qs.length > 0 ? `${pathname}?${qs}` : pathname);
    });
  }

  function onClear() {
    startTransition(() => router.push(pathname));
  }

  const hasFilters =
    selectedProveedorId ||
    selectedMoneda ||
    selectedCuentaBancariaId ||
    selectedDesde ||
    selectedHasta;

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Proveedor</Label>
        <Select
          value={selectedProveedorId || "all"}
          onValueChange={(v) => updateParam("proveedorId", v)}
        >
          <SelectTrigger className="min-w-48">
            <SelectValue placeholder="Todos">
              {(v) =>
                v === "all" || !v ? "Todos" : (proveedores.find((p) => p.id === v)?.nombre ?? "")
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {proveedores.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Moneda</Label>
        <Select value={selectedMoneda || "all"} onValueChange={(v) => updateParam("moneda", v)}>
          <SelectTrigger className="min-w-32">
            <SelectValue placeholder="Todas" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            <SelectItem value="ARS">ARS</SelectItem>
            <SelectItem value="USD">USD</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Banco</Label>
        <Select
          value={selectedCuentaBancariaId || "all"}
          onValueChange={(v) => updateParam("cuentaBancariaId", v)}
        >
          <SelectTrigger className="min-w-44">
            <SelectValue placeholder="Todos">
              {(v) =>
                v === "all" || !v
                  ? "Todos"
                  : (cuentasBancarias.find((c) => c.id === v)?.label ?? "")
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {cuentasBancarias.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Desde</Label>
        <input
          type="date"
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
          value={selectedDesde}
          onChange={(e) => updateParam("desde", e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Hasta</Label>
        <input
          type="date"
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
          value={selectedHasta}
          onChange={(e) => updateParam("hasta", e.target.value)}
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
