"use client";

import { useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { UnfoldMoreIcon } from "@hugeicons/core-free-icons";

import type { CategoriaCompraOption } from "@/lib/actions/compras";
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
  categorias: CategoriaCompraOption[];
  disabled?: boolean;
};

/**
 * Drilldown de "categoría de compra/gasto" (E18): navega el plan de cuentas
 * agrupado por rubro (cuenta padre). Marca con un badge las categorías que
 * disparan ingreso de estoque físico (Bien de Cambio nacional).
 */
export function CategoriaCompraCombobox({ value, onChange, categorias, disabled = false }: Props) {
  const [open, setOpen] = useState(false);
  const selected = value != null ? categorias.find((c) => c.id === value) : null;

  const grupos = useMemo(() => {
    const map = new Map<string, CategoriaCompraOption[]>();
    for (const c of categorias) {
      const arr = map.get(c.grupo) ?? [];
      arr.push(c);
      map.set(c.grupo, arr);
    }
    return Array.from(map.entries());
  }, [categorias]);

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
          {selected ? `${selected.codigo} — ${selected.nombre}` : "Seleccione categoría"}
        </span>
        <HugeiconsIcon
          icon={UnfoldMoreIcon}
          strokeWidth={2}
          className="size-4 shrink-0 text-muted-foreground"
        />
      </PopoverTrigger>
      <PopoverContent className="w-(--anchor-width) min-w-80 p-0">
        <Command>
          <CommandInput placeholder="Buscar categoría por código o nombre…" />
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
                    {c.capitalizaEstoque && (
                      <span className="ml-auto rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                        estoque
                      </span>
                    )}
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
