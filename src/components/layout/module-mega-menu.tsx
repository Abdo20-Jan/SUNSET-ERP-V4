"use client";

/**
 * Top-nav textual hierárquico (PR-002 Global Shell) — atende G-02/G-03.
 *
 * Linha horizontal de módulos textuais (densa, 13px). Módulo-folha = `Link`
 * direto; módulo-pai abre um submenu textual (base-ui `DropdownMenu`) com seus
 * itens. Itens `future` aparecem desabilitados com a tag "Pronto" e **não**
 * navegam. Nada é icon-only — o chevron é só reforço.
 *
 * Fonte de dados: `SHELL_MODULES` (ver `nav-model.ts`).
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";

import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  isHrefActive,
  isModuleActive,
  SHELL_MODULES,
  type ShellModule,
} from "@/components/layout/nav-model";

const topItemBase =
  "flex h-7 shrink-0 items-center gap-1 rounded-md px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors";

export function ModuleMegaMenu() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navegación principal"
      className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto scrollbar-thin"
    >
      {SHELL_MODULES.map((mod) =>
        mod.items ? (
          <ModuleDropdown key={mod.label} mod={mod} pathname={pathname} />
        ) : (
          <Link
            key={mod.label}
            href={mod.href ?? "#"}
            className={cn(
              topItemBase,
              isModuleActive(pathname, mod)
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
          >
            {mod.label}
          </Link>
        ),
      )}
    </nav>
  );
}

function ModuleDropdown({ mod, pathname }: { mod: ShellModule; pathname: string }) {
  const active = isModuleActive(pathname, mod);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          topItemBase,
          "data-[popup-open]:bg-accent data-[popup-open]:text-foreground",
          active
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
        )}
      >
        {mod.label}
        <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} className="size-3.5 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="min-w-52">
        {mod.items?.map((item) =>
          item.status === "active" && item.href ? (
            <DropdownMenuItem
              key={item.label}
              render={<Link href={item.href} />}
              className={cn(
                "text-[13px]",
                isHrefActive(pathname, item.href) && "font-semibold text-foreground",
              )}
            >
              {item.label}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem key={item.label} disabled className="text-[13px]">
              <span>{item.label}</span>
              <span className="ml-auto rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Pronto
              </span>
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
