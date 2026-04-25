"use client";

import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { UnfoldMoreIcon } from "@hugeicons/core-free-icons";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export type ProveedorOption = {
  id: string;
  nombre: string;
  pais: string;
};

type Props = {
  value: string | null;
  onChange: (id: string) => void;
  proveedores: ProveedorOption[];
  placeholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
};

export function ProveedorCombobox({
  value,
  onChange,
  proveedores,
  placeholder = "Seleccione proveedor",
  emptyMessage = "Sin resultados.",
  disabled = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const selected = value ? proveedores.find((p) => p.id === value) : null;

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
        <span
          className={cn(
            "truncate text-left",
            !selected && "text-muted-foreground",
          )}
        >
          {selected ? `${selected.nombre} (${selected.pais})` : placeholder}
        </span>
        <HugeiconsIcon
          icon={UnfoldMoreIcon}
          strokeWidth={2}
          className="size-4 shrink-0 text-muted-foreground"
        />
      </PopoverTrigger>
      <PopoverContent className="w-(--anchor-width) min-w-80 p-0">
        <Command>
          <CommandInput placeholder="Buscar por nombre o país…" />
          <CommandList>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            {proveedores.map((p) => (
              <CommandItem
                key={p.id}
                value={`${p.nombre} ${p.pais}`}
                onSelect={() => {
                  onChange(p.id);
                  setOpen(false);
                }}
              >
                <span className="truncate">{p.nombre}</span>
                <span className="text-xs text-muted-foreground">{p.pais}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
