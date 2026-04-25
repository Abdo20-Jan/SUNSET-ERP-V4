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

export type CuentaOption = {
  id: number;
  codigo: string;
  nombre: string;
};

type Props = {
  value: number | null;
  onChange: (id: number) => void;
  cuentas: CuentaOption[];
  placeholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
};

export function CuentaCombobox({
  value,
  onChange,
  cuentas,
  placeholder = "Seleccione cuenta analítica",
  emptyMessage = "Sin resultados.",
  disabled = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const selected = value != null ? cuentas.find((c) => c.id === value) : null;

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
          {selected ? `${selected.codigo} — ${selected.nombre}` : placeholder}
        </span>
        <HugeiconsIcon
          icon={UnfoldMoreIcon}
          strokeWidth={2}
          className="size-4 shrink-0 text-muted-foreground"
        />
      </PopoverTrigger>
      <PopoverContent className="w-(--anchor-width) min-w-80 p-0">
        <Command>
          <CommandInput placeholder="Buscar por código o nombre…" />
          <CommandList>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            {cuentas.map((c) => (
              <CommandItem
                key={c.id}
                value={`${c.codigo} ${c.nombre}`}
                onSelect={() => {
                  onChange(c.id);
                  setOpen(false);
                }}
              >
                <span className="font-mono text-xs text-muted-foreground">
                  {c.codigo}
                </span>
                <span className="truncate">{c.nombre}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
