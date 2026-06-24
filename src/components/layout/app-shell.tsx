"use client";

/**
 * AppShell (PR-002 Global Shell) — chrome do modo top-nav (G-02).
 *
 * Renderizado pela `(dashboard)/layout.tsx` SOMENTE quando `isTopNavEnabled()`.
 * Com a flag OFF (default) o layout continua montando o sidebar atual, intacto.
 *
 * Composição: barra superior (logo + `ModuleMegaMenu` + `GlobalSearch` +
 * `ShellUserMenu`) → faixa de abas internas (`TabStrip`) → breadcrumb → banner
 * modo retroactivo (replicado do layout) → `<main>`. Hospeda o
 * `InternalTabsProvider` no topo p/ o estado de abas sobreviver à navegação.
 */

import type * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { TireIcon } from "@hugeicons/core-free-icons";

import { Breadcrumb } from "@/components/layout/breadcrumb";
import { GlobalSearch } from "@/components/layout/global-search";
import { InternalTabsProvider, TabStrip } from "@/components/layout/internal-tabs";
import { ModuleMegaMenu } from "@/components/layout/module-mega-menu";
import { buildShellCrumbs } from "@/components/layout/nav-model";
import { ShellUserMenu } from "@/components/layout/shell-user-menu";

type AppShellProps = {
  user: { nombre: string; username: string; role: string };
  modoRetroactivo: boolean;
  children: React.ReactNode;
};

export function AppShell({ user, modoRetroactivo, children }: AppShellProps) {
  return (
    <InternalTabsProvider>
      <div className="flex min-h-svh flex-col">
        <header className="sticky top-0 z-20 bg-background/90 backdrop-blur-md">
          <div className="flex h-12 items-center gap-3 border-b border-border px-3">
            <Link
              href="/dashboard"
              className="flex shrink-0 items-center gap-2"
              aria-label="Inicio · Sunset Tires ERP"
            >
              <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm">
                <HugeiconsIcon icon={TireIcon} className="size-4" />
              </span>
              <span className="hidden flex-col leading-tight md:flex">
                <span className="text-[13px] font-semibold tracking-tight">Sunset Tires</span>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  ERP · v4
                </span>
              </span>
            </Link>
            <ModuleMegaMenu />
            <GlobalSearch />
            <ShellUserMenu user={user} />
          </div>

          <TabStrip />

          <ShellBreadcrumb />
        </header>

        {modoRetroactivo ? (
          <div className="border-b border-amber-300 bg-amber-100 px-4 py-1.5 text-center text-xs text-amber-900">
            Modo retroactivo activo · las fechas no se autocompletan ·{" "}
            <Link href="/perfil" className="underline hover:text-amber-950">
              ajustar en perfil
            </Link>
          </div>
        ) : null}

        <main className="flex-1 px-4 py-3">{children}</main>
      </div>
    </InternalTabsProvider>
  );
}

function ShellBreadcrumb() {
  const pathname = usePathname();
  const crumbs = buildShellCrumbs(pathname);
  if (crumbs.length === 0) return null;
  return (
    <div className="flex h-8 items-center border-b border-border/60 px-3">
      <Breadcrumb crumbs={crumbs} />
    </div>
  );
}
