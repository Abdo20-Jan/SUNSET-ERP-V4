"use client";

import { useTheme } from "next-themes";
import { HugeiconsIcon } from "@hugeicons/react";
import { Sun03Icon, Moon02Icon, ComputerIcon } from "@hugeicons/core-free-icons";

import { DropdownMenuRadioGroup, DropdownMenuRadioItem } from "@/components/ui/dropdown-menu";

const OPCIONES = [
  { value: "light", label: "Claro", icon: Sun03Icon },
  { value: "dark", label: "Oscuro", icon: Moon02Icon },
  { value: "system", label: "Sistema", icon: ComputerIcon },
] as const;

/** Selector de tema (claro/oscuro/sistema) para usar dentro del menú del avatar. */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={setTheme}>
      {OPCIONES.map((o) => (
        <DropdownMenuRadioItem key={o.value} value={o.value}>
          <HugeiconsIcon icon={o.icon} />
          {o.label}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}
