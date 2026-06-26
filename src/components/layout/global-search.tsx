"use client";

/**
 * GlobalSearch (PR-002 Global Shell) — FUNDAÇÃO de navegação (SEARCH-01).
 *
 * Gatilho textual "Buscar… ⌘K" que abre um command palette (cmdk) sobre o
 * `nav-model` para **saltar para páginas**. Escopo desta PR = só navegação.
 *
 * NÃO faz busca de entidade/documento/registro: isso exige consulta no backend
 * com permissão (G-06) e fica para um PR de busca dedicado (pós-PermissionGate).
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { SearchIcon } from "@hugeicons/core-free-icons";

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useVisibleModules } from "@/components/auth/permissions-provider";
import { flattenNavTargets, type NavTarget } from "@/components/layout/nav-model";

function groupByModule(targets: NavTarget[]): Map<string, NavTarget[]> {
  const map = new Map<string, NavTarget[]>();
  for (const t of targets) {
    const list = map.get(t.moduleLabel) ?? [];
    list.push(t);
    map.set(t.moduleLabel, list);
  }
  return map;
}

export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  // PR-015: respeita o filtro de permissão do top-nav. Com RBAC OFF cobre todos os alvos.
  const modules = useVisibleModules();
  const grouped = React.useMemo(() => groupByModule(flattenNavTargets(modules)), [modules]);

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const go = React.useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-7 w-full max-w-64 items-center gap-2 rounded-md border border-input bg-background/60 px-2.5 text-[12px] text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        aria-label="Buscar páginas"
      >
        <HugeiconsIcon icon={SearchIcon} strokeWidth={2} className="size-3.5 shrink-0 opacity-60" />
        <span className="truncate">Buscar…</span>
        <kbd className="ml-auto hidden shrink-0 rounded border border-border bg-muted px-1 font-mono text-[10px] text-muted-foreground sm:inline">
          ⌘K
        </kbd>
      </button>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Búsqueda global"
        description="Saltar a una página del sistema."
      >
        <Command>
          <CommandInput placeholder="Ir a una página…" />
          <CommandList>
            <CommandEmpty>Sin resultados.</CommandEmpty>
            {Array.from(grouped.entries()).map(([moduleLabel, targets]) => (
              <CommandGroup key={moduleLabel} heading={moduleLabel}>
                {targets.map((t) => (
                  <CommandItem
                    key={t.href}
                    value={`${t.moduleLabel} ${t.label}`}
                    onSelect={() => go(t.href)}
                  >
                    <span className="text-muted-foreground">{t.moduleLabel}</span>
                    <span className="text-muted-foreground/50">/</span>
                    <span>{t.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
