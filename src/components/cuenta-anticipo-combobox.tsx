"use client";

import { useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { UnfoldMoreIcon } from "@hugeicons/core-free-icons";

import type { CuentaAnticipoOption } from "@/lib/actions/anticipos-proveedor";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type Props = {
  value: number | null;
  onChange: (id: number) => void;
  cuentas: CuentaAnticipoOption[];
  disabled?: boolean;
};

/**
 * Drilldown de "cuenta de anticipo a proveedor" (decisión #4): navega el
 * subárbol de anticipos (1.1.7.10 bienes / 1.1.6.10 servicios) agrupado por
 * rubro (cuenta padre). La cuenta elegida codifica la clasificación bien/servicio.
 */
export function CuentaAnticipoCombobox({ value, onChange, cuentas, disabled = false }: Props) {
  const [open, setOpen] = useState(false);
  const selected = value != null ? cuentas.find((c) => c.id === value) : null;

  const grupos = useMemo(() => {
    const map = new Map<string, CuentaAnticipoOption[]>();
    for (const c of cuentas) {
      const arr = map.get(c.grupo) ?? [];
      arr.push(c);
      map.set(c.grupo, arr);
    }
    return Array.from(map.entries());
  }, [cuentas]);

  return (
    <Popover open={open} onOpenChange={disabled ? undefined : setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            className="w-full justify-between font-normal"
          />
        }
      >
        <span className={cn("truncate text-left", !selected && "text-muted-foreground")}>
          {selected
            ? `${selected.codigo} — ${selected.nombre}`
            : "Seleccione cuenta de anticipo (bien/servicio)"}
        </span>
        <HugeiconsIcon
          icon={UnfoldMoreIcon}
          strokeWidth={2}
          className="size-4 shrink-0 text-muted-foreground"
        />
      </PopoverTrigger>
      <PopoverContent className="w-(--anchor-width) min-w-80 p-0">
        <Command>
          <CommandInput placeholder="Buscar cuenta por código o nombre…" />
          <CommandList>
            <CommandEmpty>Sin resultados.</CommandEmpty>
            {grupos.map(([grupo, items]) => (
              <CommandGroup key={grupo} heading={grupo}>
                {items.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={`${c.codigo} ${c.nombre} ${grupo}`}
                    onSelect={() => {
                      onChange(c.id);
                      setOpen(false);
                    }}
                  >
                    <span className="font-mono text-xs text-muted-foreground">{c.codigo}</span>
                    <span className="truncate">{c.nombre}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
