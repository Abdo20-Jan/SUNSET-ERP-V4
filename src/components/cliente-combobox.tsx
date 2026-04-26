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

export type ClienteOption = {
  id: string;
  nombre: string;
  diasPagoDefault?: number | null;
};

type Props = {
  value: string | null;
  onChange: (id: string) => void;
  clientes: ClienteOption[];
  placeholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
};

export function ClienteCombobox({
  value,
  onChange,
  clientes,
  placeholder = "Seleccione cliente",
  emptyMessage = "Sin resultados.",
  disabled = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const selected = value ? clientes.find((c) => c.id === value) : null;

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
          {selected ? selected.nombre : placeholder}
        </span>
        <HugeiconsIcon
          icon={UnfoldMoreIcon}
          strokeWidth={2}
          className="size-4 shrink-0 text-muted-foreground"
        />
      </PopoverTrigger>
      <PopoverContent className="w-(--anchor-width) min-w-80 p-0">
        <Command>
          <CommandInput placeholder="Buscar cliente…" />
          <CommandList>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            {clientes.map((c) => (
              <CommandItem
                key={c.id}
                value={c.nombre}
                onSelect={() => {
                  onChange(c.id);
                  setOpen(false);
                }}
              >
                <span className="truncate">{c.nombre}</span>
                {c.diasPagoDefault != null && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    {c.diasPagoDefault === 0
                      ? "Contado"
                      : `${c.diasPagoDefault}d`}
                  </span>
                )}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
