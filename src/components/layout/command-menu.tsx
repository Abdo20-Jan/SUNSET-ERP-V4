"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { SearchIcon } from "@hugeicons/core-free-icons";

import { CENTERS, type NavItem, type NavSection } from "@/components/layout/nav-config";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

/** Items navegables de un center, deduplicados por href. */
function itemsDeCenter(sections: readonly NavSection[], crossLinks?: readonly NavItem[]) {
  const seen = new Set<string>();
  const out: NavItem[] = [];
  for (const item of [...sections.flatMap((s) => s.items), ...(crossLinks ?? [])]) {
    if (seen.has(item.href)) continue;
    seen.add(item.href);
    out.push(item);
  }
  return out;
}

/** Command palette (⌘K / Ctrl+K) que navega por todas las páginas del nav-config. */
export function CommandMenu() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const ir = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Buscar páginas"
        className="flex items-center gap-2 rounded-md border border-border bg-input/30 px-2 py-1 text-[12.5px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <HugeiconsIcon icon={SearchIcon} strokeWidth={2} className="size-3.5" />
        <span className="hidden sm:inline">Buscar…</span>
        <kbd className="hidden items-center gap-0.5 rounded border border-border bg-background px-1 font-mono text-[10px] sm:inline-flex">
          ⌘K
        </kbd>
      </button>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Buscar"
        description="Buscá una página para navegar."
      >
        <Command>
          <CommandInput placeholder="Buscar páginas…" />
          <CommandList>
            <CommandEmpty>Sin resultados.</CommandEmpty>
            {CENTERS.map((center) => {
              const items = itemsDeCenter(center.sections, center.crossLinks);
              if (items.length === 0) return null;
              return (
                <CommandGroup key={center.id} heading={center.label}>
                  {items.map((item) => (
                    <CommandItem
                      key={`${center.id}-${item.href}`}
                      value={`${center.label} ${item.label}`}
                      onSelect={() => ir(item.href)}
                    >
                      <HugeiconsIcon icon={item.icon} />
                      {item.label}
                    </CommandItem>
                  ))}
                </CommandGroup>
              );
            })}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
