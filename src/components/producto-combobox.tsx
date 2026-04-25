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

export type ProductoOption = {
  id: string;
  codigo: string;
  nombre: string;
  marca: string | null;
  medida: string | null;
};

type Props = {
  value: string | null;
  onChange: (id: string) => void;
  productos: ProductoOption[];
  placeholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
};

export function ProductoCombobox({
  value,
  onChange,
  productos,
  placeholder = "Seleccione producto",
  emptyMessage = "Sin resultados.",
  disabled = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const selected = value ? productos.find((p) => p.id === value) : null;

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
          {selected
            ? `${selected.codigo} — ${[selected.marca, selected.medida]
                .filter((v): v is string => Boolean(v))
                .join(" ") || selected.nombre}`
            : placeholder}
        </span>
        <HugeiconsIcon
          icon={UnfoldMoreIcon}
          strokeWidth={2}
          className="size-4 shrink-0 text-muted-foreground"
        />
      </PopoverTrigger>
      <PopoverContent className="w-(--anchor-width) min-w-96 p-0">
        <Command>
          <CommandInput placeholder="Buscar por código, marca o medida…" />
          <CommandList>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            {productos.map((p) => (
              <CommandItem
                key={p.id}
                value={`${p.codigo} ${p.nombre} ${p.marca ?? ""} ${p.medida ?? ""}`}
                onSelect={() => {
                  onChange(p.id);
                  setOpen(false);
                }}
              >
                <span className="font-mono text-xs text-muted-foreground">
                  {p.codigo}
                </span>
                <span className="truncate">
                  {[p.marca, p.medida]
                    .filter((v): v is string => Boolean(v))
                    .join(" ") || p.nombre}
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
