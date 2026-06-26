"use client";

/**
 * Drawer de navegação mobile do top-nav (AppShell, cutover PR-015).
 *
 * Equivale ao `nav-drawer.tsx` legado (hambúrguer `md:hidden`), mas dirigido
 * pela fonte canônica `SHELL_MODULES` via `useVisibleModules()` (filtrado por
 * permissão; com RBAC OFF mostra tudo). No desktop o `ModuleMegaMenu` cobre a
 * navegação (G-02); este drawer existe só p/ telas estreitas. Não muda rota nem
 * comportamento — só lista links existentes.
 */

import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { Menu01Icon } from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useVisibleModules } from "@/components/auth/permissions-provider";
import type { ShellModule } from "@/components/layout/nav-model";

const leafLinkClass =
  "rounded-md px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:bg-accent";
const itemLinkClass =
  "rounded-md px-3 py-1.5 text-[13px] text-foreground transition-colors hover:bg-accent";

export function ShellNavDrawer() {
  // PR-015: nav filtrado por permissão. Com RBAC OFF devolve o nav completo (sem mudança).
  const modules = useVisibleModules();
  return (
    <Sheet>
      <SheetTrigger
        render={<Button variant="ghost" size="icon-sm" className="md:hidden" aria-label="Menú" />}
      >
        <HugeiconsIcon icon={Menu01Icon} strokeWidth={2} />
      </SheetTrigger>
      <SheetContent side="left" className="w-72 p-0">
        <SheetHeader className="p-4 pb-2">
          <SheetTitle>Navegación</SheetTitle>
        </SheetHeader>
        <nav className="flex flex-col gap-3 overflow-y-auto px-3 pb-6">
          {modules.map((mod) => (
            <ShellNavGroup key={mod.label} mod={mod} />
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  );
}

function ShellNavGroup({ mod }: { mod: ShellModule }) {
  // Módulo-folha (link direto, sem submenu): Dashboard, Logística, BI.
  if (!mod.items) {
    return mod.href ? (
      <Link href={mod.href} className={leafLinkClass}>
        {mod.label}
      </Link>
    ) : null;
  }
  return (
    <div className="flex flex-col gap-0.5">
      <p className="px-1 py-1 text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground/70">
        {mod.label}
      </p>
      {mod.items.map((item) =>
        item.status === "active" && item.href ? (
          <Link key={item.label} href={item.href} className={itemLinkClass}>
            {item.label}
          </Link>
        ) : (
          <span
            key={item.label}
            className="flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px] text-muted-foreground/50"
          >
            {item.label}
            <span className="ml-auto rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Pronto
            </span>
          </span>
        ),
      )}
    </div>
  );
}
